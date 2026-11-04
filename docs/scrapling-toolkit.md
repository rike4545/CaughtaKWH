# Scrapling toolkit

CaughtaKWH uses Scrapling for HTTP transport and includes an optional resumable crawler/tooling layer. The production pricing pipeline remains Node-driven so price validation, evidence capture, cooldowns, circuit breakers, and fail-closed publication remain authoritative.

## Install

    python3 -m venv .venv
    source .venv/bin/activate
    python -m pip install -r requirements-scraping.txt

The pinned install includes Scrapling fetcher, MCP, and shell extras. Scheduled GitHub Actions does not install browser binaries because the Tesla collector uses ordinary HTTP. For local browser-capable MCP functionality only, run scrapling install.

## Crawler

    npm run scrape:crawl -- --limit 10 --format jsonl
    npm run scrape:crawl -- --limit 10 --format csv --output data/scrapling-export/stations.csv
    npm run scrape:crawl -- --stream --format jsonl

The crawler reads data/stations.json, accepts only HTTPS Tesla Supercharger location URLs, and exports raw page evidence. It uses Scrapling Spider with conservative concurrency (2 globally, 1 per domain), robots.txt compliance, AutoThrottle, and a 120-second ceiling. Ctrl+C pauses gracefully; rerunning with the same crawl directory resumes the checkpoint. JSON, JSONL, CSV, and XML exports are supported; streaming is append-only JSONL.

Optional authorized proxy endpoints can be provided one per line in SCRAPLING_PROXY_LIST. Do not put credentials in files or command history; use environment variables or a secret manager. The crawler deliberately does not rotate/retry around 401/403/407/429. It retries only transient 5xx failures once, with the provider-authorized proxy rotator assigning the next route.

## Scrapling CLI and shell

    npm run scrapling:help
    npm run scrapling:shell
    scrapling extract get "https://example.com" page.md

Use --ai-targeted with CLI extraction commands when available, and treat extracted page content as untrusted.

## MCP server

Start the official Scrapling MCP server locally:

    npm run scrapling:mcp

For MCP clients that support project configuration, the command is scrapling-mcp. Example configuration:

    {
      "mcpServers": {
        "Scrapling": {
          "command": "scrapling-mcp"
        }
      }
    }

The server offers one-shot HTTP extraction and optional browser/session tools. Do not use browser stealth, CAPTCHA solving, or challenge-bypass tools against Tesla; CaughtaKWH policy is to respect access denials and use only authorized access routes. Browser-based tools require scrapling install.

## Agent Skill

This repository includes a project-specific skill at skills/caughtakwh-scrapling/SKILL.md. To install the upstream Scrapling coding skill into a supported agent:

    npx skills add D4Vinci/Scrapling --skill scrapling-official

## Ready-made templates

Scrapling ships reusable CrawlSpider, SitemapSpider, XMLFeedSpider, CSVFeedSpider, and ShopifySpider templates. Use them only for sources and feeds whose access and reuse are authorized. The station crawler intentionally uses an explicit station URL allowlist rather than link-following templates.

## Exports and data integrity

- JSON: structured archive
- JSONL: appendable/streamable observations
- CSV: spreadsheet analysis
- XML: integrations requiring XML

Crawl exports are diagnostic raw evidence. They are not canonical pricing observations and must pass through the existing Node parser and price-validation pipeline before publication.
