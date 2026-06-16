// predictionQA.mjs
// Agent 5 — Prediction QA / backtesting.
//
// Real schema: history rows use `capturedAt` + `memberPricePerKwh` (dollars).
// predictions.json is an array of entries keyed by {stationId, membershipType}.
//
// Leakage-safe backtest: for each station with enough history, hold out the most
// recent N observations, recompute the historical-average baseline from the
// earlier rows, and measure error against the held-out actuals. Error is
// reported in cents/kWh for readability. Flags regressions vs the prior run.

import path from 'node:path';
import {
  REPORTS_DIR, log, readJSON, writeJSON, listHistoryFiles, reportFinding,
} from './agentLib.mjs';

const HOLDOUT = 3;
const REGRESSION_THRESHOLD = 1.25; // 25% worse than last run triggers a flag
const PRICE_FIELD = 'memberPricePerKwh';

function mean(xs) {
  const v = xs.filter((x) => x != null && !Number.isNaN(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

async function main() {
  const files = await listHistoryFiles();
  const perStation = [];
  let totalAbsErr = 0;
  let n = 0;

  for (const file of files) {
    const stationId = path.basename(file, '.json');
    const rows = await readJSON(file, []);
    if (!Array.isArray(rows)) continue;

    const obs = rows
      .map((o) => ({ t: Date.parse(o.capturedAt), p: o[PRICE_FIELD] }))
      .filter((o) => !Number.isNaN(o.t) && o.p != null)
      .sort((a, b) => a.t - b.t);

    if (obs.length < HOLDOUT + 3) continue;

    const train = obs.slice(0, obs.length - HOLDOUT);
    const test = obs.slice(obs.length - HOLDOUT);
    const predicted = mean(train.map((o) => o.p));
    if (predicted == null) continue;

    // Error in cents/kWh.
    const errorsCents = test.map((o) => Math.abs(o.p - predicted) * 100);
    const mae = mean(errorsCents);
    perStation.push({ stationId, maeCents: round(mae), predictedCents: round(predicted * 100), samples: test.length });
    totalAbsErr += mae * test.length;
    n += test.length;
  }

  const overallMAE = n ? totalAbsErr / n : null;
  const report = {
    ranAt: new Date().toISOString(),
    units: 'cents_per_kwh',
    stationsEvaluated: perStation.length,
    overallMAECents: round(overallMAE),
    worst: perStation.sort((a, b) => b.maeCents - a.maeCents).slice(0, 10),
  };
  await writeJSON(path.join(REPORTS_DIR, 'prediction-accuracy.json'), report);
  log('info', 'prediction QA', { overallMAECents: report.overallMAECents, stations: perStation.length });

  const histFile = path.join(REPORTS_DIR, 'prediction-accuracy-history.json');
  const history = await readJSON(histFile, []);
  const last = history[history.length - 1];
  history.push({ at: report.ranAt, maeCents: report.overallMAECents, stations: perStation.length });
  await writeJSON(histFile, history.slice(-200));

  if (last && last.maeCents && report.overallMAECents && report.overallMAECents > last.maeCents * REGRESSION_THRESHOLD) {
    await reportFinding({
      title: 'Prediction accuracy regressed',
      labels: ['prediction', 'regression'],
      body: [
        'Backtested prediction error increased meaningfully versus the last run.',
        '',
        `- Previous MAE: **${last.maeCents}c/kWh**`,
        `- Current MAE: **${report.overallMAECents}c/kWh**`,
        `- Stations evaluated: ${perStation.length}`,
        '',
        'Worst stations this run:',
        ...report.worst.map((w) => `- \`${w.stationId}\`: ${w.maeCents}c error`),
        '',
        'Likely causes: a model change, a data-quality issue (run Data Doctor), or genuine volatility. Review before shipping.',
        '',
        '_Filed automatically by predictionQA.mjs._',
      ].join('\n'),
    });
  }
}

function round(x) { return x == null ? null : Math.round(x * 100) / 100; }

main().catch((err) => {
  log('error', 'prediction QA crashed', { error: String(err && err.stack ? err.stack : err) });
  process.exitCode = 1;
});
