# Scrape proxy setup

Tesla's Supercharger pages are protected by Akamai bot detection, which blocks
requests coming from GitHub Actions runner IP ranges. Without a proxy, the
automated price scrapers almost always get an `access_controlled` result and
capture no prices — the dataset then depends entirely on crowdsourced reports.

Routing the scrapers through a reputable egress proxy (residential or a
well-maintained datacenter pool) is the single biggest lever for restoring
automated coverage.

## How it's wired

`scripts/proxyPool.mjs` gathers proxy candidates from the env vars below,
health-checks them, and `scripts/scrapePrices.mjs` routes **both** the Playwright
browser and Node's global `fetch` through the first one that connects.

| Variable | Purpose |
| --- | --- |
| `SCRAPE_PROXY` | A single proxy, e.g. `http://proxy.example.com:8080`. Credentials may be embedded (`http://user:pass@host:port`) or supplied separately. Bare `ip:port` is also accepted (assumed `http://`). |
| `SCRAPE_PROXY_LIST` | Multiple proxies, comma/space/newline separated. Used for rotation/failover. |
| `SCRAPE_PROXY_LIST_URL` | A URL returning a proxy list — plain `ip:port` lines, proxy URLs, or JSON (`["ip:port", ...]` or `[{ip,port}, ...]`). Fetched once at startup. Handy for free proxy-list endpoints. |
| `SCRAPE_PROXY_USERNAME` / `SCRAPE_PROXY_PASSWORD` | Optional shared credentials applied to every candidate (override any embedded in the URL). |
| `SCRAPE_PROXY_CHECK_URL` | Connectivity-check endpoint (default `https://api.ipify.org`). |
| `SCRAPE_PROXY_CHECK_TIMEOUT_MS` | Per-proxy check timeout (default `8000`). |
| `SCRAPE_PROXY_MAX_CANDIDATES` | Cap on candidates considered per run (default `25`). |
| `SCRAPE_PROXY_SKIP_CHECK` | `true` to skip health checks and use candidates as-is. |

When no candidates are configured, the code logs that it's using the runner IP
directly and behaves exactly as before — so adding these env vars to a workflow
is safe even before any proxy exists.

### Rotation and failover

This is what makes a free/public proxy list usable, since most entries are dead
or already blocked:

1. **At startup**, candidates are connectivity-checked one at a time; the first
   that responds is applied to fetch and used to launch the browser. Dead ones
   are skipped.
2. **Mid-run**, if Akamai blocks pile up to the circuit-breaker threshold
   (`AKAMAI_CIRCUIT_BREAKER`), the fetch route **rotates to the next healthy
   proxy** and the run continues, instead of stopping. The breaker only trips
   once every candidate is exhausted.

The fetch-first path (which handles most successful captures via Tesla's
embedded SSR JSON) rotates freely. The Playwright browser keeps the
**initial** proxy for the whole run as a fallback — relaunching the browser per
rotation would be far more expensive.

Block detection, per-station cooldowns (`BLOCK_COOLDOWN_*`), and the run-level
circuit breaker all stay in effect regardless of the proxy. The run's
`data/scrape-health.json` records `transport.proxyPool` (`candidates`, `tried`,
`activeHost`) so you can see what happened.

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

### Using a free proxy list

Set `SCRAPE_PROXY_LIST` to several `ip:port` entries, or point
`SCRAPE_PROXY_LIST_URL` at a free proxy-list endpoint (e.g. a ProxyScrape /
geonode "free list" URL). The pool will health-check them and use the first that
connects, rotating on blocks. **Manage expectations:** free proxies are
datacenter IPs that Akamai usually pre-blocks, so even a "working" (connectable)
proxy often still returns `access_controlled` on Tesla. Free lists are good for
*testing the plumbing*; a residential proxy is what reliably gets through.

## Verifying

**Don't wait for a scheduled scrape to find out if your proxy works.** Connecting
to a proxy proves nothing about Akamai — a proxy can forward requests fine and
still be denied on every tesla.com page. Use the proxy doctor to test the real
thing directly:

- **One click:** Actions tab → **Proxy Doctor** → *Run workflow*. It reads the
  same `SCRAPE_PROXY*` secrets, fetches a sample of real Supercharger pages
  through each configured proxy, and prints a PASS/BLOCKED verdict per route. The
  run goes **red** when proxies are set but none gets past Akamai, so you get an
  unambiguous signal.
- **Locally:** `npm run scrape:proxy-test` (set `SCRAPE_PROXY` in your shell
  first). Tunables: `PROXY_TEST_SAMPLE` (pages per proxy, default 6),
  `PROXY_TEST_DELAY_MS`, `PROXY_TEST_INCLUDE_DIRECT`.

A `PASS` means that proxy returned usable Supercharger pages (and, for priced
stations, extracted the embedded pricing) — the scraper will widen coverage
through it. `BLOCKED` means Akamai is denying that IP; try a residential pool.
Running it with no proxy configured shows direct GitHub-Actions egress getting
blocked, which is the baseline a proxy has to beat.

You can also spot-check after a scheduled run via `data/stations.json`:

- `lastScrapeResult: "access_controlled"` → still being blocked (proxy IP is
  also flagged, or the proxy isn't being applied).
- `lastSuccessfulScrapeAt` populated, or `lastPriceCandidateCount > 0` → working.

## Cost and etiquette

Scrapes are rate-limited (`SCRAPE_DELAY_MS`) and capped per run
(`MAX_STATIONS` / `PRICE_SCRAPE_LIMIT`) to stay polite and keep proxy bandwidth
modest. Raising frequency or station counts increases proxy usage and the risk
of the proxy pool itself getting flagged — change those gradually.
