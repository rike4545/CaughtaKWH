# CaughtaKWH ⚡

Track Tesla Supercharger pricing trends, discover cheaper charging windows, and find nearby stations faster.

## 🌐 Live Site

https://rike4545.github.io/CaughtaKWH/

---

## What is CaughtaKWH?

CaughtaKWH is a public Tesla Supercharger analytics project that:

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

## 🔎 Find Nearby Superchargers

Search by:

- ZIP code (recommended)
- Current location
- City or station name
- State filtering

Nearby mode automatically ranks the closest stations.

---

## 💲 Track Pricing Trends

CaughtaKWH stores historical pricing observations and displays:

- Tesla/member pricing
- Non-Tesla pricing (when available)
- Lowest observed pricing
- Price volatility
- Historical pricing charts
- Confidence intervals

---

## 🧠 Predict Cheaper Charging Windows

The prediction engine estimates:

- Lower-cost charging periods
- Historical average pricing
- 95% confidence intervals
- Best observed charging windows
- Freshness of observations

The more observations collected over time, the better the predictions become.

---

## 📍 Privacy Friendly

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

## Hosting

- Static GitHub Pages deployment
- Fully automated scheduled updates

---

# How the Data Pipeline Works

The update system:

1. Discovers Supercharger stations
2. Scrapes publicly visible pricing data
3. Stores historical observations
4. Builds prediction models
5. Syncs public JSON data
6. Deploys automatically to GitHub Pages

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

## Start Development Server

```bash
npm run dev
```

## Run Full Data Update

```bash
npm run update:data
```

## Build Production Site

```bash
npm run build
```

---

# Automated Updates

GitHub Actions automatically:

- Refreshes pricing data
- Updates predictions
- Syncs public datasets
- Deploys the website

Current optimization strategy:

- Faster scrape intervals
- Smaller scrape batches
- Reduced throttling risk
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

- Better mobile UI
- Faster scraper concurrency
- Improved regional filtering
- Occupancy-aware predictions
- Supercharger utilization modeling
- Community-submitted observations
- Better confidence scoring
- EV route planning tools

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
