// Pure projection-math helpers, extracted so they can be unit-tested without the file-IO
// side effects in buildPredictions.mjs. See scripts/testPredictionMath.mjs.

// Pseudo-observations of the station's overall mean mixed into every half-hour slot.
// Higher = more conservative (a slot needs more of its own samples to move off the station
// average), which stops a single cheap reading in one slot from winning "cheapest window".
export const SLOT_PRIOR_WEIGHT = 4;

// Empirical-Bayes shrinkage: blend a slot's own mean with the station prior by sample count.
// With n samples, weight n on the slot mean and priorWeight on the prior mean.
export function shrinkToward(slotMean, sampleCount, priorMean, priorWeight = SLOT_PRIOR_WEIGHT) {
  const n = Math.max(0, Number(sampleCount) || 0);
  const mean = Number(slotMean);
  const prior = Number(priorMean);
  if (!Number.isFinite(mean)) return Number.isFinite(prior) ? prior : null;
  if (!Number.isFinite(prior)) return mean;
  return (n * mean + priorWeight * prior) / (n + priorWeight);
}

// Pick the cheapest, most-trustworthy slot. Ranks by the shrunk expected price (so flukes in
// thinly-sampled slots are pulled back toward the station average), breaking ties toward the
// better-sampled slot and then the lower raw price. Returns the chosen slot object or null.
export function chooseCheapestSlot(slots = []) {
  const usable = (Array.isArray(slots) ? slots : []).filter(slot => typeof slot?.expectedPrice === 'number');
  if (!usable.length) return null;
  return [...usable].sort((a, b) => {
    const sa = typeof a.smoothedExpectedPrice === 'number' ? a.smoothedExpectedPrice : a.expectedPrice;
    const sb = typeof b.smoothedExpectedPrice === 'number' ? b.smoothedExpectedPrice : b.expectedPrice;
    if (sa !== sb) return sa - sb;
    if ((b.sampleCount || 0) !== (a.sampleCount || 0)) return (b.sampleCount || 0) - (a.sampleCount || 0);
    return a.expectedPrice - b.expectedPrice;
  })[0];
}
