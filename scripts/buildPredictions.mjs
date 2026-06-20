import fs from 'node:fs/promises';
import path from 'node:path';
import { dataDir, historyDir, readJson, writeJson } from './lib.mjs';
import { predictNeuralPrice } from './pricingNeuralNetwork.mjs';

function mean(xs) { return xs.reduce((a, b) => a + b, 0) / xs.length; }
function sd(xs) {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
}
function median(xs) {
  if (!xs.length) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}
function hoursSince(iso) {
  if (!iso) return null;
  return Math.max(0, (Date.now() - new Date(iso).getTime()) / 36e5);
}
function freshnessLabel(ageHours) {
  if (typeof ageHours !== 'number') return 'no public price observation';
  if (ageHours <= 0.5) return 'fresh: observed within 30 minutes';
  if (ageHours <= 2) return 'recent: observed within 2 hours';
  if (ageHours <= 12) return 'aging: observed today';
  if (ageHours <= 48) return 'stale: older than 12 hours';
  return 'very stale: older than 2 days';
}
function currentPriceStatus(ageHours) {
  if (typeof ageHours !== 'number') return 'missing';
  if (ageHours <= 0.5) return 'fresh';
  if (ageHours <= 2) return 'recent';
  if (ageHours <= 12) return 'aging';
  if (ageHours <= 48) return 'stale';
  return 'very_stale';
}
function confidence(sampleCount, ageHours, volatility) {
  let score = 0;
  if (sampleCount >= 30) score += 35; else if (sampleCount >= 10) score += 25; else if (sampleCount >= 3) score += 14; else score += 6;
  if (typeof ageHours === 'number') {
    if (ageHours <= 0.5) score += 35; else if (ageHours <= 2) score += 26; else if (ageHours <= 12) score += 16; else if (ageHours <= 48) score += 8;
  }
  if (typeof volatility === 'number') {
    if (volatility <= 0.02) score += 25; else if (volatility <= 0.06) score += 16; else score += 8;
  }
  const label = score >= 75 ? 'high' : score >= 45 ? 'medium' : 'low';
  return { score: Math.min(100, score), label };
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
    return { band, sampleCount: bandRows.length, expectedPrice, averageUtilizationPct: utilization.length ? Number(mean(utilization).toFixed(4)) : null, deltaFromLow: expectedPrice !== null && lowMean !== null ? Number((expectedPrice - lowMean).toFixed(4)) : null };
  });
  return { sampleCount: rows.length, hasSignal: impact.filter(row => row.sampleCount > 0).length >= 2, bands: impact };
}
function congestionSummary(obs) {
  const fees = obs.map(row => row.congestionFeePerMinuteMax).filter(value => typeof value === 'number');
  if (!fees.length) return { sampleCount: 0, maxFeePerMinute: null, averageFeePerMinute: null };
  return { sampleCount: fees.length, maxFeePerMinute: Number(Math.max(...fees).toFixed(4)), averageFeePerMinute: Number(mean(fees).toFixed(4)) };
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
function predictionFor(stationId, station, obs, field, membershipType, neuralModel) {
  const buckets = new Map();
  const priceRows = obs.filter(row => typeof row[field] === 'number');
  for (const row of priceRows) {
    const slot = slotFromObservation(row);
    if (!buckets.has(slot)) buckets.set(slot, []);
    buckets.get(slot).push(row[field]);
  }
  const latest = [...priceRows].sort((a, b) => new Date(b.capturedAt) - new Date(a.capturedAt))[0];
  if (!priceRows.length) return null;
  const allPrices = priceRows.map(row => row[field]);
  const overallMean = mean(allPrices);
  const overallSd = sd(allPrices);
  const slots = [...buckets.entries()].map(([slot, values]) => {
    const m = mean(values);
    const s = sd(values);
    const se = values.length > 1 ? s / Math.sqrt(values.length) : overallSd || 0;
    const parts = slotParts(slot);
    return { slot, hour: parts.hour, minute: parts.minute, label: parts.label, expectedPrice: Number(m.toFixed(4)), ci95Low: Number(Math.max(0, m - 1.96 * se).toFixed(4)), ci95High: Number((m + 1.96 * se).toFixed(4)), sampleCount: values.length };
  }).sort((a, b) => a.ci95High - b.ci95High || a.expectedPrice - b.expectedPrice);
  const best = slots[0];
  const ageHours = hoursSince(latest?.capturedAt);
  const status = currentPriceStatus(ageHours);
  const conf = confidence(priceRows.length, ageHours, overallSd);
  const neuralSlots = Array.from({ length: 48 }, (_, slot) => {
    const parts = slotParts(slot);
    const expectedPrice = predictNeuralPrice(neuralModel, { station, observation: latest, membershipType, slotOverride: slot });
    return { slot, hour: parts.hour, minute: parts.minute, label: parts.label, expectedPrice };
  }).filter(row => typeof row.expectedPrice === 'number');
  const neuralBest = [...neuralSlots].sort((a, b) => a.expectedPrice - b.expectedPrice)[0] || null;
  return {
    stationId,
    generatedAt: new Date().toISOString(),
    membershipType,
    latestObservedAt: latest?.capturedAt || null,
    latestObservedPrice: latest?.[field] ?? null,
    latestObservationAgeHours: typeof ageHours === 'number' ? Number(ageHours.toFixed(2)) : null,
    freshnessLabel: freshnessLabel(ageHours),
    currentPriceStatus: status,
    isCurrentPrice: status === 'fresh' || status === 'recent',
    stalePrice: !(status === 'fresh' || status === 'recent'),
    bestHour: best.hour,
    bestMinute: best.minute,
    bestSlot: best.slot,
    expectedPrice: best.expectedPrice,
    averageObservedPrice: Number(overallMean.toFixed(4)),
    medianObservedPrice: Number(median(allPrices).toFixed(4)),
    minObservedPrice: Number(Math.min(...allPrices).toFixed(4)),
    maxObservedPrice: Number(Math.max(...allPrices).toFixed(4)),
    volatility: Number(overallSd.toFixed(4)),
    ci95Low: best.ci95Low,
    ci95High: best.ci95High,
    sampleCount: priceRows.length,
    bestSlotSampleCount: best.sampleCount,
    confidenceScore: conf.score,
    confidenceLabel: conf.label,
    confidenceSummary: `${conf.label} confidence · ${priceRows.length} observation${priceRows.length === 1 ? '' : 's'} · ${freshnessLabel(ageHours)}`,
    pricingStatus: typeof ageHours === 'number' && ageHours <= 2 ? 'recent observation' : typeof ageHours === 'number' ? 'historical observation' : 'no public price observation',
    predictionMethod: neuralModel?.activation?.priceBlending ? 'statistical_neural_blend' : neuralSlots.length ? 'statistical_with_experimental_neural' : 'statistical',
    neuralModel: neuralModel ? {
      version: neuralModel.version,
      status: neuralModel.status,
      reason: neuralModel.reason,
      holdoutMae: neuralModel.metrics?.mae ?? null,
      baselineMae: neuralModel.metrics?.baselineMae ?? null,
      exampleCount: neuralModel.coverage?.exampleCount ?? 0,
      stationCount: neuralModel.coverage?.stationCount ?? 0,
      utilizationCoveragePct: neuralModel.coverage?.utilizationCoveragePct ?? 0,
      historicalCapturesChecked: neuralModel.historicalReview?.checked ?? 0,
      historicalCapturesFlagged: neuralModel.historicalReview?.flagged ?? 0,
      priceBlending: Boolean(neuralModel.activation?.priceBlending)
    } : null,
    neuralBestHour: neuralBest?.hour ?? null,
    neuralBestMinute: neuralBest?.minute ?? null,
    neuralBestExpectedPrice: neuralBest?.expectedPrice ?? null,
    neuralSlots,
    utilizationImpact: utilizationImpact(obs, field),
    congestion: congestionSummary(obs),
    slots,
    hourly: slots
  };
}

await fs.mkdir(historyDir, { recursive: true });
const files = (await fs.readdir(historyDir)).filter(f => f.endsWith('.json'));
const stations = await readJson(path.join(dataDir, 'stations.json'), []);
const stationById = new Map(stations.map(station => [station.id, station]));
const neuralModel = await readJson(path.join(dataDir, 'pricing-neural-model.json'), null);
const predictions = [];
for (const file of files) {
  const stationId = file.replace(/\.json$/, '');
  const obs = await readJson(path.join(historyDir, file), []);
  const station = stationById.get(stationId) || { id: stationId };
  const member = predictionFor(stationId, station, obs, 'memberPricePerKwh', 'member', neuralModel);
  const nonMember = predictionFor(stationId, station, obs, 'nonMemberPricePerKwh', 'non_member', neuralModel);
  if (member) predictions.push(member);
  if (nonMember) predictions.push(nonMember);
}
await writeJson(path.join(dataDir, 'predictions.json'), predictions);
console.log(`Built ${predictions.length} predictions.`);
