# AGENTS.md

Guidance for AI agents (Claude Code, Cursor, Codex, etc.) working in this repo.
Read this first — it captures conventions and non-obvious gotchas that will bite
you otherwise. Keep it updated when you learn something the hard way.

## What this is

CaughtaKWH is a public Tesla Supercharger **price-transparency** dashboard (US
first). A React + Vite frontend renders JSON produced by a pipeline of Node
scripts run on GitHub Actions, published to GitHub Pages.

- **Frontend:** React + Vite (`src/`), Recharts, lucide-react, Leaflet. `base:
  './'` — assets and data are fetched with **relative `./data/*.json`** paths, so
  the site works under the Pages subpath. Never hardcode absolute `/data` paths.
- **Scripts:** Node ESM `.mjs` in `scripts/` (Node 24, built-ins + Playwright +
  undici only). Run via `npm run <name>`.
- **CI/data:** `.github/workflows/*.yml` run the scripts on schedules and commit
  the results back to `main` with `GITHUB_TOKEN`.

## Commands

```
npm run dev            # local dev server
npm run build          # sync:public then vite build (run before Pages checks)
npm run scrape         # scrapePrices.mjs — hops Supercharger pages, captures $/kWh
npm run predict        # train neural model + build predictions
npm run update:data    # discover -> scrape -> predict -> validate -> sync:public
npm run validate:data  # dataset sanity checks
npm run scrape:proxy-test   # Proxy Doctor — does egress get past Akamai? (see below)
npm run test:scrape-policy / test:scrape-transport   # unit tests
```

The data pipeline order is **discover → scrape → predict → validate → sync:public**.
`sync:public` copies `data/*.json` to `public/data/` (what the built site serves).

## Gotchas that will bite you

1. **`main` history is rewritten.** Data workflows and history squashes mean
   `main` is sometimes **force-updated**, so a feature branch can end up with **no
   merge-base** with current `main` (a PR would then be unmergeable garbage). Do
   NOT stack commits on an old base. Before merging: `git fetch origin main`, then
   **cherry-pick your commits onto fresh `origin/main`** (or rebase), and push.
   Verify with `git diff --name-only origin/main...HEAD` showing only your files.

2. **Scraping is gated by Akamai IP reputation, not fingerprinting.** Tesla's
   `findus` pages are behind Akamai Bot Manager. The scraper's headers/stealth are
   already strong; the block is the **IP**. GitHub Actions and datacenter/free
   proxies are pre-blocked (proven: a direct runner IP gets 6/6 Tesla probes
   BLOCKED). Only a **residential** `SCRAPE_PROXY` reliably gets through. Always
   test a proxy with **Proxy Doctor** (`npm run scrape:proxy-test`, or Actions →
   Proxy Doctor) before trusting it. See `docs/scrape-proxy.md`.

3. **Empty env vars parse to `0`.** `Number('')` is `0` and `Number.isFinite(0)`
   is `true`. A blank `SCRAPE_LAT`/`SCRAPE_LNG` once built a real origin at the
   `0,0` null island and scoped every scheduled scrape to **zero stations**. When
   reading numeric env vars, treat blank/whitespace as "not provided" (NaN), and
   guard nonsensical values (e.g. `0,0` coordinates).

4. **Don't hand-edit generated data.** `data/*.json`, `public/data/*.json`, and
   `reports/*.json` are produced by scripts and rewritten constantly by CI. Editing
   them by hand causes churn and merge noise — change the generator instead.

5. **CI failures are often GitHub, not you.** "The job was not acquired by Runner
   of type hosted" / "Internal server error. Correlation ID: …" are runner-
   provisioning blips — a single failed scheduled tick self-heals on the next run;
   there is no code fix. Only treat *sustained* failures as real.

6. **Pages deploys are throttled.** `pages.yml` deploys on a **20-minute
   schedule** (plus `push`), not after every data workflow — deploying more often
   trips the Pages backend rate limit ("Deployment failed, try again later").

## Scrape scope & rotation

Scheduled scrapes rotate **8 states/day** (`SCRAPE_ROTATION_COUNT` in
`price-refresh.yml`), sliding one state/day through the alphabetical list — the
52-region sweep is fixed by the state count. Per-run cap is `MAX_STATIONS`
(default 100). Priority scoring (`priorityFor`) favors stations with price
history, volatility, and thin coverage; recently Akamai-blocked ones back off via
cooldowns.

## Frontend conventions

- Dark "glass on gradient" design system with CSS custom properties (`--bg`,
  `--card`, `--text`, `--muted`, `--accent` `#53e0a3`, `--accent2` `#65a9ff`, …)
  in `src/styles.css`. Support **light and dark** (`prefers-color-scheme`).
- Use `font-variant-numeric: tabular-nums` for prices/stats, `:focus-visible`
  rings, and honor `prefers-reduced-motion`.
- The hero is **location-first**: it leads with the visitor's selected/nearest
  charger (ZIP or geolocation), falling back to a labeled example only when no
  location is known. Don't regress it back to a single hardcoded/pilot station.

## The deliberate boundary

The agents/scrapers make the pipeline resilient to *legitimate* breakage
(transient errors, page-layout drift, data corruption). They intentionally do
**not** try to defeat anti-bot or access-control measures beyond using a
legitimate proxy. If a page returns a sustained challenge, report BLOCKED and
stop — do not escalate an evasion arms race. This keeps a public, Tesla-adjacent
project on defensible footing.

## Pointers

- `README-AGENTS.md` — the self-healing/improvement agent suite (`agent:*`).
- `docs/scrape-proxy.md` — proxy setup + verification.
- `.claude/skills/caughtakwh-proxy-doctor/` — the proxy-diagnosis skill.
