# Dashboard Improvement Bot

Generated: 2026-07-07T13:49:33.879Z

## Public Dashboard Health

- Scope: United States Superchargers first
- Stations: 3107
- Checked by scraper: 3091 (99.49%)
- Latest attempts blocked by access controls: 10
- Stations with any price history: 1 (0.03%)
- Stations with usable price history: 0 (0%)
- Stations with strong price history: 0 (0%)
- Fresh price stations: 0
- Stale or unchecked stations: 3107

## State Refresh Priorities

- CA: 659 stale/unchecked, 0% priced
- FL: 244 stale/unchecked, 0% priced
- TX: 223 stale/unchecked, 0% priced
- NY: 124 stale/unchecked, 0.81% priced
- PA: 110 stale/unchecked, 0% priced
- NJ: 107 stale/unchecked, 0% priced
- VA: 103 stale/unchecked, 0% priced
- NC: 90 stale/unchecked, 0% priced

## Station Refresh Targets

- Lake Grove, NY (LakeGroveNYsupercharger) · access_controlled
- Fullerton, CA - S Harbor Blvd (404914) · not_checked
- Santa Monica, CA (15162) · not_checked
- San Clemente, CA (sanclementesupercharger) · not_checked
- Madisonville, TX (madisonvilletxsupercharger) · not_checked

## Improvement Queue

- Grow repeated observations: 0 of 3107 US stations have usable price history. A station becomes usable after at least 3 recent price observations.
- Keep fresh data visible: 0 stations have a price observation from the last 24 hours. Freshness should stay prominent so visitors know what is current.
- Prioritize slow Tesla pages: 3107 stations are unchecked or older than 72 hours. Refreshes should stay staggered by state because each Tesla candidate page needs render time.
- Add local power context state by state: New York has public commercial-rate context in the app. Add verified benchmarks only when the source and period are clear.

## Automation

The dashboard improvement workflow regenerates this report and `data/dashboard-health.json`, syncs public data, validates the site data, and commits any changed dashboard-health output.
