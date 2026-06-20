import assert from 'node:assert/strict';
import { FEATURE_NAMES, buildTrainingExamples, featureVector, trainPricingNetwork, validateCapturedPrices } from './pricingNeuralNetwork.mjs';

const station = { id: 'test', lat: 40.8, lng: -73.1, stalls: 12, maxKw: 250 };
const histories = { test: [] };
for (let day = 1; day <= 24; day++) {
  for (const hour of [1, 4, 7, 10, 13, 16, 19, 22]) {
    const low = hour < 8 || hour >= 22;
    histories.test.push({
      stationId: 'test',
      capturedAt: `2026-06-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00:00.000Z`,
      localDate: `2026-06-${String(day).padStart(2, '0')}`,
      localHour: hour,
      localMinute: 0,
      halfHourSlot: hour * 2,
      memberPricePerKwh: low ? 0.28 : 0.42,
      nonMemberPricePerKwh: low ? 0.46 : 0.61,
      congestionFeePerMinuteMax: hour >= 16 && hour < 20 ? 0.5 : 0,
      utilizationPct: hour >= 16 && hour < 20 ? 0.85 : 0.25,
      totalStalls: 12,
      priceCandidateCount: 8,
      source: 'tesla_public_findus_location_page'
    });
  }
}

const vector = featureVector({ station, observation: histories.test[0], membershipType: 'member' });
assert.equal(vector.length, FEATURE_NAMES.length);
assert(vector.every(value => value >= 0 && value <= 1));

const examples = buildTrainingExamples([station], histories);
assert.equal(examples.length, 384);
const model = trainPricingNetwork(examples, { iterations: 1400 });
assert(['experimental', 'active'].includes(model.status), `unexpected status: ${model.status} (${model.reason})`);
assert.equal(model.activation.captureValidation, true);
assert(model.metrics.mae < 0.12);

const normal = histories.test.at(-1);
const normalCheck = validateCapturedPrices(model, { station, observation: normal });
assert.equal(normalCheck.status, 'consistent');
const anomalyCheck = validateCapturedPrices(model, { station, observation: { ...normal, memberPricePerKwh: 1.35 } });
assert.equal(anomalyCheck.status, 'review');

const sparse = trainPricingNetwork(examples.slice(0, 10));
assert.equal(sparse.status, 'collecting_data');
assert.equal(sparse.activation.captureValidation, false);

console.log(`Neural pricing tests passed. Holdout MAE: $${model.metrics.mae}/kWh.`);
