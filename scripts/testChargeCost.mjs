import { TESLA_BATTERY_PRESETS, clampPct, energyAddedKwh, estimateChargeCost } from '../src/chargeCost.js';

function assert(cond, msg) { if (!cond) throw new Error(msg); }

// clampPct
assert(clampPct(46) === 46, 'clampPct passthrough failed');
assert(clampPct(-5) === 0, 'clampPct lower bound failed');
assert(clampPct(150) === 100, 'clampPct upper bound failed');
assert(clampPct('x') === null, 'clampPct non-numeric should be null');

// energyAddedKwh: 46% -> 80% on a 75 kWh pack = 0.34 * 75 = 25.5 kWh
assert(energyAddedKwh({ usableKwh: 75, arrivalPct: 46, targetPct: 80 }) === 25.5, 'energy 46->80 on 75kWh failed');
// target at/below arrival = 0
assert(energyAddedKwh({ usableKwh: 75, arrivalPct: 80, targetPct: 80 }) === 0, 'energy at target should be 0');
assert(energyAddedKwh({ usableKwh: 75, arrivalPct: 90, targetPct: 80 }) === 0, 'energy past target should be 0');
// invalid capacity
assert(energyAddedKwh({ usableKwh: 0, arrivalPct: 46, targetPct: 80 }) === null, 'zero capacity should be null');

// estimateChargeCost: 25.5 kWh at $0.30/kWh = $7.65
const c = estimateChargeCost({ usableKwh: 75, arrivalPct: 46, targetPct: 80, pricePerKwh: 0.30 });
assert(c && c.cost === 7.65, `cost 46->80 @ $0.30 expected 7.65 got ${c && c.cost}`);
assert(c.kwh === 25.5, 'cost result kwh wrong');

// Different arrival SoCs the user named (50%, 60%) to 80% on 75 kWh @ $0.43
assert(estimateChargeCost({ usableKwh: 75, arrivalPct: 50, targetPct: 80, pricePerKwh: 0.43 }).cost === 9.68, '50->80 @ .43 failed');
assert(estimateChargeCost({ usableKwh: 75, arrivalPct: 60, targetPct: 80, pricePerKwh: 0.43 }).cost === 6.45, '60->80 @ .43 failed');

// incomplete price -> null
assert(estimateChargeCost({ usableKwh: 75, arrivalPct: 46, targetPct: 80, pricePerKwh: null }) === null, 'missing price should be null');

// presets sane
assert(TESLA_BATTERY_PRESETS.length >= 5, 'expected several presets');
assert(TESLA_BATTERY_PRESETS.every(p => p.id && p.label), 'presets need id+label');
assert(TESLA_BATTERY_PRESETS.find(p => p.id === 'other')?.usableKwh === null, 'other preset should have null kWh');

console.log('Charge cost calculator tests passed.');
