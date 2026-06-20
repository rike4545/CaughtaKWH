import { SLOT_PRIOR_WEIGHT, chooseCheapestSlot, shrinkToward } from './predictionMath.mjs';

function assert(cond, msg) { if (!cond) throw new Error(msg); }
const close = (a, b) => Math.abs(a - b) < 1e-9;

// shrinkToward: a 1-sample slot is pulled most of the way to the prior; a well-sampled slot barely moves.
// 1 sample at 0.20, prior 0.40, weight 4 -> (1*0.20 + 4*0.40)/(5) = 0.36
assert(close(shrinkToward(0.20, 1, 0.40), 0.36), `1-sample shrink expected 0.36 got ${shrinkToward(0.20, 1, 0.40)}`);
// 40 samples at 0.20, prior 0.40 -> (40*0.20 + 4*0.40)/44 = 0.41818...
assert(close(shrinkToward(0.20, 40, 0.40), (40 * 0.20 + 4 * 0.40) / 44), 'well-sampled shrink wrong');
// missing slot mean falls back to prior
assert(shrinkToward(NaN, 3, 0.4) === 0.4, 'NaN slot mean should fall back to prior');
assert(SLOT_PRIOR_WEIGHT === 4, 'prior weight constant changed unexpectedly');

// chooseCheapestSlot: a thinly-sampled cheap slot should LOSE to a steady, well-sampled slot
// once shrinkage is applied — that is the whole point of the change.
const flukey = { slot: 4, expectedPrice: 0.18, smoothedExpectedPrice: 0.35, sampleCount: 1 };
const steady = { slot: 44, expectedPrice: 0.30, smoothedExpectedPrice: 0.31, sampleCount: 20 };
const picked = chooseCheapestSlot([flukey, steady]);
assert(picked.slot === 44, `expected steady well-sampled slot to win, got slot ${picked.slot}`);

// With equal shrunk prices, prefer the better-sampled slot.
const tieA = { slot: 1, expectedPrice: 0.30, smoothedExpectedPrice: 0.30, sampleCount: 3 };
const tieB = { slot: 2, expectedPrice: 0.30, smoothedExpectedPrice: 0.30, sampleCount: 9 };
assert(chooseCheapestSlot([tieA, tieB]).slot === 2, 'tie should prefer more samples');

// Falls back to raw expectedPrice when smoothed missing; ignores priceless slots; empty -> null.
assert(chooseCheapestSlot([{ slot: 5, expectedPrice: 0.25, sampleCount: 2 }, { slot: 6, expectedPrice: 0.40, sampleCount: 2 }]).slot === 5, 'raw fallback ranking failed');
assert(chooseCheapestSlot([{ slot: 7, sampleCount: 2 }]) === null, 'priceless-only should be null');
assert(chooseCheapestSlot([]) === null, 'empty should be null');

console.log('Prediction math tests passed.');
