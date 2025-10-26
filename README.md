# TheMuse Job Scraper (Apify + Crawlee)

Lightweight Apify Actor that scrapes job listings from TheMuse.com using the site's public JSON API (preferred) with a Cheerio HTML fallback. Designed for polite scraping with session rotation, UA/client-hints consistency, and human-like pacing.

Key points:
- Primary: use the public API at `https://www.themuse.com/api/public/jobs` for speed and reliability.
- Fallback: `CheerioCrawler` parses HTML listing pages when API returns no results (optional).
- No Playwright required.

Inputs (actor input / environment variables / CLI):
- `category` (string) — job category to query (default: "Software Engineering").
- `maxItems` (integer) — max jobs to collect (0 = unlimited, default: 200).
- `maxPages` (integer) — max pages to paginate (0 = unlimited, default: 0).
- `concurrency` (integer) — concurrent HTTP requests (default: 2).
- `minDelayMs` / `maxDelayMs` (integer) — polite delay jitter window (defaults: 300 / 700).
- `userAgent` (string) — optional override for UA.
- `htmlFallback` (boolean) — try Cheerio HTML parsing when API yields no results.
- `proxyConfiguration` — Apify proxy object if you want to use Apify Proxy.

Run locally (if dependencies installed) or on Apify platform:

PowerShell example:
```powershell
$env:CATEGORY = 'Account Management'
$env:MAX_ITEMS = '200'
node src/main.js
```

CLI example:
```powershell
node src/main.js --category "Account Management" --maxItems 200 --htmlFallback true
```

Output (dataset): each item includes fields like `id`, `title`, `company`, `location`, `job_type`, `job_category`, `date_posted`, `url`, `description_html` and `raw` (full API object).

Notes for Apify QA:
- The actor manifest `.actor/actor.json` references `input_schema.json` and `dataset_schema.json` (both present).
- The Dockerfile exists and installs the Node runtime.
- Input schema and dataset schema were aligned with the runtime. The script also supports `--help` and `--dry-run` for quick checks.

If you want, I can add a simple integration test that loads a saved sample API JSON and verifies parsing.