// improveAgent.mjs
// Agent 4 — Continuous Improvement.
//
// Real schema:
//   - stations.json: array; station has id, name, state, url, lastScrapedAt,
//     lastScrapeHadPrice, observationPriorityScore (NO observationCount field).
//   - predictions.json: array; entries have stationId, sampleCount,
//     confidenceLabel, latestObservationAgeHours, currentPriceStatus.
//   - usable history is counted from data/history/<id>.json row counts.
//
// Produces reports/improvement-backlog.json and files a rolling weekly issue.

import path from 'node:path';
import {
  DATA_DIR, REPORTS_DIR, HISTORY_DIR, log, readJSON, writeJSON, reportFinding,
  hoursSince, listHistoryFiles,
} from './agentLib.mjs';

const USABLE_HISTORY = 3;
const STRONG_HISTORY = 10;
const STALE_HOURS = 24;

async function main() {
  const stations = await readJSON(path.join(DATA_DIR, 'stations.json'), []);
  const predictions = await readJSON(path.join(DATA_DIR, 'predictions.json'), []);

  // Count observations per station from history files.
  const obsCount = new Map();
  for (const file of await listHistoryFiles()) {
    const id = path.basename(file, '.json');
    const rows = await readJSON(file, []);
    obsCount.set(id, Array.isArray(rows) ? rows.length : 0);
  }

  // Best (lowest) age per station from predictions.
  const ageByStation = new Map();
  for (const p of predictions) {
    const a = typeof p.latestObservationAgeHours === 'number' ? p.latestObservationAgeHours : Infinity;
    if (!ageByStation.has(p.stationId) || a < ageByStation.get(p.stationId)) {
      ageByStation.set(p.stationId, a);
    }
  }

  const noHistory = [];
  const thinHistory = [];
  const stale = [];
  const byState = {};

  for (const s of stations) {
    const id = s.id;
    const count = obsCount.get(String(id)) ?? obsCount.get(id) ?? 0;
    const state = s.state || 'unknown';
    byState[state] = byState[state] || { total: 0, usable: 0 };
    byState[state].total++;
    if (count >= USABLE_HISTORY) byState[state].usable++;

    if (count === 0) noHistory.push(id);
    else if (count < STRONG_HISTORY) thinHistory.push(id);

    const age = ageByStation.get(id);
    if (count > 0 && (age == null || age > STALE_HOURS)) stale.push(id);
  }

  const rotationTargets = Object.entries(byState)
    .map(([state, v]) => ({ state, coverage: v.total ? v.usable / v.total : 0, total: v.total }))
    .filter((x) => x.state !== 'unknown' && x.total >= 3)
    .sort((a, b) => a.coverage - b.coverage)
    .slice(0, 5);

  const lowConfidence = predictions
    .filter((p) => p.confidenceLabel === 'low')
    .map((p) => p.stationId)
    .filter((v, i, a) => a.indexOf(v) === i)
    .slice(0, 25);

  const backlog = {
    generatedAt: new Date().toISOString(),
    totals: {
      stations: stations.length,
      withAnyHistory: [...obsCount.values()].filter((c) => c > 0).length,
      predictions: predictions.length,
    },
    priorities: [
      { rank: 1, action: 'Capture first observations for stations with zero history',
        count: noHistory.length, sample: noHistory.slice(0, 15),
        how: 'Run Pricing Pilot Panel with these station_ids, or SCRAPE_NEEDS_HISTORY=true.' },
      { rank: 2, action: 'Grow thin-history stations toward 10+ observations',
        count: thinHistory.length, sample: thinHistory.slice(0, 15),
        how: 'Schedule time-diverse refreshes (morning/afternoon/evening) for time-of-day signal.' },
      { rank: 3, action: 'Refresh stale stations (>24h since latest observation)',
        count: stale.length, sample: stale.slice(0, 15),
        how: 'Targeted SCRAPE_STATION_IDS or a state-rotation pass.' },
      { rank: 4, action: 'Improve lowest-coverage states via rotation',
        targets: rotationTargets,
        how: 'Set SCRAPE_STATES to these states for upcoming rotations.' },
      { rank: 5, action: 'Tighten low-confidence predictions',
        count: lowConfidence.length, sample: lowConfidence,
        how: 'More observations across different hours raises confidence and narrows CIs.' },
    ],
  };

  await writeJSON(path.join(REPORTS_DIR, 'improvement-backlog.json'), backlog);
  log('info', 'improvement backlog written', {
    noHistory: noHistory.length, thinHistory: thinHistory.length, stale: stale.length,
  });

  const body = [
    'Automated weekly improvement backlog from real data.',
    '',
    `Coverage: **${backlog.totals.withAnyHistory}/${backlog.totals.stations}** stations have any price history; ${backlog.totals.predictions} predictions generated.`,
    '',
    ...backlog.priorities.map((p) => {
      const lines = [`### ${p.rank}. ${p.action}`];
      if (p.count != null) lines.push(`- Affected: **${p.count}**`);
      if (p.sample && p.sample.length) lines.push('- Sample IDs: ' + p.sample.map((x) => '`' + x + '`').join(', '));
      if (p.targets) lines.push('- Targets: ' + p.targets.map((t) => `${t.state} (${Math.round(t.coverage * 100)}% covered)`).join(', '));
      lines.push(`- How: ${p.how}`);
      return lines.join('\n');
    }),
    '',
    '_Filed automatically by improveAgent.mjs._',
  ].join('\n');

  await reportFinding({ title: 'Weekly improvement backlog', labels: ['improvement'], body });
}

main().catch((err) => {
  log('error', 'improve agent crashed', { error: String(err && err.stack ? err.stack : err) });
  process.exitCode = 1;
});
