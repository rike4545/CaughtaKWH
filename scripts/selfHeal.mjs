// selfHeal.mjs
// Agent 1 — Pipeline Sentinel (self-healing).
//
// Runs after the scrape. It:
//   1. Measures "fresh" coverage from predictions.json (latestObservationAgeHours
//      <= 2) and total observation rows across data/history/.
//   2. Retries recoverable failures with backoff.
//   3. Restores last-known-good stations.json if a run regressed.
//   4. Escalates structural / access-blocked / unknown cases to a human.
//
// It deliberately does NOT bypass access controls. The real scraper already
// detects Akamai challenge walls; if Tesla is blocking, that is escalated, not
// worked around.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { copyFile } from 'node:fs/promises';
import path from 'node:path';
import {
  DATA_DIR, log, readJSON, withRetry, isTransient, reportFinding, fileAgeHours,
  listHistoryFiles,
} from './agentLib.mjs';

const run = promisify(execFile);
const SNAPSHOT = path.join(DATA_DIR, '.last-good-stations.json');
const STATIONS = path.join(DATA_DIR, 'stations.json');
const PREDICTIONS = path.join(DATA_DIR, 'predictions.json');

async function npmRun(script, env = {}) {
  return withRetry(
    () => run('npm', ['run', script], { env: { ...process.env, ...env }, maxBuffer: 64 * 1024 * 1024 }),
    { label: `npm run ${script}`, tries: 3 }
  );
}

function classify(err, before, after) {
  const msg = String(err && err.message ? err.message : err || '').toLowerCase();
  if (msg.includes('akamai') || msg.includes('challenge') || msg.includes('403') ||
      msg.includes('access denied') || msg.includes('captcha') || msg.includes('blocked')) {
    return 'access-blocked'; // human escalation — do NOT auto-work-around
  }
  if (isTransient(err)) return 'transient';
  if (msg.includes('selector') || msg.includes('not found') ||
      msg.includes('cannot read') || msg.includes('undefined') || msg.includes('next_data')) {
    return 'structural';
  }
  if (after && before && after.totalObs < before.totalObs) return 'data-regression';
  return 'unknown';
}

// Coverage snapshot from real data: fresh predictions + total observation rows.
async function snapshot() {
  const predictions = await readJSON(PREDICTIONS, []);
  const fresh = Array.isArray(predictions)
    ? predictions.filter((p) => typeof p.latestObservationAgeHours === 'number' && p.latestObservationAgeHours <= 2).length
    : 0;
  let totalObs = 0;
  for (const file of await listHistoryFiles()) {
    const rows = await readJSON(file, []);
    if (Array.isArray(rows)) totalObs += rows.length;
  }
  return { freshPredictions: fresh, totalObs, predictions: Array.isArray(predictions) ? predictions.length : 0 };
}

async function main() {
  const before = await snapshot();
  log('info', 'self-heal start', before);

  let scrapeErr = null;
  try {
    await npmRun('scrape', {
      TESLA_HEADLESS: process.env.TESLA_HEADLESS ?? 'false',
      MAX_STATIONS: process.env.MAX_STATIONS ?? '25',
      SCRAPE_NEEDS_HISTORY: 'true',
    });
  } catch (err) {
    scrapeErr = err;
  }

  // Rebuild predictions so freshness reflects the new scrape.
  try { await npmRun('predict'); } catch (e) { log('warn', 'predict failed', { error: String(e) }); }

  const after = await snapshot();
  const improved = after.totalObs > before.totalObs || after.freshPredictions > before.freshPredictions;
  const kind = !scrapeErr && improved ? 'ok' : classify(scrapeErr, before, after);
  log('info', 'classified', { kind, before, after });

  if (kind === 'ok') {
    try {
      await npmRun('validate:data');
      await npmRun('sync:public');
      if (existsSync(STATIONS)) await copyFile(STATIONS, SNAPSHOT);
      log('info', 'pipeline healthy, snapshot saved');
    } catch (err) {
      log('error', 'downstream failed after good scrape', { error: String(err) });
    }
    return;
  }

  if (kind === 'transient') {
    try {
      await npmRun('scrape', { MAX_STATIONS: '10', SCRAPE_NEEDS_HISTORY: 'true' });
      await npmRun('predict');
      await npmRun('sync:public');
      log('info', 'recovered after transient retry');
      return;
    } catch { /* fall through */ }
  }

  if (kind === 'data-regression' && existsSync(SNAPSHOT)) {
    await copyFile(SNAPSHOT, STATIONS);
    await npmRun('sync:public').catch(() => {});
    log('warn', 'restored last-known-good stations after regression');
  }

  const stationsAge = await fileAgeHours(STATIONS);
  await reportFinding({
    title: `Self-heal needs attention: ${kind}`,
    labels: ['self-heal', kind],
    body: [
      'The self-healing agent could not fully recover the pipeline.',
      '',
      `**Classification:** \`${kind}\``,
      `**Fresh predictions before/after:** ${before.freshPredictions} -> ${after.freshPredictions}`,
      `**Total observations before/after:** ${before.totalObs} -> ${after.totalObs}`,
      `**stations.json age (h):** ${stationsAge.toFixed(1)}`,
      '',
      kind === 'access-blocked'
        ? 'Tesla appears to be serving an Akamai challenge / block instead of content. This is intentionally NOT worked around. Recommended: confirm the public page renders in a normal browser, ease the schedule, and respect rate signals. Do not add evasion tooling.'
        : kind === 'structural'
        ? 'Price extraction likely broke due to a page/markup change (e.g. __NEXT_DATA__ shape). Run `npm run agent:drift` for candidate fixes, then update inferPrices/selectors in scrapePrices.mjs.'
        : 'Not recoverable automatically. See run logs.',
      '',
      '_Filed automatically by selfHeal.mjs._',
    ].join('\n'),
  });
}

main().catch((err) => {
  log('error', 'self-heal crashed', { error: String(err && err.stack ? err.stack : err) });
  process.exitCode = 1;
});
