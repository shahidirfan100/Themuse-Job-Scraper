# TheMuse Job Scraper

## Description

A professional-grade scraper for extracting job listings from TheMuse.com. This actor leverages the public jobs API to collect job data efficiently, with options for detailed enrichment and customizable filtering.

## Features

- **API-Based Scraping**: Directly queries the public jobs API for reliable data extraction.
- **Flexible Input Options**: Supports start URLs, keywords, categories, locations, and date filters.
- **Detail Enrichment**: Optionally fetches full job descriptions and metadata.
- **Deduplication**: Removes duplicate entries based on job ID.
- **Proxy Support**: Includes anti-blocking measures with proxy configuration.
- **Clean Output**: Normalized dataset with structured fields for easy analysis.

## Input

Configure the actor using the following input fields. All fields are optional unless specified.

| Field | Type | Description | Default |
|-------|------|-------------|---------|
| `startUrl` | string | Specific TheMuse listing URL to start scraping from | - |
| `keyword` | string | Job search keyword | - |
| `category` | string | Job category filter (e.g., "Software Engineering") | - |
| `location` | string | Location filter | - |
| `datePosted` | enum | Date filter: `last_7d`, `last_30d`, `last_month` | "" |
| `collectDetails` | boolean | Fetch full job details | `true` |
| `maxItems` | integer | Maximum number of jobs to collect (0 = unlimited) | `100` |
| `maxPages` | integer | Maximum pages to paginate (0 = unlimited) | `20` |
| `dedupe` | boolean | Remove duplicate job IDs | `true` |
| `cookies` | string | Raw Cookie header for authentication | - |
| `cookiesJson` | string | JSON-formatted cookies | - |
| `proxyConfiguration` | object | Proxy configuration for anti-blocking | Residential |

### Input Examples

<details>
<summary>Basic Keyword Search</summary>

```json
{
  "keyword": "software engineer",
  "location": "New York, NY",
  "maxItems": 50
}
```

</details>

<details>
<summary>Category and Date Filter</summary>

```json
{
  "category": "Data Science",
  "datePosted": "last_30d",
  "collectDetails": true
}
```

</details>

<details>
<summary>Start URL Example</summary>

```json
{
  "startUrl": "https://www.themuse.com/search/keyword/developer",
  "maxItems": 100
}
```

</details>

## Output

The actor outputs a dataset of job records. Each record is a JSON object with the following structure:

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
  "raw": { /* Original API payload */ }
}
```

## Usage

### On Apify Platform

1. Deploy this repository as an Apify Actor.
2. Configure input parameters via the Apify Console UI.
3. Run the actor and download results from the Dataset.

### Scraping Strategy

1. Construct API request parameters from input filters or start URL.
2. Paginate through the jobs API until limits are reached.
3. Optionally enrich jobs with detail API calls.
4. Output normalized records to the dataset.

## Configuration

- **Proxy Settings**: Use residential proxies for better success rates.
- **Rate Limiting**: Adjust delays if encountering blocks.
- **Cookies**: Provide if site requires consent.

## API Endpoints

- Jobs List: `https://www.themuse.com/api/public/jobs`
- Job Details: `https://www.themuse.com/api/public/jobs/:id`

## Limitations

- Dependent on TheMuse API availability.
- Rate limits may apply; use proxies to mitigate.
- Some jobs may not have full details if API changes.

## Troubleshooting

**No Results Found?**
- Verify filter values match TheMuse labels.
- Use a start URL from the site.
- Increase `maxPages` or `maxItems`.

**Rate Limiting or Blocks?**
- Enable proxy configuration.
- Provide cookies if needed.

**Missing Descriptions?**
- Ensure `collectDetails` is enabled.
- Check if landing page is accessible.

## Support

For issues or requests, check repository issues or contact the maintainer.



