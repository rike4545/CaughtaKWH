# CaughtaKWH

Track Tesla Supercharger pricing trends, spot cheaper charging windows, and find nearby stations faster. CaughtaKWH is focused on United States Superchargers first while the scraper is hardened, with Canada and Mexico planned after the data pipeline is steadier.

## Live Site

https://rike4545.github.io/CaughtaKWH/

## Support Development

If CaughtaKWH is useful to you, support continued development here:

https://linktr.ee/teslafi

---

## What is CaughtaKWH?

CaughtaKWH is a public Tesla Supercharger analytics project for United States Superchargers that:

- Tracks publicly observable Supercharger pricing data
- Builds pricing history over time
- Estimates lower-cost charging windows
- Helps drivers compare nearby charging options
- Shows pricing freshness and confidence levels
- Works entirely as a static GitHub Pages deployment

The project focuses on transparency:

- Tesla remains the source of truth
- Public pricing visibility varies by station
- Some stations expose pricing publicly, others do not
- Confidence and freshness indicators are shown clearly
- Prices older than 2 hours are treated as historical, not current

---

# Features

## Find Nearby Superchargers

Search by:

- ZIP code (recommended)
- Current location
- City or station name
- State filtering

Nearby mode automatically ranks the closest stations.

---

## Track Pricing Trends

CaughtaKWH stores historical pricing observations and displays:

- Tesla/member pricing
- Non-Tesla pricing (when available)
- Lowest observed pricing
- Price volatility
- Historical pricing charts
- Confidence intervals

---

## Predict Cheaper Charging Windows

The prediction engine estimates:

- Lower-cost charging periods
- Historical average pricing
- 95% confidence intervals
- Best observed charging windows
- Freshness of observations

The more observations collected over time, the better the predictions become.

---

## Privacy Friendly

Location usage is optional.

Users can:

- Enter a ZIP code manually
- Use browser/device location
- Deny location permissions entirely

Location is only used to rank nearby chargers.

---

# Tech Stack

## Frontend

- React
- Vite
- Recharts
- Leaflet
- GitHub Pages

## Data Pipeline

- Node.js
- Playwright
- GitHub Actions
- Headed Chromium through Xvfb for Tesla page checks

## Hosting

- Static GitHub Pages deployment
- Fully automated scheduled updates

---

# How the Data Pipeline Works

The update system:

1. Discovers Supercharger stations
2. Opens Tesla public station pages in a headed browser
3. Expands pricing accordions for Tesla/member and Non-Tesla rates
4. Stores historical observations
5. Builds prediction models
6. Syncs public JSON data
7. Deploys automatically to GitHub Pages

The project is intentionally designed without a traditional backend server.

---

# Project Structure

```text
/data
  stations.json
  predictions.json
  /history

/scripts
  discoverStations.mjs
  scrapePrices.mjs
  buildPredictions.mjs
  validateData.mjs
  syncPublicData.mjs

/.github/workflows
  update-data.yml
```

---

# Running Locally

## Install

```bash
npm install
```

## Install Playwright

```bash
npx playwright install chromium
```

Tesla currently blocks headless Chromium on some public station pages. For local live scraping, run the scraper in headed mode:

```bash
TESLA_HEADLESS=false npm run scrape
```

## Start Development Server

```bash
npm run dev
```

## Run Full Data Update

```bash
npm run update:data
```

For live scraping in environments without a visible display, use a virtual display:

```bash
xvfb-run -a env TESLA_HEADLESS=false MAX_STATIONS=25 npm run scrape
```

## Refresh A Local Area

Tesla station pages can be slow because every candidate page needs a browser render pass.
For focused checks, refresh a smaller area instead of the whole United States catalog:

```bash
SCRAPE_ZIP=10001 SCRAPE_RADIUS_MILES=75 MAX_STATIONS=25 npm run scrape
```

You can also target coordinates or state/province batches:

```bash
SCRAPE_LAT=40.7128 SCRAPE_LNG=-74.0060 SCRAPE_RADIUS_MILES=75 MAX_STATIONS=25 npm run scrape
SCRAPE_STATES=CA,NV MAX_STATIONS=50 npm run scrape
SCRAPE_ROTATE_STATES=true SCRAPE_ROTATION_COUNT=1 MAX_STATIONS=75 npm run scrape
```

To spend a run only on stations that still need usable price history:

```bash
TESLA_HEADLESS=false SCRAPE_NEEDS_HISTORY=true MAX_STATIONS=25 npm run scrape
```

You can target one station while debugging:

```bash
TESLA_HEADLESS=false SCRAPE_STATION_IDS=LakeGroveNYsupercharger MAX_STATIONS=1 npm run scrape
```

## Build Pricing Analytics

Pricing analytics become useful after repeated observations, not after one scrape. The `Pricing Pilot Panel` workflow refreshes a small station set every three hours so CaughtaKWH can measure:

- Whether prices actually change
- Member vs Non-Tesla spread
- Time-of-day movement
- Volatility and confidence
- Congestion fee changes

A station is treated as having usable history after at least three recent price observations. Ten recent observations across different times is a stronger target for cheaper-window modeling.

The pilot starts with:

```text
LakeGroveNYsupercharger
```

Add more stations by running the workflow manually with a comma-separated `station_ids` value. Once a pilot station has roughly 10-30 observations, the stability and cheaper-window analytics become much more useful.

## Dynamic Pricing And Power Cost Context

CaughtaKWH observes public Tesla prices over time. It can detect price changes, member vs Non-Tesla spread, congestion fees, volatility, and time-of-day movement once a station has enough repeated observations.

It does not yet know true supply/demand elasticity. For that, the project would need stronger demand-side signals such as stall occupancy, queueing, session volume, or consistent utilization snapshots. If Tesla exposes availability or congestion consistently, CaughtaKWH can use those as proxy signals.

For Lake Grove, NY, the latest observed public prices are:

- Tesla/member: 43 cents/kWh
- Non-Tesla: 65 cents/kWh
- Congestion fee: up to 50 cents/min
- Member vs Non-Tesla spread: 22 cents/kWh

Commercial electricity benchmarks are useful context, not Tesla's actual site cost. For example:

- EIA March 2026 New York commercial average: 22.21 cents/kWh
- NYSERDA February 2026 New York statewide commercial average: 23.5 cents/kWh

Using the EIA March 2026 commercial benchmark, Lake Grove's public Tesla/member price is about 1.94x the statewide commercial average, and the Non-Tesla price is about 2.93x. That comparison does not include Tesla-specific demand charges, site rent, charger hardware, maintenance, network costs, taxes, demand-response programs, or idle/congestion policy.

Sources:

- EIA Electric Power Monthly Table 5.6.A: https://www.eia.gov/electricity/monthly/epm_table_grapher.php?lv=true&t=epmt_5_6_a
- NYSERDA Monthly Commercial Electricity Prices: https://www.nyserda.ny.gov/Energy-Prices/Electricity/Monthly-Avg-Electricity-Commercial

## Manually Refresh One Supercharger

To refresh one station locally:

```bash
TESLA_HEADLESS=false SCRAPE_STATION_IDS=LakeGroveNYsupercharger MAX_STATIONS=1 npm run scrape
npm run predict
npm run sync:public
npm run build
git add data public/data
git commit -m "Refresh Lake Grove pricing"
git push origin main
```

To refresh one station from GitHub:

1. Go to Actions.
2. Open `Pricing Pilot Panel`.
3. Click `Run workflow`.
4. Set `station_ids` to the target station ID, such as `LakeGroveNYsupercharger`.
5. Run the workflow.

Canada and Mexico support can be enabled later by running discovery with:

```bash
DISCOVERY_COUNTRIES="United States,Canada,Mexico" npm run discover
```

## Build Production Site

```bash
npm run build
```

---

# Automated Updates

GitHub Actions automatically:

- Refreshes pricing data with headed Chromium
- Updates predictions
- Regenerates the public dashboard-health feed
- Writes dashboard improvement recommendations from real data
- Syncs public datasets
- Deploys the website

## Neural pricing model

`npm run predict` first trains a small feed-forward network from validated history and then rebuilds the public predictions. Its inputs include half-hour time, weekday, membership type, utilization when available, stall count, maximum power, congestion fees, coordinates, source type, and parser candidate density.

The model is deliberately guarded:

- Tesla and validated community reports remain the only sources of recorded prices.
- Neural output can flag a capture for review but never discards or invents an official observation.
- Holdout MAE must beat a membership-aware baseline before capture validation turns on.
- Neural price blending stays off until there are at least 200 examples, 5 priced stations, and 30 utilization-labeled examples.
- Model weights, coverage, activation state, and error metrics are published in `data/pricing-neural-model.json` and `reports/pricing-neural-model.md`.

Current optimization strategy:

- Daily rotating state/province refreshes
- Dynamic pricing checks run every 30 minutes because Tesla pricing can move on half-hour windows
- Full station discovery runs weekly so it does not block price refreshes
- Manual ZIP or coordinate scoped refreshes for local areas
- Smaller scrape batches to avoid slow Tesla page render passes piling up
- Pricing accordions are opened before extraction
- Daily dashboard improvement checks with `npm run improve:dashboard`
- Static asset synchronization

---

# Important Notes

## Tesla Is The Source Of Truth

CaughtaKWH is an analytics and observation platform.

Actual live pricing inside Tesla vehicles or the Tesla app may differ from:

- Historical observations
- Estimated windows
- Publicly visible pricing

Always verify pricing in Tesla’s ecosystem before charging.

---

# Roadmap

Planned improvements include:

- Broader Canada and Mexico rollout
- Better handling for Tesla anti-bot edge cases
- More stations with fresh price history
- Improved local refresh requests
- Occupancy-aware predictions
- Supercharger utilization modeling
- Community-submitted observations
- Better confidence scoring

---

# Contributing

Pull requests, ideas, and bug reports are welcome.

Suggested contribution areas:

- Scraper reliability
- UI polish
- Data visualization
- Prediction modeling
- Map improvements
- Performance optimization

---

# Disclaimer

CaughtaKWH is an independent project and is not affiliated with or endorsed by Tesla.

Tesla trademarks, vehicle names, and Supercharger branding belong to Tesla, Inc.
