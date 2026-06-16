/**
 * ingestSheet.mjs
 * Pulls anonymous price reports from a published Google Sheet (fed by a Google
 * Form) into station price history — so contributors don't need a GitHub account.
 *
 * Setup (done once, by the maintainer):
 *   1. Make a Google Form with questions for: Station (CaughtaKWH ID or Tesla URL),
 *      Tesla/member price, Non-Tesla price, Congestion fee, Date seen.
 *   2. Link it to a Sheet (Form editor → Responses → "Link to Sheets").
 *   3. File → Share → Publish to web → the responses sheet → CSV → copy the URL.
 *   4. Put that URL in repo Settings → Secrets and variables → Actions →
 *      Variables as SHEET_CSV_URL. The workflow passes it in as env.
 *
 * Safety: every row is validated with the same bounds as the GitHub ingester,
 * rows are de-duplicated by content + a stored cursor, and accepted rows are
 * tagged source:'community_form'. Anonymous = higher spam risk, so we validate
 * hard and let the existing communityQA agent flag outliers downstream.
 *
 * This script only READS a public CSV and writes to the repo's own history. It
 * does not expose any endpoint or hold any third-party credential.
 */

import fs from 'node:fs';
import path from 'node:path';
import { dataDir, readJson, writeJson, nowIso, stationHistoryPath } from './lib.mjs';

const STATE_FILE = path.join(dataDir, 'sheet-ingest-state.json');
const STATIONS_FILE = path.join(dataDir, 'stations.json');
const SHEET_URL = process.env.SHEET_CSV_URL || '';
const LOCAL_CSV = process.env.SHEET_CSV_FILE || ''; // for local testing only
const MAX_ROWS_PER_RUN = 500;

function emit(status, message) {
  const out = process.env.GITHUB_OUTPUT;
  if (out) fs.appendFileSync(out, `status=${status}\nmessage<<MSG_EOF\n${message}\nMSG_EOF\n`);
  console.log(`[sheet] ${status}: ${message}`);
}

// --- Minimal RFC-4180 CSV parser (handles quotes, commas, newlines) ----------
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', i = 0, inQ = false;
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  while (i < text.length) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQ = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { inQ = true; i++; continue; }
    if (c === ',') { row.push(field); field = ''; i++; continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += c; i++;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.length && r.some(x => x.trim() !== ''));
}

function toObjects(rows) {
  if (!rows.length) return [];
  const headers = rows[0].map(h => h.trim().toLowerCase());
  return rows.slice(1).map(r => {
    const o = {};
    headers.forEach((h, idx) => { o[h] = (r[idx] || '').trim(); });
    return o;
  });
}

// Flexible column mapping by predicate, so form wording can vary without the
// price columns colliding with the station column (which may mention "Tesla URL").
function byPred(obj, pred) {
  const key = Object.keys(obj).find(pred);
  return key ? obj[key] : null;
}
const has = (k, ...subs) => subs.some(s => k.includes(s));
function mapRow(o) {
  return {
    timestamp: byPred(o, k => has(k, 'timestamp')),
    station: byPred(o, k => has(k, 'station', 'supercharger')),
    // member price: a price column mentioning member/tesla but NOT "non"
    member: byPred(o, k => has(k, 'price') && has(k, 'member', 'tesla') && !has(k, 'non')),
    // non-member price: a price column that mentions "non"
    nonmember: byPred(o, k => has(k, 'price') && has(k, 'non')),
    congestion: byPred(o, k => has(k, 'congestion')),
    observedAt: byPred(o, k => has(k, 'date', 'when') && !has(k, 'timestamp')),
  };
}

// --- Validation (mirrors ingestPriceReports bounds) --------------------------
function parsePrice(value, { min, max }) {
  if (value == null || value === '') return { value: null };
  const num = Number(String(value).replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(num)) return { error: `"${value}" is not a number` };
  if (num < min || num > max) return { error: `${num} outside ${min}-${max}` };
  return { value: Number(num.toFixed(3)) };
}
function slugFromInput(value) {
  const url = String(value || '').match(/\/findus\/location\/supercharger\/([^?#/\s]+)/i)?.[1];
  return (url || String(value || '').trim()).toLowerCase();
}
function resolveStation(stations, input) {
  if (!input) return null;
  const raw = String(input).trim();
  const exact = stations.find(s => String(s.id).toLowerCase() === raw.toLowerCase());
  if (exact) return exact;
  const slug = slugFromInput(raw);
  return stations.find(s => String(s.id).toLowerCase() === slug)
    || stations.find(s => slugFromInput(s.url) === slug) || null;
}

function rowHash(m) {
  return [m.timestamp, m.station, m.member, m.nonmember, m.congestion, m.observedAt].join('|');
}

async function main() {
  if (!SHEET_URL && !LOCAL_CSV) {
    emit('skipped', 'No SHEET_CSV_URL configured yet — nothing to ingest. Set the repo variable to enable Google Form intake.');
    return;
  }

  let csv;
  try {
    csv = LOCAL_CSV ? fs.readFileSync(LOCAL_CSV, 'utf8')
                    : await (await fetch(SHEET_URL, { redirect: 'follow' })).text();
  } catch (err) {
    emit('error', `Could not fetch the published sheet CSV: ${err.message}`);
    process.exit(0);
  }

  const objects = toObjects(parseCsv(csv));
  const stations = await readJson(STATIONS_FILE, []);
  const state = await readJson(STATE_FILE, { lastTimestamp: null, seen: [] });
  const seen = new Set(state.seen || []);

  let added = 0, skipped = 0, invalid = 0, unresolved = 0;
  const touched = new Map(); // stationId -> history array
  let maxTs = state.lastTimestamp ? Date.parse(state.lastTimestamp) : 0;
  const reasons = [];

  for (const o of objects.slice(0, MAX_ROWS_PER_RUN)) {
    const m = mapRow(o);
    const h = rowHash(m);
    if (seen.has(h)) { skipped++; continue; }

    const station = resolveStation(stations, m.station);
    if (!station) { unresolved++; seen.add(h); continue; }

    const member = parsePrice(m.member, { min: 0.05, max: 2.5 });
    const nonmember = parsePrice(m.nonmember, { min: 0.05, max: 2.5 });
    const congestion = parsePrice(m.congestion, { min: 0.01, max: 5 });
    if (member.error || nonmember.error || congestion.error) {
      invalid++; seen.add(h);
      reasons.push(`${station.id}: ${[member.error, nonmember.error, congestion.error].filter(Boolean).join('; ')}`);
      continue;
    }
    if (member.value == null && nonmember.value == null) { invalid++; seen.add(h); continue; }

    // Timestamp: prefer the observed date, else the form submission time, else now.
    let capturedAt = nowIso();
    const dateRaw = m.observedAt || m.timestamp;
    if (dateRaw) {
      const parsed = new Date(dateRaw);
      if (!Number.isNaN(parsed.getTime())) {
        const ageDays = (Date.now() - parsed.getTime()) / 86400000;
        if (ageDays >= -1 && ageDays <= 366) capturedAt = parsed.toISOString();
      }
    }
    const captured = new Date(capturedAt);
    const lowest = [member.value, nonmember.value].filter(v => v != null).sort((a, b) => a - b)[0] ?? null;

    const observation = {
      stationId: station.id,
      capturedAt,
      localDate: capturedAt.slice(0, 10),
      localHour: captured.getHours(),
      localMinute: captured.getMinutes(),
      halfHourSlot: captured.getHours() * 2 + (captured.getMinutes() >= 30 ? 1 : 0),
      memberPricePerKwh: member.value,
      memberPeakPricePerKwh: null,
      nonMemberPricePerKwh: nonmember.value,
      nonMemberPeakPricePerKwh: null,
      congestionFeePerMinuteMax: congestion.value,
      lowestObservedPricePerKwh: lowest,
      lowPriceId: typeof lowest === 'number' && lowest < 0.3 ? 'low_under_030_kwh' : null,
      priceExtractionVersion: 'community-form-v1',
      availableStalls: null,
      totalStalls: typeof station.stalls === 'number' ? station.stalls : null,
      utilizationPct: null,
      availabilityLabel: null,
      currency: 'USD',
      source: 'community_form',
      reportedBy: 'anonymous (Google Form)',
      url: station.url || null,
    };

    const file = stationHistoryPath(station.id);
    let hist = touched.get(station.id);
    if (!hist) { hist = await readJson(file, []); touched.set(station.id, hist); }
    const keyOf = x => `${x.capturedAt}-${x.memberPricePerKwh}-${x.nonMemberPricePerKwh}-${x.congestionFeePerMinuteMax}`;
    if (!hist.some(x => keyOf(x) === keyOf(observation))) { hist.push(observation); added++; }

    seen.add(h);
    if (m.timestamp) { const t = Date.parse(m.timestamp); if (!Number.isNaN(t) && t > maxTs) maxTs = t; }
  }

  // Persist histories + station flags.
  for (const [id, hist] of touched) {
    hist.sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt));
    await writeJson(stationHistoryPath(id), hist);
    const st = stations.find(s => s.id === id);
    if (st) st.lastObservationSource = 'community_form';
  }
  if (touched.size) await writeJson(STATIONS_FILE, stations);

  // Cap the seen-set so state doesn't grow forever (recent hashes are enough).
  await writeJson(STATE_FILE, {
    lastTimestamp: maxTs ? new Date(maxTs).toISOString() : state.lastTimestamp,
    updatedAt: nowIso(),
    seen: [...seen].slice(-5000),
  });

  const summary = `Sheet ingest: +${added} new observation(s), ${skipped} already seen, ${invalid} invalid, ${unresolved} unmatched station(s).`;
  emit(added > 0 ? 'success' : 'noop', summary + (reasons.length ? ` First issues: ${reasons.slice(0, 3).join(' | ')}` : ''));
}

main().catch(err => { emit('error', String(err && err.stack ? err.stack : err)); process.exit(0); });
