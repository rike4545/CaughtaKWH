// detectDrift.mjs
// Agent 2 — Structure Drift Detector.
//
// The real scraper extracts prices from the page's __NEXT_DATA__ JSON (and falls
// back to HTML token scanning). So the meaningful "did Tesla change the page"
// signals are:
//   1. Akamai / challenge wall instead of content  -> escalate, do NOT bypass.
//   2. __NEXT_DATA__ missing or no longer containing price-like keys -> the
//      extraction path likely needs updating.
//
// It probes a station that SHOULD have a price (one with existing history), so a
// disappearance is meaningful. It proposes where price-like values now live.
// This adapts to legitimate change; it does not defeat protections.

import path from 'node:path';
import {
  DATA_DIR, log, readJSON, writeJSON, reportFinding, listHistoryFiles,
} from './agentLib.mjs';

const FINGERPRINT = path.join(DATA_DIR, '.page-fingerprint.json');
const PRICE_KEY_RE = /(price|kwh|perkwh|member|congestion|fee|rate)/i;
const CHALLENGE_RE = /(akamai|captcha|are you a robot|verify you are human|access denied|reference\s*#)/i;

async function loadPlaywright() {
  try { return await import('playwright'); }
  catch {
    try { return await import('@playwright/test'); }
    catch { log('error', 'playwright not installed'); return null; }
  }
}

// Pick a station that has history (so it should expose a price) and a URL.
async function pickProbe() {
  const stations = await readJSON(path.join(DATA_DIR, 'stations.json'), []);
  const byId = new Map(stations.map((s) => [String(s.id), s]));
  for (const file of await listHistoryFiles()) {
    const id = path.basename(file, '.json');
    const rows = await readJSON(file, []);
    const s = byId.get(id) || byId.get(String(id));
    if (Array.isArray(rows) && rows.length > 0 && s && s.url) return s;
  }
  return stations.find((s) => s.url) || null;
}

// Find price-like leaf paths inside the __NEXT_DATA__ object. Runs in Node.
function findPricePaths(obj, prefix = '', out = [], depth = 0) {
  if (depth > 12 || out.length > 40 || obj == null || typeof obj !== 'object') return out;
  for (const [k, v] of Object.entries(obj)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'number' && PRICE_KEY_RE.test(k)) out.push({ path: p, value: v });
    else if (v && typeof v === 'object') findPricePaths(v, p, out, depth + 1);
  }
  return out;
}

async function main() {
  const pw = await loadPlaywright();
  if (!pw) { process.exitCode = 1; return; }

  const probe = await pickProbe();
  if (!probe || !probe.url) { log('warn', 'no probe station with a URL; skipping'); return; }

  const headless = (process.env.TESLA_HEADLESS ?? 'false') === 'true';
  const chromium = pw.chromium || (pw.default && pw.default.chromium);
  const browser = await chromium.launch({ headless });
  let html = '', nextData = null, challenge = false;
  try {
    const page = await browser.newPage();
    await page.goto(probe.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(4000);
    html = await page.content();
    if (CHALLENGE_RE.test(html)) {
      challenge = true;
    } else {
      nextData = await page.evaluate(() => {
        const el = document.getElementById('__NEXT_DATA__');
        if (!el) return null;
        try { return JSON.parse(el.textContent || 'null'); } catch { return null; }
      });
    }
  } catch (err) {
    log('error', 'probe navigation failed', { error: String(err) });
  } finally {
    await browser.close();
  }

  if (challenge) {
    await reportFinding({
      title: 'Drift detector: challenge wall instead of content',
      labels: ['drift', 'access-blocked'],
      body: `Probing \`${probe.url}\` returned an Akamai/challenge page rather than station content. This is intentionally not worked around. Confirm the page in a normal browser and ease the schedule. No extraction changes proposed.`,
    });
    return;
  }

  const pricePaths = nextData ? findPricePaths(nextData) : [];
  const htmlHasPriceToken = /\$\s*\d|\d+\s*(?:c|cents?|¢)\s*\/?\s*kwh/i.test(html);
  const current = {
    probedAt: new Date().toISOString(),
    stationId: probe.id,
    url: probe.url,
    hasNextData: Boolean(nextData),
    pricePaths: pricePaths.map((p) => p.path),
    htmlHasPriceToken,
  };
  const prev = await readJSON(FINGERPRINT, null);
  await writeJSON(FINGERPRINT, current);

  if (!prev) { log('info', 'baseline fingerprint created', { paths: pricePaths.length }); return; }

  const priceGone = pricePaths.length === 0 && !htmlHasPriceToken;
  const pathsChanged = prev.pricePaths && prev.pricePaths.length > 0 &&
    pricePaths.length > 0 &&
    prev.pricePaths.join('|') !== current.pricePaths.join('|');

  if (priceGone) {
    await reportFinding({
      title: 'Drift detector: no price found where one is expected',
      labels: ['drift', 'structural'],
      body: [
        `Probed \`${probe.url}\` (a station with existing history) and found **no** price in __NEXT_DATA__ or HTML.`,
        `\`__NEXT_DATA__\` present: ${current.hasNextData}.`,
        '',
        prev.pricePaths && prev.pricePaths.length
          ? 'Previously price-bearing paths:\n' + prev.pricePaths.map((p) => '- `' + p + '`').join('\n')
          : 'No previous price paths recorded.',
        '',
        'The __NEXT_DATA__ shape or price keys likely changed. Update `inferPrices` in `scripts/scrapePrices.mjs`.',
        '',
        '_Filed automatically by detectDrift.mjs._',
      ].join('\n'),
    });
  } else if (pathsChanged) {
    await reportFinding({
      title: 'Drift detector: price location changed in __NEXT_DATA__',
      labels: ['drift', 'structural'],
      body: [
        'Price-bearing fields moved within __NEXT_DATA__. The extractor may need updating.',
        '',
        '**Was:** ' + prev.pricePaths.map((p) => '`' + p + '`').join(', '),
        '**Now:** ' + current.pricePaths.map((p) => '`' + p + '`').join(', '),
        '',
        '_Filed automatically by detectDrift.mjs._',
      ].join('\n'),
    });
  } else {
    log('info', 'no drift detected', { paths: pricePaths.length });
  }
}

main().catch((err) => {
  log('error', 'drift detector crashed', { error: String(err && err.stack ? err.stack : err) });
  process.exitCode = 1;
});
