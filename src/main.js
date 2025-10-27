// TheMuse.com job scraper built around the public API with optional detail enrichment.
import { Actor, log } from 'apify';
import { gotScraping } from 'got-scraping';
import { load } from 'cheerio';

const API_BASE_URL = 'https://www.themuse.com/api/public/jobs';

const DEFAULT_USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.4 Safari/605.1.15',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'
];

const DATE_FILTER_MAP = {
    'today': 1,
    '1d': 1,
    '24h': 1,
    'past_day': 1,
    'past_24_hours': 1,
    '3d': 3,
    '72h': 3,
    'week': 7,
    '1w': 7,
    '7d': 7,
    'two_weeks': 14,
    '14d': 14,
    'month': 30,
    '1m': 30,
    '30d': 30,
    '3m': 90,
    '90d': 90
};

await Actor.main(async () => {
    const cliArgs = parseCliArgs();
    const actorInput = (await Actor.getInput()) || {};
    const input = normalizeInput(actorInput, cliArgs, process.env);

    if (!input.query && input.keyword) input.query = input.keyword;

    const userAgent = pickUserAgent(input.userAgent);
    let proxyConfiguration;
    try {
        proxyConfiguration = await Actor.createProxyConfiguration(input.proxyConfiguration || undefined);
    } catch (err) {
        log.warning('Proxy configuration could not be created. Requests will run without a proxy.', { error: err.message });
    }

    const cookieHeader = buildCookieHeader(input.cookies, input.cookiesJson);
    const seenJobs = input.dedupe ? new Set() : null;
    const dataset = await Actor.openDataset();

    const fetchOptions = {
        userAgent,
        proxyConfiguration,
        cookieHeader,
        seenJobs,
        maxRetries: input.requestRetries,
        timeoutMillis: input.requestTimeoutMillis,
        detailRetries: input.detailRetries
    };

    const state = {
        totalSaved: 0,
        totalRequests: 0,
        pagesFetched: 0,
        apiErrors: 0
    };

    const { apiUrls, htmlUrls } = partitionStartUrls(input.startUrls);

    if (apiUrls.length > 0) {
        log.info('Processing explicit API URLs supplied in startUrls', { count: apiUrls.length });
        for (const apiUrl of apiUrls) {
            if (input.maxItems > 0 && state.totalSaved >= input.maxItems) break;
            let params;
            let startingPage = 1;
            try {
                const parsed = new URL(apiUrl);
                params = new URLSearchParams(parsed.searchParams);
                startingPage = Number(params.get('page')) || 1;
                params.delete('page');
            } catch (err) {
                log.warning('Failed to parse API URL, skipping', { url: apiUrl, error: err.message });
                continue;
            }
            ensureCoreParams(params, input);
            await runApiFlow({
                baseParams: params,
                startPage: startingPage,
                input,
                state,
                fetchOptions,
                dataset
            });
        }
    } else {
        const paramSets = [];
        if (htmlUrls.length > 0) {
            log.info('Converting HTML search URLs to API parameters', { count: htmlUrls.length });
            for (const htmlUrl of htmlUrls) {
                const params = convertSearchUrlToParams(htmlUrl);
                if (params) {
                    ensureCoreParams(params, input);
                    paramSets.push({ params, label: htmlUrl });
                } else {
                    log.warning('Unable to translate HTML search URL into API filters', { url: htmlUrl });
                }
            }
        }

        if (paramSets.length === 0) {
            const defaultParams = buildApiParamsFromInput(input);
            ensureCoreParams(defaultParams, input);
            paramSets.push({ params: defaultParams, label: 'default filters' });
        }

        for (const candidate of paramSets) {
            if (input.maxItems > 0 && state.totalSaved >= input.maxItems) break;
            log.info('Fetching jobs via API', { source: candidate.label });
            await runApiFlow({
                baseParams: candidate.params,
                startPage: 1,
                input,
                state,
                fetchOptions,
                dataset
            });
        }
    }

    if (state.totalSaved === 0) {
        log.warning('No jobs were saved. Review your filters or relax them to widen the search.');
    }

    log.info('Crawl finished', {
        total_saved: state.totalSaved,
        api_requests: state.totalRequests,
        pages_fetched: state.pagesFetched,
        api_errors: state.apiErrors
    });
});

function parseCliArgs() {
    const argv = process.argv.slice(2);
    const out = {};
    for (let i = 0; i < argv.length; i++) {
        const current = argv[i];
        if (!current.startsWith('--')) continue;
        const key = current.slice(2);
        const next = argv[i + 1];
        if (next && !next.startsWith('--')) {
            out[key] = next;
            i++;
        } else {
            out[key] = true;
        }
    }
    return out;
}

function normalizeInput(actorInput, cliArgs, env) {
    const bool = normalizeBoolean;
    const num = normalizeNumber;

    const startUrls = dedupeArray([
        ...parseStartUrls(actorInput.startUrls),
        ...parseStartUrls(cliArgs.startUrls),
        ...parseStartUrls(env?.START_URLS)
    ]);

    const singleStartUrl = actorInput.startUrl || cliArgs.startUrl || env?.START_URL;
    if (singleStartUrl) startUrls.unshift(singleStartUrl);

    let maxItems = num(env?.MAX_ITEMS ?? cliArgs.maxItems ?? actorInput.maxItems ?? actorInput.results_wanted, 100);
    if (!Number.isFinite(maxItems) || maxItems < 0) maxItems = 0;

    let maxPages = num(env?.MAX_PAGES ?? cliArgs.maxPages ?? actorInput.maxPages ?? actorInput.max_pages, 20);
    if (!Number.isFinite(maxPages) || maxPages < 0) maxPages = 0;

    let perPage = num(env?.PER_PAGE ?? cliArgs.perPage ?? actorInput.perPage ?? actorInput.per_page ?? actorInput.items_per_page, 20);
    if (!Number.isFinite(perPage) || perPage <= 0) perPage = 20;
    perPage = Math.min(Math.max(Math.floor(perPage), 1), 50);

    let minDelayMs = num(env?.MIN_DELAY_MS ?? cliArgs.minDelayMs ?? actorInput.minDelayMs, 350);
    let maxDelayMs = num(env?.MAX_DELAY_MS ?? cliArgs.maxDelayMs ?? actorInput.maxDelayMs, 750);
    if (!Number.isFinite(minDelayMs) || minDelayMs < 0) minDelayMs = 350;
    if (!Number.isFinite(maxDelayMs) || maxDelayMs < minDelayMs) maxDelayMs = minDelayMs + 250;

    const input = {
        query: cliArgs.query ?? env?.QUERY ?? actorInput.query ?? undefined,
        keyword: cliArgs.keyword ?? env?.KEYWORD ?? actorInput.keyword ?? undefined,
        category: cliArgs.category ?? env?.CATEGORY ?? actorInput.category ?? undefined,
        location: cliArgs.location ?? env?.LOCATION ?? actorInput.location ?? undefined,
        dateRaw: env?.DATE_POSTED ?? cliArgs.datePosted ?? actorInput.datePosted ?? actorInput.publishedWithin ?? undefined,
        maxItems,
        maxPages,
        perPage,
        collectDetails: bool(env?.COLLECT_DETAILS ?? cliArgs.collectDetails ?? actorInput.collectDetails, false),
        dedupe: bool(actorInput.dedupe ?? cliArgs.dedupe ?? env?.DEDUPE, true),
        startUrls,
        cookies: actorInput.cookies ?? env?.COOKIES ?? cliArgs.cookies ?? undefined,
        cookiesJson: actorInput.cookiesJson ?? env?.COOKIES_JSON ?? cliArgs.cookiesJson ?? undefined,
        proxyConfiguration: actorInput.proxyConfiguration,
        userAgent: actorInput.userAgent ?? env?.USER_AGENT ?? cliArgs.userAgent ?? undefined,
        minDelayMs,
        maxDelayMs,
        requestRetries: Math.max(1, Math.floor(num(env?.REQUEST_RETRIES ?? cliArgs.requestRetries ?? actorInput.requestRetries, 3))),
        detailRetries: Math.max(0, Math.floor(num(env?.DETAIL_RETRIES ?? cliArgs.detailRetries ?? actorInput.detailRetries, 2))),
        requestTimeoutMillis: Math.max(5000, Math.floor(num(env?.REQUEST_TIMEOUT_MS ?? cliArgs.requestTimeoutMs ?? actorInput.requestTimeoutMs, 25000)))
    };

    input.dateFilter = normalizeDateFilter(input.dateRaw);
    return input;
}

function normalizeBoolean(value, defaultValue) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'string') {
        const lower = value.trim().toLowerCase();
        if (['true', '1', 'yes', 'y', 'on'].includes(lower)) return true;
        if (['false', '0', 'no', 'n', 'off'].includes(lower)) return false;
    }
    return defaultValue;
}

function normalizeNumber(value, defaultValue) {
    if (value === null || typeof value === 'undefined' || value === '') return defaultValue;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : defaultValue;
}

function parseStartUrls(value) {
    if (!value) return [];
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return [];
        if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
            try {
                return parseStartUrls(JSON.parse(trimmed));
            } catch {
                return trimmed.split(',').map(s => s.trim()).filter(Boolean);
            }
        }
        return trimmed.split(',').map(s => s.trim()).filter(Boolean);
    }
    if (Array.isArray(value)) {
        const out = [];
        for (const entry of value) {
            if (!entry) continue;
            if (typeof entry === 'string') {
                const trimmed = entry.trim();
                if (trimmed) out.push(trimmed);
            } else if (typeof entry === 'object' && entry.url) {
                const trimmed = String(entry.url).trim();
                if (trimmed) out.push(trimmed);
            }
        }
        return out;
    }
    if (typeof value === 'object' && value.url) {
        const trimmed = String(value.url).trim();
        return trimmed ? [trimmed] : [];
    }
    return [];
}

function dedupeArray(arr) {
    return Array.from(new Set(arr.filter(Boolean)));
}

function normalizeDateFilter(value) {
    if (!value && value !== 0) return null;
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
        return { type: 'range', days: value };
    }
    const str = String(value).trim();
    if (!str) return null;
    const lower = str.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(DATE_FILTER_MAP, lower)) {
        return { type: 'range', days: DATE_FILTER_MAP[lower] };
    }
    const rangeMatch = lower.match(/^(\d+)\s*(d|day|days|w|week|weeks|m|month|months)$/);
    if (rangeMatch) {
        const qty = Number(rangeMatch[1]);
        const unit = rangeMatch[2];
        let days = qty;
        if (unit.startsWith('w')) days = qty * 7;
        else if (unit.startsWith('m')) days = qty * 30;
        return { type: 'range', days };
    }
    const parsedDate = new Date(str);
    if (!Number.isNaN(parsedDate.getTime())) {
        return { type: 'since', since: parsedDate };
    }
    log.warning('Unable to interpret date filter, ignoring', { value });
    return null;
}

function ensureCoreParams(params, input) {
    if (!params.has('per_page')) params.set('per_page', String(input.perPage));
    if (!params.has('descending')) params.set('descending', 'true');
}

function buildApiParamsFromInput(input) {
    const params = new URLSearchParams();
    if (input.query) params.set('q', input.query);
    if (input.category) params.set('category', input.category);
    if (input.location) params.set('location', input.location);
    return params;
}

function convertSearchUrlToParams(urlString) {
    try {
        const parsed = new URL(urlString);
        const params = new URLSearchParams(parsed.searchParams);
        const segments = parsed.pathname.split('/').filter(Boolean);
        const searchIndex = segments.indexOf('search');
        if (searchIndex === -1) return null;
        for (let i = searchIndex + 1; i < segments.length; i += 2) {
            const key = segments[i];
            const value = segments[i + 1];
            if (!value) continue;
            const decoded = decodeURIComponent(value).replace(/_/g, ' ');
            switch (key.toLowerCase()) {
                case 'keyword':
                case 'query':
                case 'q':
                    params.set('q', decoded);
                    break;
                case 'category':
                    params.set('category', decoded);
                    break;
                case 'location':
                    params.set('location', decoded);
                    break;
                case 'company':
                    params.set('company', decoded);
                    break;
                case 'level':
                    params.set('level', decoded);
                    break;
                case 'jobtype':
                case 'job_type':
                    params.set('job_type', decoded);
                    break;
                case 'tag':
                case 'tags':
                    params.set('tags', decoded.replace(/\s*,\s*/g, ','));
                    break;
                case 'remote':
                    params.set('remote', ['true', '1', 'yes', 'y'].includes(decoded.toLowerCase()) ? 'true' : 'false');
                    break;
                default:
                    params.set(key, decoded);
            }
        }
        return params;
    } catch {
        return null;
    }
}

function partitionStartUrls(urls) {
    const apiUrls = [];
    const htmlUrls = [];
    for (const url of urls) {
        if (!url) continue;
        if (url.includes('/api/public/')) apiUrls.push(url);
        else htmlUrls.push(url);
    }
    return { apiUrls, htmlUrls };
}

async function runApiFlow({ baseParams, startPage, input, state, fetchOptions, dataset }) {
    const baseParamString = typeof baseParams === 'string' ? baseParams : baseParams.toString();
    let currentPage = startPage;
    let pagesProcessed = 0;

    while (true) {
        if (input.maxItems > 0 && state.totalSaved >= input.maxItems) break;
        if (input.maxPages > 0 && pagesProcessed >= input.maxPages) break;

        const params = new URLSearchParams(baseParamString);
        params.set('page', String(currentPage));
        ensureCoreParams(params, input);

        let apiResult;
        try {
            apiResult = await fetchApiPage(params, fetchOptions);
        } catch (err) {
            state.apiErrors += 1;
            log.error('API request failed after retries.', { page: currentPage, error: err.message });
            break;
        }

        state.totalRequests += 1;
        const data = apiResult.data;
        if (!data || !Array.isArray(data.results)) {
            log.warning('API response did not include results array.', { page: currentPage, url: apiResult.url });
            break;
        }

        const jobs = data.results;
        log.info(`API page ${currentPage} returned ${jobs.length} jobs`, { url: apiResult.url });
        pagesProcessed += 1;
        state.pagesFetched += 1;

        if (jobs.length === 0) break;

        for (const job of jobs) {
            if (input.maxItems > 0 && state.totalSaved >= input.maxItems) break;

            if (!passesDateFilter(job.publication_date, input.dateFilter)) continue;
            if (fetchOptions.seenJobs && fetchOptions.seenJobs.has(job.id)) continue;

            let detail = null;
            if (input.collectDetails && job && job.id) {
                detail = await fetchJobDetail(job.id, fetchOptions);
            }

            const output = formatJob(job, detail);
            await dataset.pushData(output);

            state.totalSaved += 1;
            if (fetchOptions.seenJobs) fetchOptions.seenJobs.add(job.id);
            if (input.maxItems > 0 && state.totalSaved >= input.maxItems) break;
        }

        if (data.page_count && currentPage >= data.page_count) {
            log.debug('Reached last available page from API.', { page: currentPage, page_count: data.page_count });
            break;
        }

        currentPage += 1;
        await sleep(randomInt(input.minDelayMs, input.maxDelayMs));
    }
}

async function fetchApiPage(params, options) {
    const url = `${API_BASE_URL}?${params.toString()}`;
    let lastError;
    for (let attempt = 0; attempt < options.maxRetries; attempt++) {
        try {
            const proxyUrl = options.proxyConfiguration ? await options.proxyConfiguration.newUrl() : undefined;
            const response = await gotScraping({
                url,
                proxyUrl,
                headers: buildApiHeaders(options.userAgent, options.cookieHeader),
                timeout: { request: options.timeoutMillis },
                responseType: 'json',
                throwHttpErrors: false
            });

            if (response.statusCode === 200) {
                return { data: response.body, url };
            }

            if (response.statusCode === 404) {
                log.warning('API responded with 404 for request.', { url });
                return { data: null, url };
            }

            if (response.statusCode === 429) {
                const wait = 1000 * (attempt + 1);
                log.warning('API rate limit encountered. Retrying after delay.', { url, attempt, wait });
                await sleep(wait);
                continue;
            }

            if (response.statusCode >= 500) {
                const wait = 800 * (attempt + 1);
                log.warning('Server error from API. Retrying.', { url, statusCode: response.statusCode, attempt });
                await sleep(wait);
                continue;
            }

            log.warning('Unexpected API status code.', { url, statusCode: response.statusCode });
            return { data: null, url };
        } catch (err) {
            lastError = err;
            const wait = 600 * (attempt + 1);
            log.debug('API request attempt failed, will retry.', { url, attempt, error: err.message, wait });
            await sleep(wait);
        }
    }
    throw lastError || new Error('API request failed without specific error.');
}

async function fetchJobDetail(jobId, options) {
    const url = `${API_BASE_URL}/${jobId}`;
    let lastError;
    for (let attempt = 0; attempt <= options.detailRetries; attempt++) {
        try {
            const proxyUrl = options.proxyConfiguration ? await options.proxyConfiguration.newUrl() : undefined;
            const response = await gotScraping({
                url,
                proxyUrl,
                headers: buildApiHeaders(options.userAgent, options.cookieHeader),
                timeout: { request: Math.max(10000, Math.floor(options.timeoutMillis / 2)) },
                responseType: 'json',
                throwHttpErrors: false
            });
            if (response.statusCode === 200) {
                return response.body;
            }
            if (response.statusCode >= 400 && response.statusCode < 500) {
                log.debug('Detail API returned client error.', { url, statusCode: response.statusCode });
                return null;
            }
        } catch (err) {
            lastError = err;
            const wait = 500 * (attempt + 1);
            await sleep(wait);
        }
    }
    if (lastError) {
        log.debug('Failed to fetch job detail after retries.', { jobId, error: lastError.message });
    }
    return null;
}

function passesDateFilter(dateStr, filter) {
    if (!filter) return true;
    if (!dateStr) return false;
    const posted = new Date(dateStr);
    if (Number.isNaN(posted.getTime())) return false;
    if (filter.type === 'range') {
        const diff = (Date.now() - posted.getTime()) / (1000 * 60 * 60 * 24);
        return diff <= filter.days;
    }
    if (filter.type === 'since') {
        return posted >= filter.since;
    }
    return true;
}

function formatJob(job, detail) {
    const source = detail && detail.id ? detail : job;
    const html = (detail && detail.contents) || job.contents || null;
    const categories = normalizeArray(source.categories).map(cat => cat.name ?? cat).filter(Boolean);
    const locations = normalizeArray(source.locations).map(loc => loc.name ?? loc).filter(Boolean);

    return {
        source: 'api',
        job_id: source.id ?? null,
        slug: source.short_name ?? null,
        title: source.name ?? null,
        company: source.company?.name ?? null,
        company_id: source.company?.id ?? null,
        company_short_name: source.company?.short_name ?? null,
        locations,
        location: locations.join(', ') || null,
        categories,
        job_category: categories.join(', ') || null,
        levels: normalizeArray(source.levels).map(level => level.name ?? level).filter(Boolean),
        tags: normalizeArray(source.tags).map(tag => tag.name ?? tag).filter(Boolean),
        job_type: source.type ?? null,
        publication_date: source.publication_date ?? null,
        date_posted: source.publication_date ?? null,
        landing_page: source.refs?.landing_page ?? null,
        url: source.refs?.landing_page ?? null,
        api_url: `${API_BASE_URL}/${source.id}`,
        description_html: html ?? null,
        description_text: html ? htmlToText(html) : null,
        raw: source
    };
}

function normalizeArray(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    return [value];
}

function htmlToText(html) {
    if (!html) return null;
    try {
        const $ = load(`<div>${html}</div>`);
        const text = $('div').text().replace(/\s+/g, ' ').trim();
        return text || null;
    } catch {
        return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || null;
    }
}

function buildApiHeaders(userAgent, cookieHeader) {
    const headers = {
        'user-agent': userAgent,
        'accept': 'application/json, text/javascript, */*; q=0.01',
        'accept-language': 'en-US,en;q=0.9',
        'referer': 'https://www.themuse.com/',
        'origin': 'https://www.themuse.com',
        'sec-fetch-site': 'same-origin',
        'sec-fetch-mode': 'cors',
        'sec-fetch-dest': 'empty'
    };
    const hints = buildClientHintsFromUA(userAgent);
    headers['sec-ch-ua'] = hints['sec-ch-ua'];
    headers['sec-ch-ua-mobile'] = hints['sec-ch-ua-mobile'];
    headers['sec-ch-ua-platform'] = hints['sec-ch-ua-platform'];
    if (cookieHeader) headers.cookie = cookieHeader;
    return headers;
}

function buildCookieHeader(cookies, cookiesJson) {
    if (typeof cookies === 'string' && cookies.trim()) return cookies.trim();
    if (!cookiesJson) return null;
    try {
        const parsed = typeof cookiesJson === 'string' ? JSON.parse(cookiesJson) : cookiesJson;
        if (Array.isArray(parsed)) {
            return parsed.map(c => `${c.name}=${c.value}`).join('; ');
        }
        if (parsed && typeof parsed === 'object') {
            return Object.entries(parsed).map(([k, v]) => `${k}=${v}`).join('; ');
        }
    } catch (err) {
        log.warning('Unable to parse cookiesJson into header.', { error: err.message });
    }
    return null;
}

function buildClientHintsFromUA(ua) {
    const hints = {
        'sec-ch-ua': '"Chromium";v="123", "Google Chrome";v="123", ";Not A Brand";v="99"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"'
    };
    if (/Macintosh|Mac OS X/i.test(ua)) {
        hints['sec-ch-ua-platform'] = '"macOS"';
        hints['sec-ch-ua'] = '"Not A(Brand)";v="99", "Safari";v="16"';
    } else if (/Linux|Ubuntu/i.test(ua)) {
        hints['sec-ch-ua-platform'] = '"Linux"';
    } else if (/Android/i.test(ua) || /Mobile/i.test(ua)) {
        hints['sec-ch-ua-mobile'] = '?1';
        hints['sec-ch-ua-platform'] = '"Android"';
    }
    return hints;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function randomInt(min, max) {
    const floorMin = Math.ceil(min);
    const floorMax = Math.floor(max);
    return Math.floor(Math.random() * (floorMax - floorMin + 1)) + floorMin;
}

function pickUserAgent(provided) {
    if (provided && typeof provided === 'string') return provided;
    return DEFAULT_USER_AGENTS[randomInt(0, DEFAULT_USER_AGENTS.length - 1)];
}
