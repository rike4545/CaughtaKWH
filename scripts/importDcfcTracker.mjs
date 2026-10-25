import { readJson, writeJson, nowIso } from './lib.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';

const API = 'https://dcfctracker.com/api/v1';
const apiKey = String(process.env.DCFC_API_KEY || '').trim();
const states = String(process.env.DCFC_STATES || 'NY,NJ,CT')
  .split(',').map(value => value.trim().toUpperCase()).filter(Boolean);

if (!apiKey) {
  console.error('DCFC_API_KEY is required. Configure it as a GitHub Actions secret; never expose it in browser code.');
  process.exit(1);
}
if (!states.length || states.some(state => !/^[A-Z]{2}$/.test(state))) {
  throw new Error('DCFC_STATES must be a comma-separated list of two-letter state codes.');
}

async function requestPage(page) {
  const query = new URLSearchParams({
    networks: 'Tesla',
    states: states.join(','),
    page: String(page),
    limit: '1000'
  });
  const response = await fetch(`${API}/stations?${query}`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(30000)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = body?.error?.message || response.statusText || 'Unknown API error';
    throw new Error(`DCFC Tracker API returned HTTP ${response.status}: ${message}`);
  }
  if (!Array.isArray(body.data) || !body.pagination) {
    throw new Error('DCFC Tracker API response did not match the expected station-list schema.');
  }
  return body;
}

const appStations = await readJson('data/stations.json', []);
if (!Array.isArray(appStations) || appStations.length === 0) {
  throw new Error('data/stations.json is empty or invalid; refusing to import a broad third-party station catalog.');
}
const normalizeName = value => String(value || '').toLowerCase().replace(/\bsupercharger\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const milesBetween = (aLat, aLng, bLat, bLng) => {
  const rad = value => value * Math.PI / 180;
  const dLat = rad(bLat - aLat), dLng = rad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 3958.7613 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
};
const collected = [];
let page = 1;
let expectedTotal = null;
while (true) {
  const body = await requestPage(page);
  if (expectedTotal === null) expectedTotal = Number(body.pagination.total);
  collected.push(...body.data);
  if (!body.pagination.hasMore) break;
  page += 1;
  if (page > 1000) throw new Error('DCFC Tracker pagination safety limit exceeded.');
}

const stations = collected
  .filter(station => station.network === 'Tesla' && states.includes(String(station.state || '').toUpperCase()))
  .map(station => {
    const stationName = normalizeName(station.name);
    const matched = appStations.find(appStation => {
      if (String(appStation.state || '').toUpperCase() !== String(station.state || '').toUpperCase()) return false;
      const appName = normalizeName(appStation.name);
      if (stationName && appName && stationName === appName) return true;
      if ([appStation.lat, appStation.lng, station.lat, station.lng].every(Number.isFinite)) {
        return milesBetween(appStation.lat, appStation.lng, station.lat, station.lng) <= 0.5;
      }
      return false;
    });
    if (!matched) return null;
    return {
    id: String(matched.id),
    sourceStationId: String(station.id),
    name: station.name ?? null,
    network: station.network ?? 'Tesla',
    address: [station.street, station.city, station.state, station.zip].filter(Boolean).join(', '),
    state: station.state ?? null,
    lat: typeof station.lat === 'number' ? station.lat : null,
    lng: typeof station.lng === 'number' ? station.lng : null,
    connectorTypes: Array.isArray(station.connectorTypes) ? station.connectorTypes : [],
    stalls: station.dcFastCount ?? null,
    maxPowerKw: station.maxPowerKw ?? null,
    status: station.status ?? null,
    access: station.access ?? null,
    publicPricePerKwh: typeof station.pricePerKwh === 'number' ? station.pricePerKwh : null,
    memberPricePerKwh: typeof station.memberPricePerKwh === 'number' ? station.memberPricePerKwh : null,
    priceNote: station.priceNote ?? null,
    priceSource: station.priceSource ?? null,
    priceSourceType: station.priceSourceType ?? null,
    priceRate: station.priceRate ?? null,
    priceUpdatedAt: station.priceUpdatedAt ?? null,
    sourceUrl: station.url ?? null
  };
  })
  .filter(Boolean)
  .sort((a, b) => a.state.localeCompare(b.state) || String(a.name || '').localeCompare(String(b.name || '')));

if (!stations.length) throw new Error('No DCFC Tracker stations matched existing CaughtaKWH stations in the configured states; refusing to overwrite the previous snapshot.');
const priced = stations.filter(station => station.publicPricePerKwh !== null || station.memberPricePerKwh !== null).length;
const snapshot = {
  schemaVersion: 1,
  source: 'DCFC Tracker API',
  sourceUrl: 'https://dcfctracker.com/developers',
  attribution: 'Price and station details from DCFC Tracker (dcfctracker.com); only matched CaughtaKWH stations are included.',
  generatedAt: nowIso(),
  apiGeneratedAt: null,
  states,
  network: 'Tesla',
  stationCount: stations.length,
  stationsWithPrices: priced,
  stations
};

// Never replace a valid existing snapshot with an unexpectedly empty/metadata-only response.
if (priced === 0) {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const existingPath = path.join(process.cwd(), 'data', 'dcfc-tracker.json');
  try {
    const existing = JSON.parse(await fs.readFile(existingPath, 'utf8'));
    const existingPriced = (existing.stations || []).filter(s => s.publicPricePerKwh !== null || s.memberPricePerKwh !== null).length;
    if (existingPriced > 0) throw new Error('DCFC Tracker returned zero priced stations; preserved the existing snapshot instead.');
  } catch (error) {
    if (error.message.includes('preserved the existing snapshot')) throw error;
    // No previous snapshot exists; publish the valid station metadata with an explicit zero price count.
  }
}

// Keep independent recovery copies. The previous snapshot is the immediate rollback point;
// the UTC-hour archive preserves a lightweight historical trail without creating a file every 15 minutes.
const currentPath = path.join(process.cwd(), 'data', 'dcfc-tracker.json');
const previousSnapshot = await readJson('data/dcfc-tracker.json', null);
if (previousSnapshot && Array.isArray(previousSnapshot.stations) && previousSnapshot.stations.length > 0) {
  await writeJson('data/backups/dcfc-tracker-previous.json', previousSnapshot);
}
const hourBucket = new Date().toISOString().slice(0, 13).replace('T', '-');
const hourlyArchivePath = path.join('data', 'history', 'dcfc-tracker', `${hourBucket}.json`);
try {
  await fs.access(hourlyArchivePath);
} catch {
  await writeJson(hourlyArchivePath, snapshot);
}
await writeJson('data/dcfc-tracker.json', snapshot);
console.log(JSON.stringify({
  generatedAt: snapshot.generatedAt,
  states,
  stationCount: stations.length,
  stationsWithPrices: priced,
  source: snapshot.source
}, null, 2));
