

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
            category: process.env.CATEGORY || cli.category || actorInput.category || 'Software Engineering',
            maxItems: Number(process.env.MAX_ITEMS || cli.maxItems || actorInput.maxItems || 200),
            maxPages: Number(process.env.MAX_PAGES || cli.maxPages || actorInput.maxPages || 0), // 0 = unlimited until empty
            userAgent: process.env.USER_AGENT || cli.userAgent || actorInput.userAgent,
            minDelayMs: Number(process.env.MIN_DELAY_MS || cli.minDelayMs || actorInput.minDelayMs || 300),
            maxDelayMs: Number(process.env.MAX_DELAY_MS || cli.maxDelayMs || actorInput.maxDelayMs || 700),
            concurrency: Number(process.env.CONCURRENCY || cli.concurrency || actorInput.concurrency || 2),
            proxyConfiguration: actorInput.proxyConfiguration || undefined,
            htmlFallback: (process.env.HTML_FALLBACK || cli.htmlFallback || actorInput.htmlFallback) || false,
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

        // Build start URLs using category variants to handle case/casing differences
        const variants = generateCategoryVariants(input.category || '');
        const startRequests = [];
        for (const v of variants) {
            const u = new URL(API_BASE_URL);
            u.searchParams.set('category', v);
            u.searchParams.set('page', '1');
            startRequests.push({ url: u.href, userData: { variant: v } });
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
