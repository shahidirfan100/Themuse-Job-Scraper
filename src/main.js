

// TheMuse.com jobs scraper - Direct API implementation with safe defaults and fallbacks
import { Actor, log } from 'apify';
import { HttpCrawler, CheerioCrawler, Dataset } from 'crawlee';


const API_BASE_URL = 'https://www.themuse.com/api/public/jobs';

// Small list of User-Agents to rotate; keep lightweight and avoid external deps
const DEFAULT_USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Safari/605.1.15',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
];

function buildClientHintsFromUA(ua) {
    // Very small heuristic-based builder to keep sec-ch-ua values consistent with UA
    const hints = {
        'sec-ch-ua': '"Chromium";v="120", "Google Chrome";v="120", ";Not A Brand";v="99"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
    };
    if (/Macintosh|Mac OS X/i.test(ua)) {
        hints['sec-ch-ua-platform'] = '"macOS"';
        hints['sec-ch-ua'] = '"Not A(Brand)";v="99", "Safari";v="16"';
    } else if (/Linux/i.test(ua)) {
        hints['sec-ch-ua-platform'] = '"Linux"';
    } else if (/Android/i.test(ua) || /Mobile/i.test(ua)) {
        hints['sec-ch-ua-mobile'] = '?1';
    }
    return hints;
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pickUserAgent(provided) {
    if (provided) return provided;
    return DEFAULT_USER_AGENTS[randomInt(0, DEFAULT_USER_AGENTS.length - 1)];
}

function generateCategoryVariants(category) {
    // Try a few reasonable variants to account for case/casing and underscores
    const variants = new Set();
    if (!category) return [];
    const trimmed = category.trim();
    variants.add(trimmed);
    variants.add(trimmed.replace(/_/g, ' '));
    // Title case
    variants.add(trimmed.split(/[_\s]+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' '));
    // Lowercase with underscores
    variants.add(trimmed.toLowerCase().replace(/\s+/g, '_'));
    // Uppercase first
    variants.add(trimmed.charAt(0).toUpperCase() + trimmed.slice(1));
    return Array.from(variants);
}

// Try to resolve a best-fit category for TheMuse API by probing the API and available categories
async function tryResolveCategory(preferredCategory, proxyConf, userAgent) {
    if (!preferredCategory) return null;
    const candidates = generateCategoryVariants(preferredCategory);
    // Try candidates directly first (sequentially) to find one that returns jobs
    for (const c of candidates) {
        try {
            const url = new URL(API_BASE_URL);
            url.searchParams.set('category', c);
            url.searchParams.set('page', '1');
            const res = await fetch(url.href, { headers: { 'user-agent': userAgent, 'accept': 'application/json' } });
            if (!res.ok) continue;
            const data = await res.json();
            if (data && Array.isArray(data.results) && data.results.length > 0) {
                return c;
            }
        } catch (e) {
            // ignore transient errors and try next candidate
        }
    }

    // If direct candidates didn't match, probe a sample of jobs without category to learn available categories
    try {
        const sampleUrl = new URL(API_BASE_URL);
        sampleUrl.searchParams.set('page', '1');
        const res = await fetch(sampleUrl.href, { headers: { 'user-agent': userAgent, 'accept': 'application/json' } });
        if (res.ok) {
            const data = await res.json();
            const available = new Set();
            if (data && Array.isArray(data.results)) {
                for (const job of data.results) {
                    if (job.categories && Array.isArray(job.categories)) {
                        for (const cat of job.categories) {
                            if (cat && cat.name) available.add(cat.name);
                        }
                    }
                }
            }
            const normalizedPreferred = ('' + preferredCategory).toLowerCase().replace(/[^a-z0-9]+/g, '');
            for (const av of Array.from(available)) {
                const norm = ('' + av).toLowerCase().replace(/[^a-z0-9]+/g, '');
                if (norm === normalizedPreferred) return av; // exact normalized match
            }
            // try fuzzy contains
            for (const av of Array.from(available)) {
                if (av.toLowerCase().includes(preferredCategory.toLowerCase())) return av;
            }
        }
    } catch (e) {
        // ignore
    }

    return null;
}

// Early startup log so container shows activity immediately
console.log('Starting TheMuse actor - initializing...');
try {
    await Actor.init();
} catch (e) {
    console.error('Actor.init() failed to initialize:', e && e.message ? e.message : e);
    // Give the error a moment to flush to logs before exiting
    try { await sleep(250); } catch (err) {}
    process.exit(1);
}

async function main() {
    try {
        const actorInput = (await Actor.getInput()) || {};

        // Respect CLI/ENV but prefer Actor input
        const argv = process.argv.slice(2);
        const cli = {};
        for (let i = 0; i < argv.length; i++) {
            const a = argv[i];
            if (a.startsWith('--')) {
                const k = a.replace(/^--/, '');
                const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
                cli[k] = v;
            }
        }

        const input = {
            // HTML listing options
            startUrl: process.env.START_URL || cli.startUrl || actorInput.startUrl || undefined,
            startUrls: actorInput.startUrls || (cli.startUrls ? (Array.isArray(cli.startUrls) ? cli.startUrls : String(cli.startUrls).split(',')) : undefined),
            keyword: process.env.KEYWORD || cli.keyword || actorInput.keyword || undefined,
            location: process.env.LOCATION || cli.location || actorInput.location || undefined,
            datePosted: process.env.DATE_POSTED || cli.datePosted || actorInput.datePosted || undefined,
            // API options
            category: process.env.CATEGORY || cli.category || actorInput.category || 'Software Engineering',
            // common options
            collectDetails: (process.env.COLLECT_DETAILS || typeof cli.collectDetails !== 'undefined' ? (process.env.COLLECT_DETAILS === 'true' || cli.collectDetails === 'true' || cli.collectDetails === true) : (typeof actorInput.collectDetails === 'boolean' ? actorInput.collectDetails : true)),
            maxItems: Number(process.env.MAX_ITEMS || cli.maxItems || actorInput.maxItems || 100),
            maxPages: Number(process.env.MAX_PAGES || cli.maxPages || actorInput.maxPages || 20), // default 20 pages
            proxyConfiguration: actorInput.proxyConfiguration || undefined,
            htmlFallback: (process.env.HTML_FALLBACK || cli.htmlFallback || actorInput.htmlFallback) || false,
            dedupe: (typeof actorInput.dedupe !== 'undefined' ? actorInput.dedupe : (typeof cli.dedupe !== 'undefined' ? cli.dedupe : true)),
            cookies: process.env.COOKIES || cli.cookies || actorInput.cookies || undefined,
            cookiesJson: process.env.COOKIES_JSON || cli.cookiesJson || actorInput.cookiesJson || undefined,
        };

        // Provide simple CLI help and dry-run
        if (cli.help || cli.h) {
            console.log('Usage: node src/main.js [--category "Software Engineering"] [--maxItems 200] [--maxPages 0] [--concurrency 2] [--htmlFallback true]');
            console.log('You can also set environment variables (CATEGORY, MAX_ITEMS, MAX_PAGES, CONCURRENCY, HTML_FALLBACK).');
            await Actor.exit();
            return;
        }

        if (cli['dry-run']) {
            console.log('Dry run - resolved input:');
            console.log(JSON.stringify(input, null, 2));
            await Actor.exit();
            return;
        }

        const userAgent = pickUserAgent(input.userAgent);
        const proxyConf = input.proxyConfiguration ? await Actor.createProxyConfiguration({ ...input.proxyConfiguration }) : undefined;

        let itemCount = 0;
        let totalRequests = 0;
    const seenUrls = input.dedupe ? new Set() : null;

        log.info('Starting TheMuse API crawler', { category: input.category, maxItems: input.maxItems, concurrency: input.concurrency });

        const httpCrawler = new HttpCrawler({
            proxyConfiguration: proxyConf,
            maxRequestRetries: 6,
            useSessionPool: true,
            maxConcurrency: input.concurrency,
            requestHandlerTimeoutSecs: 90,
            async requestHandler({ request, response, body, enqueueLinks, log: crawlerLog, session, responseBody }) {
                // Respect item limit (treat maxItems === 0 as unlimited)
                if (input.maxItems > 0 && itemCount >= input.maxItems) {
                    crawlerLog.info('Reached maxItems limit; skipping request', { url: request.url });
                    return;
                }

                // polite delay with jitter + human-like reading time + simulated network latency
                const baseDelay = randomInt(input.minDelayMs, input.maxDelayMs);
                const networkLatency = randomInt(20, 180); // simulate small network latency

                totalRequests++;

                // handle response status
                const status = response && response.statusCode ? response.statusCode : null;
                if (status && (status === 429 || status >= 500)) {
                    // Let the crawler's retry mechanism handle it; log and bail for this run
                    crawlerLog.warning('Server returned error status; letting retry handle it', { status, url: request.url });
                    throw new Error(`Bad status ${status}`);
                }

                // additional small random session rotation to avoid long-lived sessions
                try {
                    if (session && Math.random() < 0.12 && typeof session.retire === 'function') {
                        crawlerLog.info('Occasionally retiring session to rotate', { sessionId: session.id });
                        // retire so session pool hands out a new one next time
                        session.retire();
                    }
                } catch (e) {
                    crawlerLog.debug('Session retire attempt failed', { error: e.message });
                }

                let data;
                try {
                    data = JSON.parse(body.toString());
                } catch (e) {
                    crawlerLog.error('Failed to parse JSON response', { url: request.url, error: e.message });
                    return;
                }

                const jobs = data.results || [];
                const currentPage = data.page || Number(new URL(request.url).searchParams.get('page')) || 1;
                crawlerLog.info(`Page ${currentPage} returned ${jobs.length} jobs`);

                // simulate reading time proportional to number of jobs + base/network delay
                const readTime = randomInt(600, 1800) + (jobs.length * randomInt(30, 80));
                const totalPreProcessDelay = baseDelay + networkLatency + readTime;
                crawlerLog.debug('Sleeping to simulate human reading and latency', { ms: totalPreProcessDelay });
                await sleep(totalPreProcessDelay);

                if (!jobs || jobs.length === 0) {
                    crawlerLog.info('No jobs on this page. Stopping pagination for this variant.');
                    return;
                }

                for (const job of jobs) {
                    if (input.maxItems > 0 && itemCount >= input.maxItems) break;
                    const out = {
                        id: job.id,
                        title: job.name,
                        company: job.company && job.company.name,
                        location: (job.locations || []).map(l => l.name).join(', '),
                        date_posted: job.publication_date,
                        job_type: job.type,
                        job_category: (job.categories || []).map(c => c.name).join(', '),
                        job_url: job.refs && job.refs.landing_page,
                        // also include `url` for dataset schema compatibility
                        url: job.refs && job.refs.landing_page,
                        description_html: job.contents,
                        raw: job,
                    };
                    await Dataset.pushData(out);
                    itemCount++;
                }

                // Paginate (respect maxItems; maxItems === 0 means unlimited)
                if ((input.maxPages === 0 || currentPage < input.maxPages) && (input.maxItems === 0 || itemCount < input.maxItems) && jobs.length > 0) {
                    const nextPage = currentPage + 1;
                    const nextUrl = new URL(request.url);
                    nextUrl.searchParams.set('page', String(nextPage));
                    await httpCrawler.addRequests([{ url: nextUrl.href }]);
                }
            },
            async failedRequestHandler({ request, log: crawlerLog }) {
                crawlerLog.error(`Request ${request.url} failed too many times.`);
            },
            prepareRequestFunction: ({ request, session }) => {
                request.headers = request.headers || {};
                // Ensure no DNT header and no obvious bot headers
                delete request.headers['dnt'];
                // User-Agent and accept
                request.headers['user-agent'] = userAgent;
                request.headers['accept'] = 'application/json, text/javascript, */*; q=0.01';
                request.headers['accept-language'] = 'en-US,en;q=0.9';

                // Build client hints consistent with UA
                const ch = buildClientHintsFromUA(userAgent);
                request.headers['sec-ch-ua'] = ch['sec-ch-ua'];
                request.headers['sec-ch-ua-mobile'] = ch['sec-ch-ua-mobile'];
                request.headers['sec-ch-ua-platform'] = ch['sec-ch-ua-platform'];

                // realistic referer chain: if session has lastUrl, use it; otherwise a plausible search listing origin
                try {
                    const variant = request.userData && request.userData.variant ? request.userData.variant : null;
                    const refererBase = variant ? `https://www.themuse.com/search/category/${encodeURIComponent(variant.replace(/\s+/g, '_'))}` : 'https://www.themuse.com/';
                    // if session remembers lastUrl, use it; else use base listing
                    if (session && session.id && session.userData && session.userData.lastUrl) {
                        request.headers['referer'] = session.userData.lastUrl;
                    } else {
                        request.headers['referer'] = `${refererBase}?utm_source=browser`;
                    }
                    // store current intended url as next referer for this session
                    if (session) {
                        session.userData = session.userData || {};
                        session.userData.lastUrl = request.url;
                    }
                } catch (e) {
                    // ignore referer setting errors
                }

                // Some sites expect a realistic connection header; do not add suspicious headers like DNT
                request.headers['sec-fetch-site'] = 'same-origin';
                request.headers['sec-fetch-mode'] = 'navigate';
                request.headers['sec-fetch-user'] = '?1';
                request.headers['sec-fetch-dest'] = 'document';

                return request;
            },
        });

        // Build start URLs: check for explicit startUrl, or construct from keyword/location/datePosted
        let rawStartUrls = actorInput.startUrls || cli.startUrls || process.env.START_URLS || null;
        
        // Support single startUrl
        if (!rawStartUrls && (input.startUrl || actorInput.startUrl)) {
            rawStartUrls = input.startUrl || actorInput.startUrl;
        }
        
        // If no explicit URL, construct one from keyword/location/datePosted
        if (!rawStartUrls && (input.keyword || input.location || input.datePosted)) {
            const parts = ['https://www.themuse.com/search'];
            if (input.keyword) parts.push('keyword', encodeURIComponent(input.keyword.trim().replace(/\s+/g, '-').toLowerCase()));
            if (input.location) parts.push('location', encodeURIComponent(input.location.trim().replace(/\s+/g, '-').toLowerCase()));
            if (input.datePosted) parts.push('date-posted', encodeURIComponent(input.datePosted));
            const constructedUrl = parts.join('/');
            rawStartUrls = constructedUrl;
            log.info('Constructed search URL from keyword/location/datePosted', { url: constructedUrl });
        }
        
        let explicitStartUrls = [];
        if (rawStartUrls) {
            if (Array.isArray(rawStartUrls)) explicitStartUrls = rawStartUrls;
            else if (typeof rawStartUrls === 'string') {
                // allow comma-separated list
                explicitStartUrls = rawStartUrls.split(',').map(s => s.trim()).filter(Boolean);
            }
        }

        if (explicitStartUrls.length > 0) {
            log.info('Start URLs provided; running CheerioCrawler on explicit URLs', { count: explicitStartUrls.length });
            // Prepare cookies header if provided
            let cookieHeader = null;
            if (input.cookies) cookieHeader = input.cookies;
            else if (input.cookiesJson) {
                try {
                    const cj = JSON.parse(input.cookiesJson);
                    if (Array.isArray(cj)) {
                        cookieHeader = cj.map(c => `${c.name}=${c.value}`).join('; ');
                    } else if (typeof cj === 'object') {
                        cookieHeader = Object.entries(cj).map(([k, v]) => `${k}=${v}`).join('; ');
                    }
                } catch (e) {
                    log.warning('cookiesJson could not be parsed as JSON; ignoring', { err: e.message });
                }
            }

            // If collectDetails is enabled, create a detail crawler to fetch job pages
            let detailCrawler = null;
            if (input.collectDetails) {
                detailCrawler = new CheerioCrawler({
                    proxyConfiguration: proxyConf,
                    maxConcurrency: Math.max(1, Math.floor(input.concurrency / 2)),
                    requestHandlerTimeoutSecs: 60,
                    async requestHandler({ request, $, log: dLog }) {
                        try {
                            // Try JSON-LD on detail page first
                            const scriptEls = $('script[type="application/ld+json"]').toArray();
                            let pushed = false;
                            for (const el of scriptEls) {
                                try {
                                    const json = JSON.parse($(el).text());
                                    const items = Array.isArray(json) ? json : [json];
                                    for (const it of items) {
                                        if (!it) continue;
                                        if (it['@type'] === 'JobPosting' || (it['@type'] && it['@type'].toLowerCase().includes('job'))) {
                                            const out = {
                                                id: it.identifier || it.url || request.url,
                                                title: it.title || it.name || $('h1').first().text().trim() || null,
                                                company: it.hiringOrganization && (it.hiringOrganization.name || null) || null,
                                                location: Array.isArray(it.jobLocation) ? it.jobLocation.map(l => l.address && l.address.addressLocality).filter(Boolean).join(', ') : (it.jobLocation && it.jobLocation.address && it.jobLocation.address.addressLocality) || null,
                                                date_posted: it.datePosted || it.postedAt || null,
                                                job_type: it.employmentType || null,
                                                job_category: null,
                                                job_url: it.url || it.sameAs || request.url,
                                                url: it.url || it.sameAs || request.url,
                                                description_html: it.description || $('article').html() || null,
                                                raw: it
                                            };
                                            if (!seenUrls || !seenUrls.has(out.url)) {
                                                await Dataset.pushData(out);
                                                if (seenUrls) seenUrls.add(out.url);
                                            }
                                            pushed = true;
                                            itemCount++;
                                            if (input.maxItems > 0 && itemCount >= input.maxItems) return;
                                        }
                                    }
                                } catch (e) {
                                    // ignore parse errors of json-ld
                                }
                            }

                            if (!pushed) {
                                // fallback parsing
                                const out = {
                                    id: request.url,
                                    title: $('h1').first().text().trim() || null,
                                    company: $('meta[name="author"]').attr('content') || null,
                                    location: null,
                                    date_posted: null,
                                    job_type: null,
                                    job_category: null,
                                    job_url: request.url,
                                    url: request.url,
                                    description_html: $('article').html() || $('body').text().slice(0, 2000) || null,
                                    raw: null
                                };
                                if (!seenUrls || !seenUrls.has(out.url)) {
                                    await Dataset.pushData(out);
                                    if (seenUrls) seenUrls.add(out.url);
                                }
                                itemCount++;
                            }
                        } catch (e) {
                            dLog.error('Detail page parse failed', { url: request.url, error: e.message });
                        }
                    },
                    prepareRequestFunction: ({ request }) => {
                        request.headers = request.headers || {};
                        request.headers['user-agent'] = userAgent;
                        if (cookieHeader) request.headers['cookie'] = cookieHeader;
                        return request;
                    }
                });
            }

            const cheerioListingCrawler = new CheerioCrawler({
                proxyConfiguration: proxyConf,
                maxConcurrency: Math.max(1, Math.floor(input.concurrency)),
                requestHandlerTimeoutSecs: 90,
                async requestHandler({ request, $, response, log: cLog, session }) {
                    // Respect item limit
                    if (input.maxItems > 0 && itemCount >= input.maxItems) return;

                    cLog.info('Processing HTML listing', { url: request.url });

                    // Try JSON-LD first
                    const pushed = new Set();
                    try {
                        const scriptEls = $('script[type="application/ld+json"]').toArray();
                        for (const el of scriptEls) {
                            if (input.maxItems > 0 && itemCount >= input.maxItems) break;
                            try {
                                const json = JSON.parse($(el).text());
                                const items = Array.isArray(json) ? json : [json];
                                for (const it of items) {
                                    if (!it) continue;
                                    if (it['@type'] === 'JobPosting' || (it['@type'] && it['@type'].toLowerCase().includes('job'))) {
                                        const out = {
                                            id: it.identifier || it.url || null,
                                            title: it.title || it.name || null,
                                            company: it.hiringOrganization && (it.hiringOrganization.name || it.hiringOrganization['@id']) || null,
                                            location: Array.isArray(it.jobLocation) ? it.jobLocation.map(l => l.address && l.address.addressLocality).filter(Boolean).join(', ') : (it.jobLocation && it.jobLocation.address && it.jobLocation.address.addressLocality) || null,
                                            date_posted: it.datePosted || it.postedAt || null,
                                            job_type: it.employmentType || null,
                                            job_category: null,
                                            job_url: it.url || it.sameAs || request.url,
                                            url: it.url || it.sameAs || request.url,
                                            description_html: it.description || null,
                                            raw: it
                                        };
                                        const key = out.job_url || out.id || out.title;
                                        if (!pushed.has(key)) {
                                            await Dataset.pushData(out);
                                            pushed.add(key);
                                            itemCount++;
                                            if (input.maxItems > 0 && itemCount >= input.maxItems) break;
                                        }
                                    }
                                }
                            } catch (e) {
                                // ignore malformed json-ld blocks
                            }
                        }
                    } catch (e) {
                        cLog.debug('Error while parsing JSON-LD', { error: e.message });
                    }

                    // If JSON-LD produced results, we may still want to look for links to job detail pages
                    // Generic anchor-based extraction as fallback
                    if (input.maxItems === 0 || itemCount < input.maxItems) {
                        const anchors = [];
                        $('a[href]').each((i, el) => {
                            if (input.maxItems > 0 && itemCount >= input.maxItems) return;
                            const href = $(el).attr('href');
                            if (!href) return;
                            // candidate job links
                            if (/\/jobs?\//i.test(href) || /\/job\//i.test(href) || /themuse\.com\/jobs\//i.test(href)) {
                                anchors.push({ href: href, text: $(el).text().trim() });
                            }
                        });

                        for (const a of anchors) {
                            if (input.maxItems > 0 && itemCount >= input.maxItems) break;
                            try {
                                const abs = new URL(a.href, request.loadedUrl || request.url).href;
                                // Avoid duplicates
                                if (seenUrls && seenUrls.has(abs)) continue;
                                if (input.collectDetails && detailCrawler) {
                                    // enqueue detail request
                                    await detailCrawler.addRequests([{ url: abs }]);
                                } else {
                                    const out = {
                                        id: abs,
                                        title: a.text || null,
                                        company: null,
                                        location: null,
                                        date_posted: null,
                                        job_type: null,
                                        job_category: null,
                                        job_url: abs,
                                        url: abs,
                                        description_html: null,
                                        raw: null
                                    };
                                    if (!seenUrls || !seenUrls.has(out.url)) {
                                        await Dataset.pushData(out);
                                        if (seenUrls) seenUrls.add(out.url);
                                    }
                                    itemCount++;
                                }
                            } catch (e) {
                                // ignore malformed urls
                            }
                        }
                    }

                    // Pagination: try rel=next, .next, aria-label next
                    if ((input.maxPages === 0 || (request.userData && (request.userData.page || 1) < input.maxPages)) && (input.maxItems === 0 || itemCount < input.maxItems)) {
                        let nextHref = null;
                        try {
                            const relNext = $('a[rel="next"]').attr('href');
                            if (relNext) nextHref = relNext;
                            if (!nextHref) {
                                const selNext = $('a.next, a[aria-label*="Next"], a[title*="Next"]').first().attr('href');
                                if (selNext) nextHref = selNext;
                            }
                        } catch (e) {
                            // ignore
                        }

                        if (nextHref) {
                            try {
                                const absNext = new URL(nextHref, request.loadedUrl || request.url).href;
                                await cheerioListingCrawler.addRequests([{ url: absNext, userData: { page: (request.userData && request.userData.page ? request.userData.page + 1 : 2) } }]);
                            } catch (e) {
                                // ignore
                            }
                        } else {
                            // As a fallback, if URL contains page=N, increment it
                            try {
                                const cur = new URL(request.url);
                                const curPage = Number(cur.searchParams.get('page')) || 1;
                                if (input.maxPages === 0 || curPage < input.maxPages) {
                                    cur.searchParams.set('page', String(curPage + 1));
                                    await cheerioListingCrawler.addRequests([{ url: cur.href, userData: { page: curPage + 1 } }]);
                                }
                            } catch (e) {
                                // ignore
                            }
                        }
                    }
                },
                prepareRequestFunction: ({ request, session }) => {
                    request.headers = request.headers || {};
                    request.headers['user-agent'] = userAgent;
                    request.headers['accept-language'] = 'en-US,en;q=0.9';
                    const ch = buildClientHintsFromUA(userAgent);
                    request.headers['sec-ch-ua'] = ch['sec-ch-ua'];
                    request.headers['sec-ch-ua-mobile'] = ch['sec-ch-ua-mobile'];
                    request.headers['sec-ch-ua-platform'] = ch['sec-ch-ua-platform'];
                    if (cookieHeader) request.headers['cookie'] = cookieHeader;
                    return request;
                }
            });

            const startRequests = explicitStartUrls.map(u => ({ url: u }));
            await cheerioListingCrawler.run(startRequests);
            
            // If collectDetails is enabled and we have a detailCrawler, run it now
            if (input.collectDetails && detailCrawler) {
                log.info('Running detail crawler to fetch full job pages', { pending: detailCrawler.requestQueue ? 'many' : 'unknown' });
                await detailCrawler.run();
            }
            
            log.info('Finished explicit HTML crawl', { saved: itemCount });
            // done
            await Actor.exit();
            return;
        }

        // Resolve category robustly: try direct candidates and sample API categories to find a best-fit
        let resolvedCategory = null;
        try {
            resolvedCategory = await tryResolveCategory(input.category, proxyConf, userAgent);
            if (resolvedCategory) log.info('Resolved category for API', { requested: input.category, resolved: resolvedCategory });
            else log.warning('Could not resolve exact category; will attempt variant runs', { requested: input.category });
        } catch (e) {
            log.debug('Category resolution failed', { error: e && e.message });
        }

        const startRequests = [];
        if (resolvedCategory) {
            const u = new URL(API_BASE_URL);
            u.searchParams.set('category', resolvedCategory);
            u.searchParams.set('page', '1');
            startRequests.push({ url: u.href, userData: { variant: resolvedCategory } });
        } else {
            // Build start URLs using category variants to handle case/casing differences
            const variants = generateCategoryVariants(input.category || '');
            for (const v of variants) {
                const u = new URL(API_BASE_URL);
                u.searchParams.set('category', v);
                u.searchParams.set('page', '1');
                startRequests.push({ url: u.href, userData: { variant: v } });
            }
        }

        // Run the HTTP crawler
        await httpCrawler.run(startRequests);

        // If no items saved and htmlFallback requested, try CheerioCrawler on the HTML pages as fallback
        if (itemCount === 0 && input.htmlFallback) {
            log.info('No items from API; attempting HTML fallback using CheerioCrawler');
            const cheerioCrawler = new CheerioCrawler({
                proxyConfiguration: proxyConf,
                maxConcurrency: Math.max(1, Math.floor(input.concurrency / 2)),
                requestHandlerTimeoutSecs: 60,
                async requestHandler({ request, $, log: cLog }) {
                    // Basic heuristic parsing: look for anchors linking to job landing pages
                    const links = [];
                    $('a[href]').each((i, el) => {
                        const href = $(el).attr('href');
                        if (!href) return;
                        // The Muse job pages often include '/jobs/' or '/job/' in URL; filter by that
                        if (/\/jobs?\//i.test(href)) {
                            links.push({ href: new URL(href, request.loadedUrl || request.url).href, text: $(el).text().trim() });
                        }
                    });

                    cLog.info(`Found ${links.length} candidate job links on ${request.url}`);
                    for (const ln of links) {
                        await Dataset.pushData({ source: 'html_fallback', title: ln.text, url: ln.href });
                        itemCount++;
                        if (itemCount >= input.maxItems) break;
                    }
                },
                prepareRequestFunction: ({ request }) => {
                    request.headers = request.headers || {};
                    request.headers['user-agent'] = userAgent;
                    return request;
                }
            });

            // generate HTML listing pages
            const htmlStartRequests = [];
            for (const v of variants) {
                const base = `https://www.themuse.com/search/category/${encodeURIComponent(v.replace(/\s+/g, '_'))}`;
                htmlStartRequests.push({ url: `${base}?page=1` });
            }

            await cheerioCrawler.run(htmlStartRequests);
        }

        log.info('Crawl finished', { total_saved: itemCount, total_requests: totalRequests });
    } finally {
        await Actor.exit();
    }
}

// Run and handle unexpected errors
main().catch(err => {
    log.error('An unexpected error occurred during the crawl.', { message: err.message, stack: err.stack });
    process.exit(1);
});
