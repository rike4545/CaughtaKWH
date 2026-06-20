import fs from 'node:fs/promises';
import path from 'node:path';
import { dataDir, historyDir, readJson, writeJson } from './lib.mjs';
import { buildTrainingExamples, trainPricingNetwork, validateCapturedPrices } from './pricingNeuralNetwork.mjs';

const stations = await readJson(path.join(dataDir, 'stations.json'), []);
const histories = {};
for (const file of (await fs.readdir(historyDir)).filter(file => file.endsWith('.json'))) {
  histories[file.replace(/\.json$/, '')] = await readJson(path.join(historyDir, file), []);
}

const examples = buildTrainingExamples(stations, histories);
const model = trainPricingNetwork(examples);
const stationById = new Map(stations.map(station => [station.id, station]));
const historicalReviews = [];
let historicalChecks = 0;
for (const [stationId, observations] of Object.entries(histories)) {
  const station = stationById.get(stationId) || { id: stationId };
  for (const observation of observations) {
    if (!String(observation.source || '').startsWith('tesla_')) continue;
    const validation = validateCapturedPrices(model, { station, observation });
    if (validation.status === 'unavailable') continue;
    historicalChecks++;
    if (validation.status === 'review') historicalReviews.push({ stationId, capturedAt: observation.capturedAt, source: observation.source, ...validation });
  }
}
model.historicalReview = { checked: historicalChecks, flagged: historicalReviews.length };
await writeJson(path.join(dataDir, 'pricing-neural-model.json'), model);
await writeJson(path.join(dataDir, 'pricing-neural-review.json'), {
  generatedAt: model.generatedAt,
  modelVersion: model.version,
  status: model.status,
  checked: historicalChecks,
  flagged: historicalReviews.length,
  reviews: historicalReviews.slice(0, 100)
});

const lines = [
  '# Pricing Neural Model',
  '',
  `Generated: ${model.generatedAt}`,
  '',
  `- Status: **${model.status}**`,
  `- Reason: ${model.reason}`,
  `- Examples: ${model.coverage.exampleCount}`,
  `- Stations: ${model.coverage.stationCount}`,
  `- Distinct prices: ${model.coverage.distinctPrices}`,
  `- Half-hour slots: ${model.coverage.distinctSlots}`,
  `- Utilization coverage: ${model.coverage.utilizationCoveragePct}%`,
  `- Holdout MAE: ${model.metrics ? `$${model.metrics.mae.toFixed(4)}/kWh` : 'not trained'}`,
  `- Baseline MAE: ${model.metrics ? `$${model.metrics.baselineMae.toFixed(4)}/kWh` : 'not trained'}`,
  `- Capture validation: ${model.activation.captureValidation ? 'enabled' : 'disabled'}`,
  `- Price blending: ${model.activation.priceBlending ? 'enabled' : 'disabled'}`,
  `- Historical official captures checked: ${historicalChecks}`,
  `- Captures flagged for review: ${historicalReviews.length}`,
  '',
  'The network never creates an official observation. It scores captured prices and supplies an experimental estimate only after holdout checks pass.',
  ''
];
await fs.mkdir(path.join(process.cwd(), 'reports'), { recursive: true });
await fs.writeFile(path.join(process.cwd(), 'reports', 'pricing-neural-model.md'), lines.join('\n'));
console.log(`Pricing neural model: ${model.status}; ${examples.length} examples; capture validation ${model.activation.captureValidation ? 'on' : 'off'}; blending ${model.activation.priceBlending ? 'on' : 'off'}.`);
