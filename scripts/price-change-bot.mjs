import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const dataDir = path.join(root, 'data');
const historyDir = path.join(dataDir, 'history');
const reportsDir = path.join(root, 'reports');

async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return fallback; }
}
async function writeJson(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(data, null, 2) + '\n');
}
async function writeText(file, text) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, text);
}
function fmt(v) { return typeof v === 'number' ? `$${v.toFixed(2)}` : 'n/a'; }
function changed(a, b) { return typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) >= 0.001; }

const stations = await readJson(path.join(dataDir, 'stations.json'), []);
const stationById = new Map(stations.map(s => [s.id, s]));
let files = [];
try { files = (await fs.readdir(historyDir)).filter(f => f.endsWith('.json')); } catch {}

const events = [];
for (const file of files) {
  const stationId = file.replace(/\.json$/, '');
  const station = stationById.get(stationId) || { id: stationId, name: stationId };
  const rows = await readJson(path.join(historyDir, file), []);
  const sorted = rows.filter(r => r && r.capturedAt).sort((a,b) => new Date(a.capturedAt) - new Date(b.capturedAt));
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const next = sorted[i];
    const memberChanged = changed(prev.memberPricePerKwh, next.memberPricePerKwh);
    const nonMemberChanged = changed(prev.nonMemberPricePerKwh, next.nonMemberPricePerKwh);
    const congestionChanged = changed(prev.congestionFeePerMinuteMax, next.congestionFeePerMinuteMax);
    if (!memberChanged && !nonMemberChanged && !congestionChanged) continue;
    events.push({
      stationId,
      stationName: station.name,
      city: station.city || null,
      state: station.state || null,
      detectedAt: next.capturedAt,
      previousCapturedAt: prev.capturedAt,
      memberFrom: prev.memberPricePerKwh ?? null,
      memberTo: next.memberPricePerKwh ?? null,
      nonMemberFrom: prev.nonMemberPricePerKwh ?? null,
      nonMemberTo: next.nonMemberPricePerKwh ?? null,
      congestionFrom: prev.congestionFeePerMinuteMax ?? null,
      congestionTo: next.congestionFeePerMinuteMax ?? null,
      source: 'official_tesla_findus_location_page'
    });
  }
}

events.sort((a,b) => new Date(b.detectedAt) - new Date(a.detectedAt));
await writeJson(path.join(dataDir, 'price-changes.json'), events.slice(0, 1000));

const recent = events.slice(0, 50).map(e => {
  const label = [e.stationName, e.city, e.state].filter(Boolean).join(' - ');
  const parts = [];
  if (e.memberFrom !== e.memberTo) parts.push(`Tesla/member ${fmt(e.memberFrom)} -> ${fmt(e.memberTo)}`);
  if (e.nonMemberFrom !== e.nonMemberTo) parts.push(`Non-Tesla ${fmt(e.nonMemberFrom)} -> ${fmt(e.nonMemberTo)}`);
  if (e.congestionFrom !== e.congestionTo) parts.push(`Congestion ${fmt(e.congestionFrom)}/min -> ${fmt(e.congestionTo)}/min`);
  return `- ${label}: ${parts.join('; ')} at ${e.detectedAt}`;
});

const report = ['# Tesla Price Change Bot Report','',`Generated: ${new Date().toISOString()}`,'',`Price-change events found: ${events.length}`,'','## Recent changes','',...(recent.length ? recent : ['- No price changes detected yet.']),'','## Source','','Official Tesla Find Us station pages are checked by the pricing scraper. This bot compares adjacent observations and records changed Tesla/member, non-Tesla, and congestion-fee values.',''].join('\n');
await writeText(path.join(reportsDir, 'price-change-bot.md'), report);
console.log(report);
