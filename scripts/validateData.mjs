import path from 'node:path';
import { dataDir, readJson } from './lib.mjs';
const stations = await readJson(path.join(dataDir, 'stations.json'), []);
const predictions = await readJson(path.join(dataDir, 'predictions.json'), []);
if (!Array.isArray(stations)) throw new Error('stations.json must be an array');
if (!Array.isArray(predictions)) throw new Error('predictions.json must be an array');
for (const s of stations) {
  if (!s.id || !s.name || !s.url) throw new Error(`Invalid station: ${JSON.stringify(s)}`);
}
console.log(`Validated ${stations.length} stations and ${predictions.length} predictions.`);
