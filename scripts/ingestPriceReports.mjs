/**
 * Ingests a community price report (from a GitHub issue created with the
 * "Supercharger price report" form) into a station's price history.
 *
 * Reads the issue from env (set by the workflow):
 *   ISSUE_NUMBER, ISSUE_BODY, ISSUE_AUTHOR
 *
 * On success it appends one observation tagged `source: community_report` and
 * writes a status line to $GITHUB_OUTPUT (status=success|error, message=...).
 * The workflow uses that to comment back on the issue. Predictions are rebuilt
 * by the workflow (npm run predict) after this script appends.
 */

import fs from 'node:fs';
import path from 'node:path';
import { dataDir, readJson, writeJson, nowIso, stationHistoryPath } from './lib.mjs';

const STATIONS_FILE = path.join(dataDir, 'stations.json');

// --- Output back to the workflow -------------------------------------------

function emit(status, message) {
  const out = process.env.GITHUB_OUTPUT;
  const line = `status=${status}\nmessage<<MSG_EOF\n${message}\nMSG_EOF\n`;
  if (out) fs.appendFileSync(out, line);
  console.log(`[ingest] ${status}: ${message}`);
}

function fail(message) {
  emit('error', message);
  // Exit 0 so the workflow can still post the comment; it inspects `status`.
  process.exit(0);
}

// --- Parse the GitHub issue-form body --------------------------------------
// Issue forms render each field as "### Label\n\n<value>", empty = "_No response_".

function parseForm(body) {
  const fields = {};
  const parts = String(body || '').split(/^###\s+/m).slice(1);
  for (const part of parts) {
    const newline = part.indexOf('\n');
    if (newline < 0) continue;
    const label = part.slice(0, newline).trim().toLowerCase();
    let value = part.slice(newline + 1).trim();
    if (/^_no response_$/i.test(value) || value === '') value = null;
    fields[label] = value;
  }
  const find = needle => {
    const key = Object.keys(fields).find(k => k.includes(needle));
    return key ? fields[key] : null;
  };
  return {
    station: find('station'),
    memberPrice: find('member price'),
    memberPeak: find('member peak'),
    nonMemberPrice: find('non-tesla price'),
    nonMemberPeak: find('non-tesla peak'),
    congestion: find('congestion'),
    observedAt: find('when did you see'),
  };
}

// --- Validation helpers ----------------------------------------------------

function parsePrice(value, { min, max }) {
  if (value == null) return null;
  const num = Number(String(value).replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(num)) return { error: `"${value}" is not a number` };
  if (num < min || num > max) return { error: `${num} is outside the plausible range ${min}–${max}` };
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
    || stations.find(s => slugFromInput(s.url) === slug)
    || null;
}

// --- Main ------------------------------------------------------------------

const issueNumber = Number(process.env.ISSUE_NUMBER || 0) || null;
const author = process.env.ISSUE_AUTHOR || 'community';
const form = parseForm(process.env.ISSUE_BODY || '');

const stations = await readJson(STATIONS_FILE, []);
const station = resolveStation(stations, form.station);
if (!station) {
  fail(`Could not find a Supercharger matching **${form.station || '(blank)'}**. Use the CaughtaKWH station ID or the full Tesla page URL, then edit this issue to retry.`);
}

const member = parsePrice(form.memberPrice, { min: 0.05, max: 2.5 });
const memberPeak = parsePrice(form.memberPeak, { min: 0.05, max: 2.5 });
const nonMember = parsePrice(form.nonMemberPrice, { min: 0.05, max: 2.5 });
const nonMemberPeak = parsePrice(form.nonMemberPeak, { min: 0.05, max: 2.5 });
const congestion = parsePrice(form.congestion, { min: 0.01, max: 5 });

const errors = [member, memberPeak, nonMember, nonMemberPeak, congestion]
  .filter(r => r && r.error).map(r => r.error);
if (errors.length) fail(`Some values could not be used:\n- ${errors.join('\n- ')}\n\nEdit this issue with corrected numbers to retry.`);

const memberVal = member?.value ?? null;
const memberPeakVal = memberPeak?.value ?? null;
const nonMemberVal = nonMember?.value ?? null;
const nonMemberPeakVal = nonMemberPeak?.value ?? null;
const congestionVal = congestion?.value ?? null;

if (memberVal == null && nonMemberVal == null) {
  fail('No usable price found. Fill in at least the Tesla/member or Non-Tesla price, then edit this issue to retry.');
}
if (memberPeakVal != null && memberVal != null && memberPeakVal < memberVal) {
  fail(`The Tesla/member peak price ($${memberPeakVal}) is lower than the off-peak price ($${memberVal}). Peak should be the higher of the two.`);
}
if (nonMemberPeakVal != null && nonMemberVal != null && nonMemberPeakVal < nonMemberVal) {
  fail(`The Non-Tesla peak price ($${nonMemberPeakVal}) is lower than the off-peak price ($${nonMemberVal}). Peak should be the higher of the two.`);
}

// Resolve the observation timestamp.
let capturedAt = nowIso();
if (form.observedAt) {
  const parsed = new Date(form.observedAt);
  if (Number.isNaN(parsed.getTime())) fail(`Could not read the date "${form.observedAt}". Use YYYY-MM-DD, or leave it blank for today.`);
  const ageDays = (Date.now() - parsed.getTime()) / 86400000;
  if (ageDays < -1) fail('The observation date is in the future. Use today or an earlier date.');
  if (ageDays > 366) fail('The observation date is more than a year old, so it will not be added. Report a more recent price.');
  capturedAt = parsed.toISOString();
}

const captured = new Date(capturedAt);
const lowest = [memberVal, nonMemberVal].filter(v => v != null).sort((a, b) => a - b)[0] ?? null;

const observation = {
  stationId: station.id,
  capturedAt,
  localDate: capturedAt.slice(0, 10),
  localHour: captured.getHours(),
  localMinute: captured.getMinutes(),
  halfHourSlot: captured.getHours() * 2 + (captured.getMinutes() >= 30 ? 1 : 0),
  memberPricePerKwh: memberVal,
  memberPeakPricePerKwh: memberPeakVal,
  nonMemberPricePerKwh: nonMemberVal,
  nonMemberPeakPricePerKwh: nonMemberPeakVal,
  congestionFeePerMinuteMax: congestionVal,
  lowestObservedPricePerKwh: lowest,
  lowPriceId: typeof lowest === 'number' && lowest < 0.3 ? 'low_under_030_kwh' : null,
  priceExtractionVersion: 'community-report-v1',
  availableStalls: null,
  totalStalls: typeof station.stalls === 'number' ? station.stalls : null,
  utilizationPct: null,
  availabilityLabel: null,
  currency: 'USD',
  source: 'community_report',
  reportedBy: author,
  reportIssue: issueNumber,
  url: station.url || null,
};

// Append, de-duplicating identical readings.
const historyFile = stationHistoryPath(station.id);
const history = await readJson(historyFile, []);
const keyOf = o => `${o.capturedAt}-${o.memberPricePerKwh}-${o.nonMemberPricePerKwh}-${o.congestionFeePerMinuteMax}`;
const merged = [...history.filter(x => keyOf(x) !== keyOf(observation)), observation];
await writeJson(historyFile, merged);

// Keep station-level flags in sync so the dashboard reflects the new data.
station.lastObservationSource = 'community_report';
const stationsUpdated = stations.map(s => (s.id === station.id ? station : s));
await writeJson(STATIONS_FILE, stationsUpdated);

const summary = [
  memberVal != null ? `Tesla/member **$${memberVal.toFixed(2)}/kWh**${memberPeakVal != null ? ` → $${memberPeakVal.toFixed(2)} peak` : ''}` : null,
  nonMemberVal != null ? `Non-Tesla **$${nonMemberVal.toFixed(2)}/kWh**${nonMemberPeakVal != null ? ` → $${nonMemberPeakVal.toFixed(2)} peak` : ''}` : null,
  congestionVal != null ? `congestion **$${congestionVal.toFixed(2)}/min**` : null,
].filter(Boolean).join(' · ');

emit('success', `Added to **${station.name || station.id}** (${station.state || 'US'}): ${summary}. It now has ${merged.length} saved observation${merged.length === 1 ? '' : 's'}. Thank you for contributing to the public pricing record!`);
