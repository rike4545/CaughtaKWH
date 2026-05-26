import path from 'node:path';
import { dataDir, readJson } from './lib.mjs';

const stations = await readJson(path.join(dataDir, 'stations.json'), []);
const predictions = await readJson(path.join(dataDir, 'predictions.json'), []);

if (!Array.isArray(stations)) throw new Error('stations.json must be an array');
if (!Array.isArray(predictions)) throw new Error('predictions.json must be an array');

for (const s of stations) {
  if (!s.id || !s.name) throw new Error(`Invalid station: ${JSON.stringify(s)}`);
}

const withTeslaUrl = stations.filter(s => typeof s.url === 'string' && s.url.includes('tesla.com/findus/location/supercharger')).length;
const withCoords = stations.filter(s => typeof s.lat === 'number' && typeof s.lng === 'number').length;
console.log(`Validated ${stations.length} stations and ${predictions.length} predictions.`);
console.log(`${withTeslaUrl} stations have Tesla location URLs; ${withCoords} have coordinates.`);
