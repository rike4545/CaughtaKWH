import fs from 'node:fs/promises';
import path from 'node:path';
import { dataDir, historyDir, readJson, writeJson } from './lib.mjs';

function mean(xs) { return xs.reduce((a, b) => a + b, 0) / xs.length; }
function sd(xs) {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
}
function predictionFor(stationId, obs, field, membershipType) {
  const buckets = new Map();
  for (const row of obs) {
    const val = row[field];
    if (typeof val !== 'number') continue;
    const hour = Number(row.localHour ?? new Date(row.capturedAt).getHours());
    if (!buckets.has(hour)) buckets.set(hour, []);
    buckets.get(hour).push(val);
  }
  const hourly = [...buckets.entries()].map(([hour, values]) => {
    const m = mean(values);
    const s = sd(values);
    const se = values.length > 1 ? s / Math.sqrt(values.length) : 0;
    return {
      hour,
      expectedPrice: Number(m.toFixed(4)),
      ci95Low: Number(Math.max(0, m - 1.96 * se).toFixed(4)),
      ci95High: Number((m + 1.96 * se).toFixed(4)),
      sampleCount: values.length
    };
  }).sort((a, b) => a.ci95High - b.ci95High || a.expectedPrice - b.expectedPrice);
  if (!hourly.length) return null;
  const best = hourly[0];
  return {
    stationId,
    generatedAt: new Date().toISOString(),
    membershipType,
    bestHour: best.hour,
    expectedPrice: best.expectedPrice,
    ci95Low: best.ci95Low,
    ci95High: best.ci95High,
    sampleCount: best.sampleCount,
    confidenceLabel: best.sampleCount < 10 ? 'low sample - collect more observations' : '95% confidence interval from station history',
    hourly
  };
}

await fs.mkdir(historyDir, { recursive: true });
const files = (await fs.readdir(historyDir)).filter(f => f.endsWith('.json'));
const predictions = [];
for (const file of files) {
  const stationId = file.replace(/\.json$/, '');
  const obs = await readJson(path.join(historyDir, file), []);
  const member = predictionFor(stationId, obs, 'memberPricePerKwh', 'member');
  const nonMember = predictionFor(stationId, obs, 'nonMemberPricePerKwh', 'non_member');
  if (member) predictions.push(member);
  if (nonMember) predictions.push(nonMember);
}
await writeJson(path.join(dataDir, 'predictions.json'), predictions);
console.log(`Built ${predictions.length} predictions.`);
