// dataDoctor.mjs
// Agent 3 — Data Doctor (data self-healing).
//
// Matches CaughtaKWH's real schema:
//   - history files: data/history/<stationId>.json  (plain array of observations)
//   - observation timestamp field: capturedAt (ISO)
//   - price fields (in DOLLARS, e.g. 0.43 = 43c/kWh):
//       memberPricePerKwh, nonMemberPricePerKwh,
//       congestionFeePerMinuteMax, lowestObservedPricePerKwh
//   - stations.json: array; predictions.json: array
//
// Repairs: dedupe (same key the scraper uses), drop impossible prices into a
// quarantine, normalize capturedAt to ISO, sort chronologically. Quarantines
// bad rows rather than deleting them.

import path from 'node:path';
import {
  DATA_DIR, REPORTS_DIR, log, readJSON, writeJSON, listHistoryFiles, reportFinding,
} from './agentLib.mjs';

// Public US Supercharger pricing guardrails, in DOLLARS.
const MAX_PER_KWH = 2.0;     // $2.00/kWh is already far above anything observed
const MAX_FEE_PER_MIN = 2.0; // congestion fee ceiling guardrail ($/min)
const MIN_PRICE = 0;

const PRICE_FIELDS = ['memberPricePerKwh', 'nonMemberPricePerKwh', 'lowestObservedPricePerKwh'];

function toIso(v) {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

function priceOk(value, max) {
  if (value == null) return true;            // null/absent is allowed
  const n = Number(value);
  if (Number.isNaN(n)) return false;
  return n >= MIN_PRICE && n <= max;
}

// Same dedupe identity the scraper uses when merging history.
function obsKey(o) {
  return [o.capturedAt, o.memberPricePerKwh, o.nonMemberPricePerKwh,
    o.congestionFeePerMinuteMax, o.availableStalls, o.utilizationPct].join('-');
}

async function main() {
  const summary = {
    checkedAt: new Date().toISOString(),
    stations: 0,
    observationsIn: 0,
    observationsKept: 0,
    quarantined: 0,
    duplicatesRemoved: 0,
    timestampsFixed: 0,
    repaired: [],
  };
  const quarantine = [];

  const historyFiles = await listHistoryFiles();
  for (const file of historyFiles) {
    const stationId = path.basename(file, '.json');
    const observations = await readJSON(file, []);
    if (!Array.isArray(observations)) continue;
    summary.observationsIn += observations.length;

    const seen = new Set();
    const cleaned = [];
    let changed = false;

    for (const raw of observations) {
      const iso = toIso(raw.capturedAt);
      if (!iso) {
        quarantine.push({ stationId, reason: 'unparseable-capturedAt', obs: raw });
        changed = true;
        continue;
      }
      const obs = { ...raw };
      if (obs.capturedAt !== iso) { obs.capturedAt = iso; summary.timestampsFixed++; changed = true; }

      const pricesValid = PRICE_FIELDS.every((f) => priceOk(obs[f], MAX_PER_KWH))
        && priceOk(obs.congestionFeePerMinuteMax, MAX_FEE_PER_MIN);
      if (!pricesValid) {
        quarantine.push({ stationId, reason: 'price-out-of-bounds', obs: raw });
        changed = true;
        continue;
      }

      const key = obsKey(obs);
      if (seen.has(key)) { summary.duplicatesRemoved++; changed = true; continue; }
      seen.add(key);
      cleaned.push(obs);
    }

    cleaned.sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt));

    if (changed) {
      summary.repaired.push({ stationId, before: observations.length, after: cleaned.length });
      await writeJSON(file, cleaned);
    }
    summary.observationsKept += cleaned.length;
    summary.stations++;
  }

  summary.quarantined = quarantine.length;
  if (quarantine.length > 0) {
    await writeJSON(path.join(DATA_DIR, 'quarantine.json'), {
      quarantinedAt: new Date().toISOString(),
      records: quarantine,
    });
  }
  await writeJSON(path.join(REPORTS_DIR, 'data-health.json'), summary);
  log('info', 'data doctor summary', {
    stations: summary.stations, kept: summary.observationsKept,
    quarantined: summary.quarantined, dupes: summary.duplicatesRemoved,
  });

  if (quarantine.length > 20) {
    await reportFinding({
      title: `Data Doctor quarantined ${quarantine.length} observations`,
      labels: ['data-health'],
      body: `An unusual number of observations failed validation and were moved to \`data/quarantine.json\`. This often means a scraper parsing change or a Tesla page-structure change.\n\nTop reasons:\n${topReasons(quarantine)}\n\n_Note: prices are validated in dollars/kWh (0.43 = 43c)._`,
    });
  }
}

function topReasons(q) {
  const counts = {};
  for (const r of q) counts[r.reason] = (counts[r.reason] || 0) + 1;
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `- ${k}: ${v}`).join('\n');
}

main().catch((err) => {
  log('error', 'data doctor crashed', { error: String(err && err.stack ? err.stack : err) });
  process.exitCode = 1;
});
