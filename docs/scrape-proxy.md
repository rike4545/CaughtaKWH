# Scrape proxy setup

Tesla's Supercharger pages are protected by Akamai bot detection, which blocks
requests coming from GitHub Actions runner IP ranges. Without a proxy, the
automated price scrapers almost always get an `access_controlled` result and
capture no prices — the dataset then depends entirely on crowdsourced reports.

Routing the scrapers through a reputable egress proxy (residential or a
well-maintained datacenter pool) is the single biggest lever for restoring
automated coverage.

## How it's wired

`scripts/scrapePrices.mjs` reads three optional environment variables and, when
`SCRAPE_PROXY` is set, routes **both** the Playwright browser and Node's global
`fetch` through it (`configureProxy()`):

| Variable | Purpose |
| --- | --- |
| `SCRAPE_PROXY` | Proxy URL, e.g. `http://proxy.example.com:8080`. Credentials may be embedded (`http://user:pass@host:port`) or supplied separately. |
| `SCRAPE_PROXY_USERNAME` | Optional username (overrides any in the URL). |
| `SCRAPE_PROXY_PASSWORD` | Optional password (overrides any in the URL). |

When `SCRAPE_PROXY` is empty the code logs that it's using the runner IP
directly and behaves exactly as before — so adding these env vars to a workflow
is safe even before a proxy exists.

Block detection, per-station cooldowns (`BLOCK_COOLDOWN_*`), and the run-level
Akamai circuit breaker (`AKAMAI_CIRCUIT_BREAKER`) all stay in effect regardless
of the proxy.

## Enabling it

1. Obtain a proxy endpoint. Residential/ISP proxies pass Akamai most reliably;
   shared datacenter IPs are frequently pre-blocked.
2. In the repo: **Settings → Secrets and variables → Actions → New repository
   secret** and add:
   - `SCRAPE_PROXY` (required)
   - `SCRAPE_PROXY_USERNAME` / `SCRAPE_PROXY_PASSWORD` (if not embedded in the URL)
3. That's it — the workflows already reference these secrets. The next
   scheduled run of **Dynamic Tesla Pricing Refresh**, **Pricing Pilot Panel**,
   and **Update Supercharger Price Data** will route through the proxy.

## Verifying

After a run with the secret set, check a recently attempted station in
`data/stations.json`:

- `lastScrapeResult: "access_controlled"` → still being blocked (proxy IP is
  also flagged, or the proxy isn't being applied).
- `lastSuccessfulScrapeAt` populated, or `lastPriceCandidateCount > 0` → working.

If it's still blocked, try a different proxy pool (ideally residential) before
assuming a code issue.

## Cost and etiquette

Scrapes are rate-limited (`SCRAPE_DELAY_MS`) and capped per run
(`MAX_STATIONS` / `PRICE_SCRAPE_LIMIT`) to stay polite and keep proxy bandwidth
modest. Raising frequency or station counts increases proxy usage and the risk
of the proxy pool itself getting flagged — change those gradually.
