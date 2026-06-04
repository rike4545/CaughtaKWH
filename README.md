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

The pilot starts with:

```text
LakeGroveNYsupercharger
```

Add more stations by running the workflow manually with a comma-separated `station_ids` value. Once a pilot station has roughly 10-30 observations, the stability and cheaper-window analytics become much more useful.

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
- Syncs public datasets
- Deploys the website

Current optimization strategy:

- Daily rotating state/province refreshes
- Manual ZIP or coordinate scoped refreshes for local areas
- Smaller scrape batches to avoid slow Tesla page render passes piling up
- Pricing accordions are opened before extraction
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
