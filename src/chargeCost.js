// Charge-cost estimation helpers.
// Pure functions so they can be unit-tested without a browser (see scripts/testChargeCost.mjs).

// Approximate USABLE battery capacity (kWh) for common Tesla models — usable energy is what
// actually determines the cost of charging from one state of charge to another (gross pack
// size includes a buffer that never gets billed). Figures are rounded estimates and editable
// in the UI via the manual override, so they only need to be in the right ballpark.
export const TESLA_BATTERY_PRESETS = [
  { id: 'm3-rwd', label: 'Model 3 RWD (LFP)', usableKwh: 57.5 },
  { id: 'm3-lr', label: 'Model 3 Long Range / Performance', usableKwh: 75 },
  { id: 'my-rwd', label: 'Model Y RWD (LFP)', usableKwh: 60 },
  { id: 'my-lr', label: 'Model Y Long Range / Performance', usableKwh: 75 },
  { id: 'ms', label: 'Model S', usableKwh: 95 },
  { id: 'mx', label: 'Model X', usableKwh: 94 },
  { id: 'ct', label: 'Cybertruck', usableKwh: 123 },
  { id: 'other', label: 'Other / enter kWh manually', usableKwh: null },
];

export function clampPct(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.min(100, Math.max(0, n));
}

// Energy added when charging from arrivalPct to targetPct on a battery of usableKwh.
// Returns null when inputs are incomplete/invalid, 0 when target is at or below arrival.
export function energyAddedKwh({ usableKwh, arrivalPct, targetPct }) {
  const cap = Number(usableKwh);
  const from = clampPct(arrivalPct);
  const to = clampPct(targetPct);
  if (!Number.isFinite(cap) || cap <= 0 || from == null || to == null) return null;
  const delta = Math.max(0, to - from);
  return Number(((delta / 100) * cap).toFixed(2));
}

// Estimated session cost. pricePerKwh is in $/kWh. Returns { kwh, pricePerKwh, cost } or null.
export function estimateChargeCost({ usableKwh, arrivalPct, targetPct, pricePerKwh }) {
  const kwh = energyAddedKwh({ usableKwh, arrivalPct, targetPct });
  const price = Number(pricePerKwh);
  if (kwh == null || !Number.isFinite(price) || price <= 0) return null;
  return { kwh, pricePerKwh: price, cost: Number((kwh * price).toFixed(2)) };
}
