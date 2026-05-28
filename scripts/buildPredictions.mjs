import fs from 'node:fs/promises';
import path from 'node:path';
import { dataDir, historyDir, readJson, writeJson } from './lib.mjs';

function mean(xs) { return xs.reduce((a, b) => a + b, 0) / xs.length; }
function sd(xs) {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
}

function utilizationBand(value) {
  if (typeof value !== 'number') return null;
  if (value >= 0.8) return 'high';
  if (value >= 0.5) return 'medium';
  return 'low';
}

function utilizationImpact(obs, field) {
  const rows = obs.filter(row => typeof row[field] === 'number' && typeof row.utilizationPct === 'number');
  const buckets = new Map();
  for (const row of rows) {
    const band = utilizationBand(row.utilizationPct);
    if (!band) continue;
    if (!buckets.has(band)) buckets.set(band, []);
    buckets.get(band).push(row);
  }

  const lowMean = buckets.has('low') ? mean(buckets.get('low').map(row => row[field])) : null;
  const impact = ['low', 'medium', 'high'].map(band => {
    const bandRows = buckets.get(band) || [];
    const prices = bandRows.map(row => row[field]);
    const utilization = bandRows.map(row => row.utilizationPct);
    const expectedPrice = prices.length ? Number(mean(prices).toFixed(4)) : null;
    return {
      band,
      sampleCount: bandRows.length,
      expectedPrice,
      averageUtilizationPct: utilization.length ? Number(mean(utilization).toFixed(4)) : null,
      deltaFromLow: expectedPrice !== null && lowMean !== null ? Number((expectedPrice - lowMean).toFixed(4)) : null
    };
  });

  return {
    sampleCount: rows.length,
    hasSignal: impact.filter(row => row.sampleCount > 0).length >= 2,
    bands: impact
  };
}

function congestionSummary(obs) {
  const fees = obs.map(row => row.congestionFeePerMinuteMax).filter(value => typeof value === 'number');
  if (!fees.length) return { sampleCount: 0, maxFeePerMinute: null, averageFeePerMinute: null };
  return {
    sampleCount: fees.length,
    maxFeePerMinute: Number(Math.max(...fees).toFixed(4)),
    averageFeePerMinute: Number(mean(fees).toFixed(4))
  };
}

function slotFromObservation(row) {
  if (Number.isInteger(row.halfHourSlot)) return row.halfHourSlot;
  if (typeof row.localHour === 'number') return row.localHour * 2 + (Number(row.localMinute || 0) >= 30 ? 1 : 0);
  const date = new Date(row.capturedAt);
  return date.getHours() * 2 + (date.getMinutes() >= 30 ? 1 : 0);
}

function slotParts(slot) {
  const hour = Math.floor(slot / 2);
  const minute = slot % 2 === 0 ? 0 : 30;
  return { hour, minute, label: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}` };
}

function predictionFor(stationId, obs, field, membershipType) {
  const buckets = new Map();
  const priceRows = obs.filter(row => typeof row[field] === 'number');
  for (const row of obs) {
    const val = row[field];
    if (typeof val !== 'number') continue;
    const slot = slotFromObservation(row);
    if (!buckets.has(slot)) buckets.set(slot, []);
    buckets.get(slot).push(val);
  }
  const slots = [...buckets.entries()].map(([slot, values]) => {
    const m = mean(values);
    const s = sd(values);
    const se = values.length > 1 ? s / Math.sqrt(values.length) : 0;
    const parts = slotParts(slot);
    return {
      slot,
      hour: parts.hour,
      minute: parts.minute,
      label: parts.label,
      expectedPrice: Number(m.toFixed(4)),
      ci95Low: Number(Math.max(0, m - 1.96 * se).toFixed(4)),
      ci95High: Number((m + 1.96 * se).toFixed(4)),
      sampleCount: values.length
    };
  }).sort((a, b) => a.ci95High - b.ci95High || a.expectedPrice - b.expectedPrice);
  if (!slots.length) return null;
  const best = slots[0];
  const latest = [...priceRows].sort((a, b) => new Date(b.capturedAt) - new Date(a.capturedAt))[0];
  return {
    stationId,
    generatedAt: new Date().toISOString(),
    membershipType,
    latestObservedAt: latest?.capturedAt || null,
    latestObservedPrice: latest?.[field] ?? null,
    bestHour: best.hour,
    bestMinute: best.minute,
    bestSlot: best.slot,
    expectedPrice: best.expectedPrice,
    ci95Low: best.ci95Low,
    ci95High: best.ci95High,
    sampleCount: best.sampleCount,
    confidenceLabel: best.sampleCount < 10 ? 'low sample - collect more observations' : '95% confidence interval from station history',
    utilizationImpact: utilizationImpact(obs, field),
    congestion: congestionSummary(obs),
    slots,
    hourly: slots
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
