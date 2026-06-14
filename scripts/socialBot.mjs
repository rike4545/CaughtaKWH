/**
 * CaughtaKWH social bot — posts new and changed Supercharger pricing to Mastodon.
 *
 * Modeled on @elonjet's pattern: one terse, factual event per post, with an
 * accountability follow-up (their fuel→CO2; ours price→local-grid multiple).
 *
 * Events it announces, compared against data/social-posted.json:
 *   - "first": a station's first public price on record
 *   - "change": the member or non-Tesla price changed since we last posted it
 *
 * Config (env / GitHub secrets):
 *   MASTODON_ACCESS_TOKEN  required to actually post (write:statuses scope)
 *   MASTODON_INSTANCE      default https://mastodon.social
 *   SITE_URL               default https://rike4545.github.io/CaughtaKWH
 *   SOCIAL_MAX_POSTS       cap announcements per run (default 5)
 *   SOCIAL_MAX_AGE_DAYS    only announce observations newer than this (default 30)
 *   SOCIAL_DRY_RUN         force preview mode (no posting, no ledger writes)
 *
 * With no token (or SOCIAL_DRY_RUN), it prints what it would post and exits.
 */

import fs from 'node:fs';
import path from 'node:path';
import { dataDir, historyDir, readJson, writeJson, nowIso } from './lib.mjs';

const INSTANCE = (process.env.MASTODON_INSTANCE || 'https://mastodon.social').replace(/\/+$/, '');
const TOKEN = String(process.env.MASTODON_ACCESS_TOKEN || '').trim();
const SITE_URL = (process.env.SITE_URL || 'https://rike4545.github.io/CaughtaKWH').replace(/\/+$/, '');
const MAX_POSTS = Math.max(1, Number(process.env.SOCIAL_MAX_POSTS || 5));
const MAX_AGE_DAYS = Math.max(1, Number(process.env.SOCIAL_MAX_AGE_DAYS || 30));
const DRY_RUN = !TOKEN || ['1', 'true', 'yes'].includes(String(process.env.SOCIAL_DRY_RUN || '').toLowerCase());

const STATIONS_FILE = path.join(dataDir, 'stations.json');
const LEDGER_FILE = path.join(dataDir, 'social-posted.json');

// State commercial-electricity benchmarks (¢/kWh) — mirrors commercialBenchmarks
// in src/main.jsx. Used only for the "x the local grid rate" accountability line.
const GRID_CENTS = {
  CA: 29.14, MA: 26.08, NY: 22.21, CT: 21.84, NJ: 17.92, CO: 14.21, AZ: 13.55,
  MI: 13.41, IL: 12.98, PA: 12.44, FL: 12.31, GA: 11.47, TX: 11.23, OH: 11.18,
  VA: 9.84, NC: 9.62, WA: 9.11,
};

const money = v => (typeof v === 'number' ? `$${v.toFixed(2)}` : null);

// --- Gather candidate events ----------------------------------------------

function latestPricedRecord(history) {
  for (let i = history.length - 1; i >= 0; i--) {
    const r = history[i];
    if (typeof r.memberPricePerKwh === 'number' || typeof r.nonMemberPricePerKwh === 'number') return r;
  }
  return null;
}

function priceLine(label, off, peak) {
  if (typeof off !== 'number') return null;
  return `${label} ${money(off)}/kWh${typeof peak === 'number' ? ` off-peak → ${money(peak)} peak` : ''}`;
}

function changeLine(label, oldVal, newVal) {
  if (typeof newVal !== 'number') return null;
  if (typeof oldVal !== 'number' || oldVal === newVal) return `${label} ${money(newVal)}/kWh`;
  const pct = Math.round(((newVal - oldVal) / oldVal) * 100);
  const arrow = newVal > oldVal ? '▲' : '▼';
  return `${label} ${money(oldVal)} → ${money(newVal)}/kWh (${arrow}${Math.abs(pct)}%)`;
}

function gridImpact(state, off) {
  const grid = GRID_CENTS[state];
  if (typeof grid !== 'number' || typeof off !== 'number') return null;
  const mult = (off * 100) / grid;
  return `That's ${mult.toFixed(1)}× the ${state} commercial grid rate (${grid.toFixed(1)}¢/kWh).`;
}

function buildEvent(station, record, ledgerEntry) {
  const name = station.name || station.id;
  const place = station.state ? `${name}` : name;
  const link = `${SITE_URL}/#${station.id}`;
  const member = record.memberPricePerKwh ?? null;
  const memberPeak = record.memberPeakPricePerKwh ?? null;
  const nonMember = record.nonMemberPricePerKwh ?? null;
  const nonMemberPeak = record.nonMemberPeakPricePerKwh ?? null;
  const congestion = record.congestionFeePerMinuteMax ?? null;
  const community = record.source === 'community_report';

  const isFirst = !ledgerEntry;
  const memberChanged = ledgerEntry && member !== (ledgerEntry.member ?? null);
  const nonChanged = ledgerEntry && nonMember !== (ledgerEntry.nonMember ?? null);
  if (!isFirst && !memberChanged && !nonChanged) return null; // nothing new

  let header, lines;
  if (isFirst) {
    header = `⚡ ${place} — first public Supercharger price on record.`;
    lines = [priceLine('Tesla/member', member, memberPeak), priceLine('Non-Tesla', nonMember, nonMemberPeak)];
  } else {
    header = `⚡ ${place} — Supercharger price changed.`;
    lines = [changeLine('Tesla/member', ledgerEntry.member, member), changeLine('Non-Tesla', ledgerEntry.nonMember, nonMember)];
  }
  lines = lines.filter(Boolean);
  if (congestion != null) lines.push(`Congestion up to ${money(congestion)}/min.`);
  if (community) lines.push('(community-reported)');

  const status = `${header}\n${lines.join('\n')}\n${link}`;
  const impact = gridImpact(station.state, member ?? nonMember);

  return { stationId: station.id, type: isFirst ? 'first' : 'change', status, impact, member, nonMember, capturedAt: record.capturedAt };
}

// --- Mastodon posting ------------------------------------------------------

async function postStatus(status, { inReplyTo, idempotencyKey } = {}) {
  const res = await fetch(`${INSTANCE}/api/v1/statuses`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    body: JSON.stringify({ status, visibility: 'public', ...(inReplyTo ? { in_reply_to_id: inReplyTo } : {}) }),
  });
  if (!res.ok) throw new Error(`Mastodon ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

// --- Main ------------------------------------------------------------------

const stations = await readJson(STATIONS_FILE, []);
const stationById = new Map(stations.map(s => [s.id, s]));
const ledger = await readJson(LEDGER_FILE, {});

const files = fs.existsSync(historyDir) ? fs.readdirSync(historyDir).filter(f => f.endsWith('.json')) : [];
const cutoff = Date.now() - MAX_AGE_DAYS * 86400000;

const events = [];
for (const file of files) {
  const stationId = file.replace(/\.json$/, '');
  const station = stationById.get(stationId);
  if (!station) continue;
  const history = await readJson(path.join(historyDir, file), []);
  const record = latestPricedRecord(history);
  if (!record) continue;
  if (new Date(record.capturedAt).getTime() < cutoff) continue; // too old to announce as new
  const event = buildEvent(station, record, ledger[stationId]);
  if (event) events.push(event);
}

// Newest first, then cap per run so a big refresh never floods the timeline.
events.sort((a, b) => new Date(b.capturedAt) - new Date(a.capturedAt));
const toPost = events.slice(0, MAX_POSTS);

console.log(`${events.length} pricing event(s) to announce${events.length > MAX_POSTS ? `, posting ${MAX_POSTS} this run` : ''}. ${DRY_RUN ? '(dry run)' : `Posting to ${INSTANCE} as @caughtakwh.`}`);

for (const event of toPost) {
  console.log(`\n--- ${event.type.toUpperCase()} · ${event.stationId} ---\n${event.status}${event.impact ? `\n[reply] ${event.impact}` : ''}`);
  if (DRY_RUN) continue;
  try {
    const posted = await postStatus(event.status, { idempotencyKey: `${event.stationId}-${event.member}-${event.nonMember}` });
    if (event.impact) {
      await postStatus(event.impact, { inReplyTo: posted.id, idempotencyKey: `${event.stationId}-impact-${event.member}-${event.nonMember}` });
    }
    ledger[event.stationId] = { member: event.member, nonMember: event.nonMember, type: event.type, postedAt: nowIso(), statusId: posted.id };
  } catch (error) {
    console.error(`Failed to post for ${event.stationId}: ${error.message}`);
  }
}

if (!DRY_RUN) {
  await writeJson(LEDGER_FILE, ledger);
  console.log(`\nUpdated ${LEDGER_FILE}.`);
} else if (toPost.length) {
  console.log('\nDry run — no posts sent and ledger unchanged. Set MASTODON_ACCESS_TOKEN to go live.');
}
