# CaughtaKWH Agent Suite

A set of self-healing and self-improving automation agents that fit the existing
`scripts/*.mjs` + `.github/workflows/` structure. They use only Node 24 built-ins
plus Playwright (already in the project), and the `GITHUB_TOKEN` that Actions
provides automatically — no extra secrets or services required.

## What each agent does

**1. Pipeline Sentinel — `scripts/selfHeal.mjs`**
Runs after a data refresh. Retries recoverable failures with backoff, classifies
what went wrong, restores the last-known-good dataset if a run regressed, and
opens a diagnostic issue only when a human is actually needed.

**2. Structure Drift Detector — `scripts/detectDrift.mjs`**
Probes a station page the same way the scraper already does (headed Chromium),
fingerprints where price text lives, and — when the old selectors stop matching —
proposes candidate replacement selectors. This is how it adapts to ordinary Tesla
page-layout changes, which is the usual reason a scraper "breaks."

**3. Data Doctor — `scripts/dataDoctor.mjs`**
Validates and repairs the dataset: dedupes observations, quarantines impossible
prices, normalizes timestamps, backfills freshness/confidence. Bad records are
quarantined, never silently deleted.

**4. Improvement Agent — `scripts/improveAgent.mjs`**
Turns the data into a prioritized backlog: which stations lack usable history,
which are stale, which predictions are low-confidence, and which states to rotate
in next. Filed as a rolling weekly issue.

**5. Prediction QA — `scripts/predictionQA.mjs`**
Backtests predictions (leakage-safe holdout) against later actuals, tracks error
over time, and flags regressions so a bad model change can't quietly degrade the
"cheaper window" feature.

Plus `dependabot.yml` and the Security Keeper workflow for hands-off dependency
and vulnerability upkeep.

## Install

1. Copy `scripts/*.mjs` into your repo's `scripts/`.
2. Copy `.github/workflows/*.yml` and `.github/dependabot.yml` into `.github/`.
3. In `self-heal.yml`, change `workflows: ["Update Data"]` to the exact `name:`
   of your existing `update-data.yml`.
4. Add these to `package.json` scripts:

```json
{
  "scripts": {
    "agent:heal": "node scripts/selfHeal.mjs",
    "agent:drift": "node scripts/detectDrift.mjs",
    "agent:data": "node scripts/dataDoctor.mjs",
    "agent:improve": "node scripts/improveAgent.mjs",
    "agent:qa": "node scripts/predictionQA.mjs"
  }
}
```

5. Make sure Actions has write permission: repo **Settings → Actions → General →
   Workflow permissions → Read and write**.

## Run locally

```bash
node scripts/dataDoctor.mjs       # safe, no browser
node scripts/predictionQA.mjs     # safe, no browser
node scripts/improveAgent.mjs     # safe, no browser
TESLA_HEADLESS=false node scripts/detectDrift.mjs   # needs Chromium
```

With no `GITHUB_TOKEN` present, agents write findings to `reports/` instead of
opening issues, so they're useful locally too.

## A deliberate boundary

See **The deliberate boundary** in `AGENTS.md` — the canonical statement. In
short: these agents recover from legitimate breakage (transient errors,
page-layout changes, data corruption) and stop at access controls rather than
escalate an arms race. Beyond keeping a public, Tesla-adjacent project on
defensible footing, that avoids the ToS and legal exposure that would threaten
the project itself.
