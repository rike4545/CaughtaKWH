import assert from 'node:assert/strict';
import { clampPct, energyAddedKwh, estimateChargeCost } from '../src/chargeCost.js';
import { milesBetween, nearestStations } from '../src/zipSearch.js';
import { isCurrentPrediction, pricingStats } from '../src/kpis.js';

assert.equal(clampPct(-5), 0);
assert.equal(clampPct(105), 100);
assert.equal(energyAddedKwh({ usableKwh: 75, arrivalPct: 20, targetPct: 80 }), 45);
assert.deepEqual(
  estimateChargeCost({ usableKwh: 75, arrivalPct: 20, targetPct: 80, pricePerKwh: 0.30 }),
  { kwh: 45, pricePerKwh: 0.30, cost: 13.50 }
);
assert.equal(estimateChargeCost({ usableKwh: 75, arrivalPct: 80, targetPct: 20, pricePerKwh: 0.30 })?.cost, 0);

const miles = milesBetween(40.7128, -74.0060, 40.7580, -73.9855);
assert.ok(miles > 3 && miles < 5);

const nearest = nearestStations([
  { id: 'far', lat: 41, lng: -74 },
  { id: 'near', lat: 40.72, lng: -74.00 }
], { lat: 40.7128, lng: -74.0060 }, 1);
assert.equal(nearest[0].id, 'near');

assert.equal(isCurrentPrediction({ latestObservationAgeHours: 1.99 }), true);
assert.equal(isCurrentPrediction({ latestObservationAgeHours: 2.01 }), false);
assert.deepEqual(pricingStats([]), { count: 0, low: null, median: null, high: null, avg: null });

console.log('Core regression tests passed.');
