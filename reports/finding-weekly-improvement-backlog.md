# Weekly improvement backlog

Automated weekly improvement backlog from real data.

Coverage: **2/3105** stations have any price history; 2 predictions generated.

### 1. Capture first observations for stations with zero history
- Affected: **3103**
- Sample IDs: `403969`, `481260`, `485163`, `481358`, `487103`, `484317`, `487202`, `481359`, `492964`, `485807`, `487054`, `487153`, `484459`, `487104`, `421525`
- How: Run Pricing Pilot Panel with these station_ids, or SCRAPE_NEEDS_HISTORY=true.
### 2. Grow thin-history stations toward 10+ observations
- Affected: **0**
- How: Schedule time-diverse refreshes (morning/afternoon/evening) for time-of-day signal.
### 3. Refresh stale stations (>24h since latest observation)
- Affected: **2**
- Sample IDs: `404914`, `LakeGroveNYsupercharger`
- How: Targeted SCRAPE_STATION_IDS or a state-rotation pass.
### 4. Improve lowest-coverage states via rotation
- Targets: KS (0% covered), GA (0% covered), IL (0% covered), FL (0% covered), TX (0% covered)
- How: Set SCRAPE_STATES to these states for upcoming rotations.
### 5. Tighten low-confidence predictions
- Affected: **1**
- Sample IDs: `LakeGroveNYsupercharger`
- How: More observations across different hours raises confidence and narrows CIs.

_Filed automatically by improveAgent.mjs._
