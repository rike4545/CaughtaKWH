/**
 * CaughtaKWH weekly "state of transparency" post for @caughtakwh.
 *
 * ElonJet has recurring stats; ours is the headline accountability number —
 * how much of the US Supercharger network still hides its pricing — plus the
 * cheapest and average prices we have actually captured.
 *
 * Runs weekly. An ISO-week guard (data/social-summary-state.json) prevents a
 * second post in the same week if the workflow runs more than once.
 *
 * Config mirrors socialBot.mjs: MASTODON_ACCESS_TOKEN, MASTODON_INSTANCE,
 * SITE_URL. SOCIAL_DRY_RUN (or no token) = preview only. SOCIAL_FORCE_SUMMARY
 * bypasses the once-per-week guard (for manual testing).
 */

import path from 'node:path';
import { dataDir, readJson, writeJson, nowIso } from './lib.mjs';

const INSTANCE = (process.env.MASTODON_INSTANCE || 'https://mastodon.social').replace(/\/+$/, '');
const TOKEN = String(process.env.MASTODON_ACCESS_TOKEN || '').trim();
const SITE_URL = (process.env.SITE_URL || 'https://rike4545.github.io/CaughtaKWH').replace(/\/+$/, '');
const DRY_RUN = !TOKEN || ['1', 'true', 'yes'].includes(String(process.env.SOCIAL_DRY_RUN || '').toLowerCase());
const FORCE = ['1', 'true', 'yes'].includes(String(process.env.SOCIAL_FORCE_SUMMARY || '').toLowerCase());

const STATIONS_FILE = path.join(dataDir, 'stations.json');
const PREDICTIONS_FILE = path.join(dataDir, 'predictions.json');
const STATE_FILE = path.join(dataDir, 'social-summary-state.json');

const money = v => (typeof v === 'number' ? `$${v.toFixed(2)}` : null);
const pct = (n, d) => (d > 0 ? (n / d) * 100 : 0);

function isoWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

async function postStatus(status) {
  const res = await fetch(`${INSTANCE}/api/v1/statuses`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json', 'Idempotency-Key': `summary-${isoWeek(new Date())}` },
    body: JSON.stringify({ status, visibility: 'public' }),
  });
  if (!res.ok) throw new Error(`Mastodon ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

// --- Compute the week's numbers --------------------------------------------

const stations = await readJson(STATIONS_FILE, []);
const predictions = await readJson(PREDICTIONS_FILE, []);
const stationById = new Map(stations.map(s => [s.id, s]));

const total = stations.length;
const pricedIds = new Set(predictions.filter(p => p.latestObservedPrice != null).map(p => p.stationId));
const priced = pricedIds.size;
const hiddenPct = pct(total - priced, total);
const pricedPct = pct(priced, total);

const memberPrices = predictions
  .filter(p => p.membershipType === 'member' && typeof p.latestObservedPrice === 'number')
  .map(p => ({ price: p.latestObservedPrice, name: stationById.get(p.stationId)?.name || p.stationId }));
const lowest = memberPrices.slice().sort((a, b) => a.price - b.price)[0] || null;
const avg = memberPrices.length ? memberPrices.reduce((a, b) => a + b.price, 0) / memberPrices.length : null;

const now = new Date();
const weekId = isoWeek(now);
const dateLabel = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

const headline = priced === 0
  ? `0 of ${total.toLocaleString()} US Superchargers post a public price. 100% hidden — no rate shown before you plug in.`
  : `${priced.toLocaleString()} of ${total.toLocaleString()} US Superchargers (${pricedPct.toFixed(pricedPct < 1 ? 2 : 1)}%) post${priced === 1 ? 's' : ''} a public price. ${hiddenPct.toFixed(hiddenPct > 99 ? 2 : 1)}% still hidden — no rate shown before you plug in.`;

const detail = [
  lowest ? `Lowest captured: ${money(lowest.price)}/kWh (${lowest.name}).` : null,
  avg && priced > 1 ? `Average captured: ${money(avg)}/kWh.` : null,
].filter(Boolean).join('\n');

const status = [
  `📊 Supercharger price transparency — week of ${dateLabel}`,
  '',
  headline,
  detail || null,
  '',
  'Gas stations post prices at the pump. EV charging should too.',
  SITE_URL,
].filter(v => v !== null).join('\n');

// --- Once-per-week guard + post --------------------------------------------

const state = await readJson(STATE_FILE, {});
if (!FORCE && state.lastWeek === weekId) {
  console.log(`Summary already posted for ${weekId} (status ${state.statusId || 'n/a'}). Skipping. Set SOCIAL_FORCE_SUMMARY=true to override.`);
  process.exit(0);
}

console.log(`Weekly summary for ${weekId}:\n\n${status}\n`);

if (DRY_RUN) {
  console.log('Dry run — nothing posted, state unchanged. Set MASTODON_ACCESS_TOKEN to go live.');
  process.exit(0);
}

const posted = await postStatus(status);
await writeJson(STATE_FILE, { lastWeek: weekId, lastPostedAt: nowIso(), statusId: posted.id });
console.log(`Posted weekly summary (status ${posted.id}). Updated ${STATE_FILE}.`);
