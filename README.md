# TheMuse Job Scraper (Apify + Crawlee)

Professional-grade Apify Actor for scraping job listings from TheMuse.com with multiple scraping methods and advanced anti-blocking protection.

## Key Features

✅ **Multiple Scraping Methods** (automatic fallback):
- Public JSON API (preferred, fastest)
- JSON-LD structured data extraction
- HTML parsing with Cheerio
- Optional job detail page collection

✅ **Advanced Anti-Blocking** (stealth mode enabled):
- Latest browser UA + client hint headers (Oct 2025)
- Human-like delays with random jitter
- Network latency simulation
- Aggressive session rotation
- Realistic referer chains
- No bot signatures (DNT header removed)
- Lower concurrency for natural pacing

✅ **Flexible Input Options**:
- Direct URL scraping (e.g., `https://www.themuse.com/search/keyword/admin/date-posted/last_7d`)
- Keyword/location/category filters
- Date-posted filtering (last_7d, last_30d, etc.)
- Optional job detail collection for full descriptions

## Input Configuration

### Primary Options (choose one):

1. **Start URL** (recommended for specific searches):
   ```json
   {
     "startUrl": "https://www.themuse.com/search/keyword/admin/date-posted/last_7d",
     "maxItems": 100,
     "collectDetails": true
   }
   ```

2. **Keyword + Filters** (builds URL automatically):
   ```json
   {
     "keyword": "software engineer",
     "location": "Remote",
     "datePosted": "last_7d",
     "maxItems": 100,
     "collectDetails": true
   }
   ```

3. **Category** (API-based, fallback):
   ```json
   {
     "category": "Software Engineering",
     "maxItems": 200,
     "collectDetails": false
   }
   ```

### All Input Fields:

| Field | Type | Description | Default |
|-------|------|-------------|---------|
| `startUrl` | string | Specific TheMuse listing URL | - |
| `keyword` | string | Job search keyword | - |
| `location` | string | Location filter | - |
| `category` | string | API category filter | "Software Engineering" |
| `datePosted` | enum | Date filter: `last_7d`, `last_30d`, `last_month` | "" |
| `collectDetails` | boolean | Fetch full job detail pages | `true` |
| `maxItems` | integer | Max jobs to collect (0 = unlimited) | `100` |
| `maxPages` | integer | Max pages to paginate (0 = unlimited) | `20` |
| `dedupe` | boolean | Remove duplicate URLs | `true` |
| `concurrency` | integer | Concurrent requests (1-10) | `2` |
| `minDelayMs` | integer | Min delay between requests | `300` |
| `maxDelayMs` | integer | Max delay between requests | `700` |
| `userAgent` | string | Custom user-agent override | (auto-rotated) |
| `cookies` | string | Raw Cookie header | - |
| `cookiesJson` | string | JSON cookies (array/object) | - |
| `proxyConfiguration` | object | Apify Proxy config | Residential |
| `htmlFallback` | boolean | Try HTML if API fails | `false` |

## Output Format

Each job record includes:

```json
{
  "id": "12345",
  "title": "Senior Software Engineer",
  "company": "Example Corp",
  "location": "New York, NY",
  "date_posted": "2025-10-20",
  "job_type": "Full-time",
  "job_category": "Software Engineering",
  "url": "https://www.themuse.com/jobs/examplecorp/senior-software-engineer",
  "job_url": "https://www.themuse.com/jobs/examplecorp/senior-software-engineer",
  "description_html": "<div>Full job description...</div>",
  "raw": { /* Original API/JSON-LD data */ }
}
```

## Running Locally

```powershell
# Install dependencies
npm ci

# Dry-run to check config
node src/main.js --dry-run

# Run with keyword
node src/main.js --keyword "admin" --datePosted "last_7d" --maxItems 50

# Run with URL
node src/main.js --startUrl "https://www.themuse.com/search/keyword/developer" --maxItems 100

# Environment variables
$env:KEYWORD = "software engineer"
$env:MAX_ITEMS = "200"
$env:COLLECT_DETAILS = "true"
node src/main.js
```

## Apify Platform

1. Deploy this repository as an Apify Actor
2. Configure input via the Apify Console UI
3. Run and download results from the Dataset

## Scraping Strategy

The actor intelligently selects the best scraping method:

1. **If `startUrl` or `keyword` provided**: Uses Cheerio HTML crawler with:
   - JSON-LD extraction (primary)
   - Anchor-based link extraction (fallback)
   - Optional detail page fetching

2. **If only `category` provided**: Uses HTTP API crawler:
   - Direct API calls to `https://www.themuse.com/api/public/jobs`
   - Automatic category variant resolution
   - Falls back to HTML if API returns empty results

3. **Detail Collection** (when `collectDetails: true`):
   - Fetches individual job pages
   - Extracts full description and metadata
   - Uses JSON-LD when available

## Anti-Blocking Measures

✅ User-Agent rotation (Chrome, Safari, Firefox)  
✅ Client hint headers matching UA version  
✅ Random delays (300-700ms + reading time + latency)  
✅ Session pool with occasional rotation  
✅ Realistic referer chains  
✅ No DNT header or other bot signatures  
✅ Lower concurrency (default: 2)  
✅ Exponential backoff on errors  

## Apify QA Compliance

✅ Valid `input_schema.json` with all fields documented  
✅ `dataset_schema.json` defines output structure  
✅ `.actor/actor.json` references all config files  
✅ Dockerfile with Node 22 runtime  
✅ Proper error handling and logging  
✅ Respects Apify SDK patterns (Actor.init/exit, Dataset, ProxyConfiguration)  

## Troubleshooting

**No results found?**
- Check that `category` exactly matches API categories (use "Account Management" not "account_management")
- Try using `startUrl` or `keyword` instead of `category`
- Enable `htmlFallback: true` for additional resilience

**Rate limiting or blocks?**
- Increase delays: `minDelayMs: 500, maxDelayMs: 1500`
- Lower concurrency: `concurrency: 1`
- Enable residential proxies (already default)

**Missing job descriptions?**
- Enable `collectDetails: true` to fetch full detail pages
- Check that the job URL is accessible

## Support

For issues or feature requests, check the repository issues or contact the maintainer.