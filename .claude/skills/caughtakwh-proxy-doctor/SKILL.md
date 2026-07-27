---
name: caughtakwh-proxy-doctor
description: >-
  Diagnose and verify Supercharger scrape egress for CaughtaKWH. Use when live
  price coverage drops, scrapes come back access_controlled / Akamai-blocked, or
  after setting or changing the SCRAPE_PROXY secret and you need to confirm the
  proxy actually gets past Tesla's Akamai before relying on it.
license: Apache-2.0
---

# CaughtaKWH Proxy Doctor

The egress proxy is the single biggest lever for live scrape coverage. Tesla's
Supercharger pages sit behind Akamai Bot Manager, which blocks by **IP
reputation** — so GitHub Actions runner IPs and dead/public free proxies get
denied no matter how good the scraper's browser fingerprint is. A proxy can
connect fine and still be blocked on every `tesla.com` page.

This skill is the loop for answering one question: **does this egress actually
get past Akamai?** — without waiting for a scheduled scrape or digging through
logs.

## When to use

- Live coverage dropped, or `data/stations.json` entries show
  `lastScrapeResult: "access_controlled"`.
- You just set or rotated the `SCRAPE_PROXY` secret and need to confirm it works.
- Someone asks "is the proxy working?" / "why aren't we capturing prices?"

## How to run it

**One click (recommended):** Actions tab → **Proxy Doctor** → *Run workflow*.
Inputs: `sample` (pages per proxy, default 6) and `include_direct` (also probe
no-proxy egress for contrast). It reads the same `SCRAPE_PROXY*` secrets the
scraper uses.

**Locally:**

```bash
export SCRAPE_PROXY='http://user:pass@host:port'   # omit to test direct egress only
npm run scrape:proxy-test
```

Tunables (env): `PROXY_TEST_SAMPLE` (6), `PROXY_TEST_DELAY_MS` (1500),
`PROXY_TEST_TIMEOUT_MS` (20000), `PROXY_TEST_INCLUDE_DIRECT` (true).
Proxy sources are the standard ones: `SCRAPE_PROXY`, `SCRAPE_PROXY_LIST`,
`SCRAPE_PROXY_LIST_URL`, `SCRAPE_PROXY_USERNAME` / `SCRAPE_PROXY_PASSWORD`.

## Reading the verdict

Each route (every configured proxy, plus optional direct egress) prints an egress
IP and a per-probe tally, then one of:

| Verdict | Meaning | Action |
|---------|---------|--------|
| **PASS** ✅ | Returned usable Supercharger pages (and extracted pricing on priced stations) | Good — the scraper will widen coverage through it |
| **BLOCKED** ⛔ | Connected, but Akamai denied the IP on Tesla pages | Try a different / residential pool |
| **FAIL** ⚠️ | Connected, no usable Tesla pages and no clear block | Investigate: bad slugs, timeouts, or partial blocking |
| **DEAD** | Proxy didn't even forward a request | Drop it from the list |

**Exit code:** `0` if any configured proxy PASSes, or if no proxy is configured
(informational — it still shows direct egress getting blocked, the baseline a
proxy must beat). `1` if proxies are configured but none returns a usable page —
this is what turns the workflow run red.

## If everything is BLOCKED

That's the expected state without a residential proxy. The fix is a paid
**residential** egress IP (pages are ~100–500 KB, so pay-as-you-go bandwidth is
pennies per run):

1. Get an endpoint from a residential provider (IPRoyal, SOAX, Bright Data,
   Oxylabs pay-as-you-go all work). Avoid "free residential" lists — usually
   botnets, and still blocked.
2. Repo → **Settings → Secrets → Actions** → add `SCRAPE_PROXY`
   (`http://user:pass@host:port`), and `SCRAPE_PROXY_USERNAME` /
   `SCRAPE_PROXY_PASSWORD` if not embedded.
3. Re-run Proxy Doctor to confirm PASS, then the scheduled scrapes pick it up.

Full setup reference: `docs/scrape-proxy.md`.

## Boundary

This skill diagnoses and routes egress — it does **not** try to defeat Akamai's
bot challenge beyond using a legitimate proxy. If pages return a sustained
challenge, the correct outcome is BLOCKED plus a note to switch pools, not an
escalating evasion arms race. This matches the deliberate boundary in
`README-AGENTS.md` and keeps a public, Tesla-adjacent project on defensible
footing.

## Related

- `scripts/proxyDoctor.mjs` — the diagnostic this skill drives.
- `scripts/proxyPool.mjs` — candidate gathering, health-check, rotation/failover.
- `scripts/scrapePrices.mjs` — the scraper that consumes the proxy pool.
- `.github/workflows/proxy-test.yml` — the one-click workflow.
