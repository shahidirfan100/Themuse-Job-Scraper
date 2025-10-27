# TheMuse Job Scraper (Apify + Crawlee)

Professional-grade Apify Actor for scraping job listings from TheMuse.com via the public jobs API with optional detail enrichment.

## Key Features

- **Public API First** – queries `https://www.themuse.com/api/public/jobs` directly with pagination and retries.
- **Smart URL Handling** – accepts `/search/...` pages, converts them into API parameters, and supports direct filters.
- **Detail Enrichment** – optional calls to `https://www.themuse.com/api/public/jobs/:id` for full descriptions and metadata.
- **Clean Dataset Output** – deduplicated by job id with normalized fields and helper text output for analytics.

## Input Configuration

### Primary Options (choose one):

1. **Start URL** (recommended for specific searches):
   ```json
{
  "source": "api",
  "job_id": 12345,
  "title": "Senior Software Engineer",
  "company": "Example Corp",
  "location": "New York, NY",
  "categories": ["Software Engineering"],
  "job_category": "Software Engineering",
  "job_type": "Full-time",
  "publication_date": "2025-10-20T12:00:00Z",
  "date_posted": "2025-10-20T12:00:00Z",
  "url": "https://www.themuse.com/jobs/examplecorp/senior-software-engineer",
  "landing_page": "https://www.themuse.com/jobs/examplecorp/senior-software-engineer",
  "api_url": "https://www.themuse.com/api/public/jobs/12345",
  "description_html": "<div>Full job description...</div>",
  "description_text": "Full job description...",
  "raw": { /* Original API detail payload */ }
}
```

2. **Keyword + Filters** (builds API query automatically):
   ```json
{
  "source": "api",
  "job_id": 12345,
  "title": "Senior Software Engineer",
  "company": "Example Corp",
  "location": "New York, NY",
  "categories": ["Software Engineering"],
  "job_category": "Software Engineering",
  "job_type": "Full-time",
  "publication_date": "2025-10-20T12:00:00Z",
  "date_posted": "2025-10-20T12:00:00Z",
  "url": "https://www.themuse.com/jobs/examplecorp/senior-software-engineer",
  "landing_page": "https://www.themuse.com/jobs/examplecorp/senior-software-engineer",
  "api_url": "https://www.themuse.com/api/public/jobs/12345",
  "description_html": "<div>Full job description...</div>",
  "description_text": "Full job description...",
  "raw": { /* Original API detail payload */ }
}
```

3. **API filters only**:
   ```json
   {
     "category": "Software Engineering",
     "maxItems": 200
   }
   ```

### All Input Fields:
| Field | Type | Description | Default |
|-------|------|-------------|---------|
| `startUrl` | string | Specific TheMuse listing URL | - |
| `keyword` | string | Job search keyword | - |
| `category` | string | API category filter (e.g., `Software Engineering`) | - |
| `location` | string | Location filter | - |
| `datePosted` | enum | Date filter: `last_7d`, `last_30d`, `last_month` | `""` |
| `collectDetails` | boolean | Fetch full job detail pages | `true` |
| `maxItems` | integer | Max jobs to collect (0 = unlimited) | `100` |
| `maxPages` | integer | Max pages to paginate (0 = unlimited) | `20` |
| `dedupe` | boolean | Remove duplicate job ids | `true` |
| `cookies` | string | Raw Cookie header | - |
| `cookiesJson` | string | JSON cookies (array/object) | - |
| `proxyConfiguration` | object | Apify Proxy config | Residential |
## Output Format

Each job record includes:

```json
{
  "source": "api",
  "job_id": 12345,
  "title": "Senior Software Engineer",
  "company": "Example Corp",
  "location": "New York, NY",
  "categories": ["Software Engineering"],
  "job_category": "Software Engineering",
  "job_type": "Full-time",
  "publication_date": "2025-10-20T12:00:00Z",
  "date_posted": "2025-10-20T12:00:00Z",
  "url": "https://www.themuse.com/jobs/examplecorp/senior-software-engineer",
  "landing_page": "https://www.themuse.com/jobs/examplecorp/senior-software-engineer",
  "api_url": "https://www.themuse.com/api/public/jobs/12345",
  "description_html": "<div>Full job description...</div>",
  "description_text": "Full job description...",
  "raw": { /* Original API detail payload */ }
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

1. Build API request parameters from `startUrl` (converted) or the provided filters.
2. Page through `https://www.themuse.com/api/public/jobs` until `maxItems` or `maxPages` is reached, respecting rate limits.
3. Optionally enrich each job via `https://www.themuse.com/api/public/jobs/:id` when `collectDetails` is enabled.
4. Write normalized items into the default dataset (with the overview view defined in `.actor/dataset_schema.json`).

## Anti-Blocking Measures

- Rotates a realistic desktop User-Agent and matching Client Hints.
- Randomized inter-request delays and retry with incremental backoff.
- Optional Apify residential proxy support via `proxyConfiguration`.
- Cookie injection hooks for markets that need consent bypassing.


## Apify QA Compliance

- Input schema exposes every supported filter with defaults and descriptions.
- Dataset view summarises the most important columns for quick inspection.
- README documents usage, inputs, outputs, CLI examples, and troubleshooting.
- Graceful logging and error handling built on `Actor.main` and Apify SDK patterns.
- Optional proxy configuration presented via the UI, per Apify Store guidelines.

## Troubleshooting

**No results found?**
- Confirm the filter values (e.g., `category`) match the labels used on TheMuse.
- Try providing a `startUrl` copied from the site to verify the search works in the API.
- Relax `maxPages`/`maxItems` if they are set to very small numbers.

**Rate limiting or blocks?**
- Increase delays with environment variables (`MIN_DELAY_MS`, `MAX_DELAY_MS`).
- Run on Apify with an enabled proxy group (RESIDENTIAL by default in the UI).
- Provide cookies if the site requires consent before serving the API.

**Missing job descriptions?**
- Ensure `collectDetails` is enabled so the detail API endpoint is called.
- Verify the landing page responds with HTTP 200 when opened manually.

## Support

For issues or feature requests, check the repository issues or contact the maintainer.



