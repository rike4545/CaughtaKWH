# CaughtaKWH

CaughtaKWH is a GitHub Pages-ready dashboard for tracking point-in-time Tesla Supercharger $/kWh prices by station and recommending cheaper charging windows using 30-minute pricing buckets and 95% confidence intervals.

## What it does

- Discovers U.S. Supercharger station pages from Tesla's public Find Us list.
- Scrapes station-specific pricing text from public Tesla location pages using Playwright.
- Stores observations per station in `data/history/{stationId}.json`.
- Builds member and non-member best-30-minute predictions with 95% confidence intervals.
- Tracks available stalls, utilization bands, and congestion fees when public pages expose those signals.
- Deploys a static React dashboard to GitHub Pages.

## Important limitation

Tesla pricing is dynamic, may change within the hour, and may render differently by region, session, account, or browser. This project is not affiliated with Tesla. Always verify price inside Tesla's app or vehicle screen before charging.

## Local setup

```bash
npm install
npx playwright install chromium
npm run update:data
npm run dev
```

## Production deployment

1. Push this repo to GitHub.
2. Go to **Settings → Pages**.
3. Select **GitHub Actions** as the Pages source.
4. Run the **Deploy GitHub Pages** workflow once.
5. Run **Update Supercharger Price Data** manually with `max_stations=25` first.

## Scaling advice

Start with small scrapes:

```yaml
MAX_STATIONS=25
SCRAPE_DELAY_MS=3000
```

Then increase gradually. Full nationwide scraping too frequently may trigger anti-bot protections. The workflow defaults to 100 stations per run.

## Data model

```json
{
  "stationId": "LakeGroveNYsupercharger",
  "capturedAt": "2026-05-25T20:33:00.000Z",
  "localHour": 16,
  "localMinute": 33,
  "halfHourSlot": 33,
  "memberPricePerKwh": 0.43,
  "nonMemberPricePerKwh": 0.65,
  "availableStalls": 3,
  "totalStalls": 8,
  "utilizationPct": 0.625,
  "congestionFeePerMinuteMax": 0.5,
  "currency": "USD"
}
```

## Prediction method

For each station and 30-minute bucket:

```text
mean ± 1.96 × standard error
```

The recommendation uses the lowest 95% upper confidence bound, which penalizes sparse or volatile 30-minute periods. The dashboard also shows the latest observed website price separately from historical estimates.

## Utilization method

When observations include both price and stall availability, CaughtaKWH groups utilization into low, medium, and high bands and compares average $/kWh against the low-utilization baseline. Until a station has observations across multiple load levels, the dashboard labels utilization impact as not ready instead of guessing.

## Seed observation

Lake Grove, NY is seeded from a user-verified Tesla public page screenshot:

- Teslas/Members: $0.43/kWh
- Non-Members: $0.65/kWh
- Congestion fees: up to $0.50/min
