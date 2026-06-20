import synapticPackage from 'synaptic';

const { Architect, Network, Trainer } = synapticPackage;
const networkCache = new WeakMap();

export const MODEL_VERSION = 'caughtakwh-pricing-nn-v1';
export const MAX_PRICE = 1.5;
export const FEATURE_NAMES = [
  'timeSin',
  'timeCos',
  'weekdaySin',
  'weekdayCos',
  'isNonMember',
  'utilizationPct',
  'utilizationKnown',
  'stallCount',
  'maxPowerKw',
  'congestionFee',
  'latitude',
  'longitude',
  'officialTeslaSource',
  'candidateDensity'
];

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

function cycle(value, period) {
  const angle = 2 * Math.PI * value / period;
  return [(Math.sin(angle) + 1) / 2, (Math.cos(angle) + 1) / 2];
}

function localWeekday(observation) {
  const datePart = String(observation?.localDate || '').match(/^\d{4}-\d{2}-\d{2}$/)?.[0];
  const date = datePart ? new Date(`${datePart}T12:00:00Z`) : new Date(observation?.capturedAt || 0);
  return Number.isNaN(date.getTime()) ? 0 : date.getUTCDay();
}

function observationSlot(observation) {
  if (Number.isInteger(observation?.halfHourSlot)) return clamp(observation.halfHourSlot, 0, 47);
  const hour = clamp(observation?.localHour, 0, 23);
  return hour * 2 + (Number(observation?.localMinute || 0) >= 30 ? 1 : 0);
}

export function featureVector({ station = {}, observation = {}, membershipType = 'member', slotOverride = null } = {}) {
  const slot = Number.isInteger(slotOverride) ? slotOverride : observationSlot(observation);
  const [timeSin, timeCos] = cycle(slot, 48);
  const [weekdaySin, weekdayCos] = cycle(localWeekday(observation), 7);
  const utilizationKnown = typeof observation.utilizationPct === 'number';
  const utilization = utilizationKnown ? clamp(observation.utilizationPct) : 0.5;
  const stalls = observation.totalStalls ?? station.stalls;
  const officialSource = String(observation.source || '').startsWith('tesla_');
  return [
    timeSin,
    timeCos,
    weekdaySin,
    weekdayCos,
    membershipType === 'non_member' ? 1 : 0,
    utilization,
    utilizationKnown ? 1 : 0,
    clamp(Number(stalls || 0) / 64),
    clamp(Number(station.maxKw || 0) / 400),
    clamp(Number(observation.congestionFeePerMinuteMax || 0) / 2),
    clamp((Number(station.lat || 0) + 90) / 180),
    clamp((Number(station.lng || 0) + 180) / 360),
    officialSource ? 1 : 0,
    clamp(Number(observation.priceCandidateCount || 0) / 24)
  ];
}

export function buildTrainingExamples(stations, histories) {
  const stationById = new Map((stations || []).map(station => [station.id, station]));
  const examples = [];
  for (const [stationId, observations] of Object.entries(histories || {})) {
    const station = stationById.get(stationId) || { id: stationId };
    for (const observation of observations || []) {
      for (const [membershipType, field] of [['member', 'memberPricePerKwh'], ['non_member', 'nonMemberPricePerKwh']]) {
        const price = observation?.[field];
        if (typeof price !== 'number' || price < 0.06 || price > MAX_PRICE) continue;
        examples.push({
          stationId,
          capturedAt: observation.capturedAt || '',
          membershipType,
          input: featureVector({ station, observation, membershipType }),
          output: [price / MAX_PRICE],
          price,
          slot: observationSlot(observation),
          utilizationKnown: typeof observation.utilizationPct === 'number'
        });
      }
    }
  }
  return examples.sort((a, b) => String(a.capturedAt).localeCompare(String(b.capturedAt)) || a.membershipType.localeCompare(b.membershipType));
}

function seededRandom(seed = 4545) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function splitExamples(examples) {
  const timestamps = [...new Set(examples.map(example => example.capturedAt))];
  const splitAt = Math.max(1, Math.min(timestamps.length - 1, Math.floor(timestamps.length * 0.8)));
  const trainTimes = new Set(timestamps.slice(0, splitAt));
  return {
    train: examples.filter(example => trainTimes.has(example.capturedAt)),
    validation: examples.filter(example => !trainTimes.has(example.capturedAt))
  };
}

function baselinePrice(train, membershipType) {
  const matching = train.filter(example => example.membershipType === membershipType).map(example => example.price);
  return mean(matching.length ? matching : train.map(example => example.price));
}

function evaluate(network, train, validation) {
  const errors = validation.map(example => {
    const predicted = clamp(network.activate(example.input)[0]) * MAX_PRICE;
    return Math.abs(predicted - example.price);
  });
  const baselineErrors = validation.map(example => Math.abs((baselinePrice(train, example.membershipType) ?? example.price) - example.price));
  return {
    mae: Number((mean(errors) ?? 0).toFixed(4)),
    baselineMae: Number((mean(baselineErrors) ?? 0).toFixed(4)),
    maxError: Number((errors.length ? Math.max(...errors) : 0).toFixed(4))
  };
}

export function trainPricingNetwork(examples, options = {}) {
  const minExamples = Number(options.minExamples || 40);
  const distinctPrices = new Set(examples.map(example => example.price.toFixed(3))).size;
  const distinctSlots = new Set(examples.map(example => example.slot)).size;
  const stationCount = new Set(examples.map(example => example.stationId)).size;
  const utilizationExamples = examples.filter(example => example.utilizationKnown).length;
  const coverage = {
    exampleCount: examples.length,
    stationCount,
    distinctPrices,
    distinctSlots,
    utilizationExamples,
    utilizationCoveragePct: examples.length ? Number((utilizationExamples / examples.length * 100).toFixed(1)) : 0
  };
  if (examples.length < minExamples || distinctPrices < 2 || distinctSlots < 6) {
    return {
      version: MODEL_VERSION,
      generatedAt: new Date().toISOString(),
      status: 'collecting_data',
      reason: `Need at least ${minExamples} examples, 2 prices, and 6 time slots before training.`,
      library: 'synaptic@1.1.4',
      featureNames: FEATURE_NAMES,
      coverage,
      activation: { captureValidation: false, priceBlending: false },
      network: null
    };
  }

  const { train, validation } = splitExamples(examples);
  if (train.length < 24 || validation.length < 8) {
    return {
      version: MODEL_VERSION,
      generatedAt: new Date().toISOString(),
      status: 'collecting_data',
      reason: 'Need at least 24 training examples and 8 chronological holdout examples.',
      library: 'synaptic@1.1.4',
      featureNames: FEATURE_NAMES,
      coverage,
      activation: { captureValidation: false, priceBlending: false },
      network: null
    };
  }

  const originalRandom = Math.random;
  Math.random = seededRandom(Number(options.seed || 4545));
  let network;
  let trainingResult;
  try {
    network = new Architect.Perceptron(FEATURE_NAMES.length, 10, 6, 1);
    const trainer = new Trainer(network);
    trainingResult = trainer.train(train.map(example => ({ input: example.input, output: example.output })), {
      rate: Number(options.learningRate || 0.025),
      iterations: Number(options.iterations || 6000),
      error: Number(options.error || 0.0004),
      shuffle: false,
      log: false,
      cost: Trainer.cost.MSE
    });
  } finally {
    Math.random = originalRandom;
  }

  const metrics = evaluate(network, train, validation);
  const qualityPassed = metrics.mae <= 0.12 && (metrics.baselineMae === 0 ? metrics.mae <= 0.03 : metrics.mae <= metrics.baselineMae * 1.2);
  // Coverage gate for promoting the model to price-blending. Utilization is one of 14 features
  // and is rarely public on Tesla's pages, so it is reported as a bonus signal rather than a
  // hard requirement — gating on it would deadlock the model at 'experimental' forever even
  // with strong multi-station price history. Station and example breadth remain hard gates.
  const productionCoverage = stationCount >= 5 && examples.length >= 200;
  return {
    version: MODEL_VERSION,
    generatedAt: new Date().toISOString(),
    status: qualityPassed ? (productionCoverage ? 'active' : 'experimental') : 'rejected',
    reason: qualityPassed
      ? productionCoverage ? 'Holdout quality and coverage thresholds passed.' : 'Holdout quality passed; more stations and price history are needed before blending.'
      : 'Holdout error did not beat the guarded quality threshold.',
    library: 'synaptic@1.1.4',
    architecture: [FEATURE_NAMES.length, 10, 6, 1],
    featureNames: FEATURE_NAMES,
    coverage,
    training: {
      examples: train.length,
      validationExamples: validation.length,
      iterations: trainingResult.iterations,
      finalTrainingError: Number(trainingResult.error.toFixed(6)),
      seed: Number(options.seed || 4545)
    },
    metrics,
    activation: {
      captureValidation: qualityPassed,
      priceBlending: qualityPassed && productionCoverage
    },
    network: network.toJSON()
  };
}

export function predictNeuralPrice(model, context) {
  if (!model?.network || !['experimental', 'active'].includes(model.status)) return null;
  let network = networkCache.get(model);
  if (!network) {
    network = Network.fromJSON(model.network);
    networkCache.set(model, network);
  }
  const value = clamp(network.activate(featureVector(context))[0]) * MAX_PRICE;
  return Number(value.toFixed(4));
}

export function validateCapturedPrices(model, { station, observation }) {
  if (!model?.activation?.captureValidation) return { status: 'unavailable', modelVersion: model?.version || null };
  const threshold = Math.max(0.08, Number(model.metrics?.mae || 0) * 3);
  const checks = [];
  for (const [membershipType, field] of [['member', 'memberPricePerKwh'], ['non_member', 'nonMemberPricePerKwh']]) {
    const observed = observation?.[field];
    if (typeof observed !== 'number') continue;
    const expected = predictNeuralPrice(model, { station, observation, membershipType });
    if (typeof expected !== 'number') continue;
    const residual = Math.abs(observed - expected);
    checks.push({
      membershipType,
      observed: Number(observed.toFixed(4)),
      expected,
      residual: Number(residual.toFixed(4)),
      threshold: Number(threshold.toFixed(4)),
      needsReview: residual > threshold
    });
  }
  return {
    status: checks.some(check => check.needsReview) ? 'review' : checks.length ? 'consistent' : 'unavailable',
    modelVersion: model.version,
    checks
  };
}
