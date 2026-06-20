import path from 'node:path';
import { dataDir, readJson, writeJson } from './lib.mjs';

const originId = String(process.env.PILOT_ORIGIN_ID || 'LakeGroveNYsupercharger');
const clusterSize = Math.max(1, Number(process.env.PILOT_CLUSTER_SIZE || 10));
const stations = await readJson(path.join(dataDir, 'stations.json'), []);
const origin = stations.find(station => station.id === originId);
if (!origin || !Number.isFinite(origin.lat) || !Number.isFinite(origin.lng)) {
  throw new Error(`Pilot origin ${originId} is missing coordinates.`);
}

function radians(value) {
  return value * Math.PI / 180;
}

function milesBetween(a, b) {
  const radius = 3958.7613;
  const dLat = radians(b.lat - a.lat);
  const dLng = radians(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(dLng / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

const cluster = stations
  .filter(station => Number.isFinite(station.lat) && Number.isFinite(station.lng))
  .map(station => ({ station, distanceMiles: milesBetween(origin, station) }))
  .sort((a, b) => a.distanceMiles - b.distanceMiles || String(a.station.id).localeCompare(String(b.station.id)))
  .slice(0, clusterSize)
  .map(({ station, distanceMiles }) => ({
    id: station.id,
    name: station.name,
    city: station.city || null,
    state: station.state || null,
    distanceMiles: Number(distanceMiles.toFixed(2)),
    lat: station.lat,
    lng: station.lng,
    teslaUrl: station.url || null
  }));

const output = {
  generatedAt: new Date().toISOString(),
  origin: { id: origin.id, name: origin.name, lat: origin.lat, lng: origin.lng },
  stationCount: cluster.length,
  radiusMiles: cluster.length ? cluster.at(-1).distanceMiles : 0,
  stationIds: cluster.map(station => station.id),
  stations: cluster
};

await writeJson(path.join(dataDir, 'pilot-lake-grove.json'), output);
console.log(output.stationIds.join(','));
