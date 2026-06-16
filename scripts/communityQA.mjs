// communityQA.mjs
// Agent 6 — Community Report Trust / QA.
//
// Crowd-sourcing is the project's main coverage path (the ingester writes
// observations tagged source: 'community_report' with a reportedBy + reportIssue).
// This agent guards that record's quality WITHOUT punishing honest contributors:
//
//   - Flags a community report as a statistical outlier when it sits far from
//     the same station's other observations (robust MAD test), so a fat-finger
//     ($4.30 instead of $0.43) gets surfaced for review.
//   - Tracks per-reporter stats and flags a reporter whose submissions are
//     repeatedly outliers (basic bad-actor signal) — surfaced, never auto-banned.
//   - Writes reports/community-trust.json and files at most one review issue.
//
// It only reads/repairs the public price record. It does not touch accounts,
// permissions, or moderation actions — those are human decisions.

import path from 'node:path';
import {
  REPORTS_DIR, log, readJSON, writeJSON, listHistoryFiles, reportFinding,
} from './agentLib.mjs';

const PRICE_FIELD = 'memberPricePerKwh';
const MAD_THRESHOLD = 4;      // robust z-score above which a point is an outlier
const MIN_PEERS = 4;          // need enough peer observations to judge an outlier

function median(xs) {
  const v = xs.filter((x) => x != null && !Number.isNaN(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

// Robust z-score using median absolute deviation.
function madZ(value, peers) {
  const med = median(peers);
  if (med == null) return 0;
  const mad = median(peers.map((p) => Math.abs(p - med)));
  if (!mad) return value === med ? 0 : Infinity;
  return Math.abs(value - med) / (1.4826 * mad);
}

async function main() {
  const reporters = new Map(); // author -> { reports, outliers }
  const outliers = [];
  let communityTotal = 0;

  for (const file of await listHistoryFiles()) {
    const stationId = path.basename(file, '.json');
    const rows = await readJSON(file, []);
    if (!Array.isArray(rows) || rows.length === 0) continue;

    const prices = rows.map((r) => r[PRICE_FIELD]).filter((v) => v != null && !Number.isNaN(v));

    for (const r of rows) {
      if (r.source !== 'community_report') continue;
      communityTotal++;
      const author = r.reportedBy || 'unknown';
      const stat = reporters.get(author) || { reports: 0, outliers: 0 };
      stat.reports++;

      const value = r[PRICE_FIELD];
      if (value != null && prices.length >= MIN_PEERS) {
        const peers = prices.filter((p) => p !== value);
        const z = madZ(value, peers);
        if (z >= MAD_THRESHOLD) {
          stat.outliers++;
          outliers.push({
            stationId,
            reportedBy: author,
            reportIssue: r.reportIssue || null,
            capturedAt: r.capturedAt,
            value,
            stationMedian: round(median(peers)),
            robustZ: Number.isFinite(z) ? round(z) : 'inf',
          });
        }
      }
      reporters.set(author, stat);
    }
  }

  const reporterSummary = [...reporters.entries()]
    .map(([author, s]) => ({
      author, reports: s.reports, outliers: s.outliers,
      outlierRate: s.reports ? round(s.outliers / s.reports) : 0,
    }))
    .sort((a, b) => b.outlierRate - a.outlierRate || b.outliers - a.outliers);

  // A reporter is "suspect" only with enough volume AND a high outlier rate —
  // a single mistake from a first-time contributor is not flagged as bad-actor.
  const suspects = reporterSummary.filter((r) => r.reports >= 5 && r.outlierRate >= 0.5);

  const report = {
    ranAt: new Date().toISOString(),
    communityObservations: communityTotal,
    distinctReporters: reporters.size,
    outliersFound: outliers.length,
    outliers: outliers.slice(0, 50),
    reporters: reporterSummary.slice(0, 50),
    suspectReporters: suspects,
  };
  await writeJSON(path.join(REPORTS_DIR, 'community-trust.json'), report);
  log('info', 'community QA', {
    community: communityTotal, reporters: reporters.size, outliers: outliers.length,
  });

  if (outliers.length > 0) {
    await reportFinding({
      title: `Community report QA: ${outliers.length} price(s) need review`,
      labels: ['community', 'data-health'],
      body: [
        'These community-submitted prices sit far from the same station\'s other observations and may be typos (e.g. a decimal slip). Each is surfaced for a human to confirm or correct — none were removed automatically.',
        '',
        ...outliers.slice(0, 20).map((o) =>
          `- \`${o.stationId}\`: reported **$${o.value}/kWh** vs station median **$${o.stationMedian}** (robust z=${o.robustZ})` +
          (o.reportIssue ? ` — from #${o.reportIssue}` : '') +
          (o.reportedBy ? ` by @${o.reportedBy}` : '')),
        '',
        suspects.length
          ? `Reporters with a high outlier rate (>=5 reports, >=50% flagged): ${suspects.map((s) => '@' + s.author + ' (' + s.outliers + '/' + s.reports + ')').join(', ')}. Worth a closer look — but confirm before any action.`
          : 'No individual reporter shows a pattern; these look like isolated slips.',
        '',
        '_Filed automatically by communityQA.mjs. Full detail in reports/community-trust.json._',
      ].join('\n'),
    });
  }
}

function round(x) { return x == null ? null : Math.round(x * 1000) / 1000; }

main().catch((err) => {
  log('error', 'community QA crashed', { error: String(err && err.stack ? err.stack : err) });
  process.exitCode = 1;
});
