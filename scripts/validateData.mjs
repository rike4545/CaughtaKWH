import path from 'node:path';
import { dataDir, readJson } from './lib.mjs';

const stations = await readJson(path.join(dataDir, 'stations.json'), []);
const predictions = await readJson(path.join(dataDir, 'predictions.json'), []);
const neuralModel = await readJson(path.join(dataDir, 'pricing-neural-model.json'), null);
const neuralReview = await readJson(path.join(dataDir, 'pricing-neural-review.json'), null);
const lakeGrovePilot = await readJson(path.join(dataDir, 'pilot-lake-grove.json'), null);
const scrapeHealth = await readJson(path.join(dataDir, 'scrape-health.json'), null);

if (!Array.isArray(stations)) throw new Error('stations.json must be an array');
if (!Array.isArray(predictions)) throw new Error('predictions.json must be an array');
if (neuralModel) {
  if (!neuralModel.version || !neuralModel.status || !neuralModel.coverage || !neuralModel.activation) throw new Error('pricing-neural-model.json is missing required model metadata');
  if (neuralModel.activation.priceBlending && neuralModel.status !== 'active') throw new Error('Neural price blending requires an active model');
  if (neuralReview && neuralReview.modelVersion !== neuralModel.version) throw new Error('Neural review queue does not match the pricing model version');
}
if (lakeGrovePilot) {
  const ids = lakeGrovePilot.stationIds || [];
  if (ids.length !== 10 || new Set(ids).size !== 10) throw new Error('Lake Grove pilot must contain 10 unique station IDs');
  if (!ids.includes('LakeGroveNYsupercharger')) throw new Error('Lake Grove pilot must include its origin station');
  if (lakeGrovePilot.stationCount !== ids.length) throw new Error('Lake Grove pilot station count does not match its IDs');
}
if (scrapeHealth) {
  if (!scrapeHealth.generatedAt || !scrapeHealth.circuitBreaker || !scrapeHealth.cooldownPolicy) throw new Error('scrape-health.json is missing block-response metadata');
  if (scrapeHealth.attempted < scrapeHealth.blocked + scrapeHealth.failed) throw new Error('Scrape health outcome counts are inconsistent');
}

for (const s of stations) {
  if (!s.id || !s.name) throw new Error(`Invalid station: ${JSON.stringify(s)}`);
}

const withTeslaUrl = stations.filter(s => typeof s.url === 'string' && s.url.includes('tesla.com/findus/location/supercharger')).length;
const withCoords = stations.filter(s => typeof s.lat === 'number' && typeof s.lng === 'number').length;
console.log(`Validated ${stations.length} stations and ${predictions.length} predictions.`);
console.log(`${withTeslaUrl} stations have Tesla location URLs; ${withCoords} have coordinates.`);
if (neuralModel) console.log(`Neural pricing model: ${neuralModel.status}; ${neuralModel.coverage.exampleCount} examples; holdout MAE ${neuralModel.metrics?.mae ?? 'n/a'}.`);
