import { readJson, writeJson, nowIso } from './lib.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';

const API = 'https://developer.nlr.gov/api/alt-fuel-stations/v1';
const apiKey = String(process.env.NLR_API_KEY || '').trim();
const states = String(process.env.NLR_STATES || 'NY,NJ,CT')
  .split(',').map(value => value.trim().toUpperCase()).filter(Boolean);

if (!apiKey) {
  console.error('NLR_API_KEY is required. Add it as a GitHub Actions secret; never expose it in browser code or public JSON.');
  process.exit(1);
}
if (!states.length || states.some(state => !/^[A-Z]{2}$/.test(state))) {
  throw new Error('NLR_STATES must be a comma-separated list of two-letter state codes.');
}

const query = new URLSearchParams({
  api_key: apiKey,
  fuel_type: 'ELEC',
  ev_network: 'Tesla',
  state: states.join(','),
  country: 'US',
  status: 'all',
  limit: 'all'
});
const response = await fetch(`${API}.json?${query}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(45000) });
const body = await response.json().catch(() => ({}));
if (!response.ok) {
  const message = body?.errors?.join('; ') || body?.error || response.statusText || 'Unknown NLR API error';
  throw new Error(`NLR Alternative Fuel Stations API returned HTTP ${response.status}: ${message}`);
}
if (!Array.isArray(body.fuel_stations) || !Number.isFinite(Number(body.total_results))) {
  throw new Error('NLR API response did not match the expected Alternative Fuel Stations schema.');
}

const appStations = await readJson('data/stations.json', []);
if (!Array.isArray(appStations) || appStations.length === 0) {
  throw new Error('data/stations.json is empty or invalid; refusing to publish an unverified third-party station catalog.');
}
const normalizeName = value => String(value || '').toLowerCase()
  .replace(/\\bsupercharger\\b/g, '')
  .replace(/[^a-z0-9]+/g, ' ').trim();
const milesBetween = (aLat, aLng, bLat, bLng) => {
  const rad = value => value * Math.PI / 180;
  const dLat = rad(bLat - aLat), dLng = rad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 3958.7613 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
};
const matches = [];
for (const station of body.fuel_stations) {
  if (station.fuel_type_code !== 'ELEC' || String(station.ev_network || '').toLowerCase() !== 'tesla') continue;
  if (!states.includes(String(station.state || '').toUpperCase())) continue;
  const sourceName = normalizeName(station.station_name);
  const matched = appStations.find(appStation => {
    if (String(appStation.state || '').toUpperCase() !== String(station.state || '').toUpperCase()) return false;
    const appName = normalizeName(appStation.name);
    if (sourceName && appName && sourceName === appName) return true;
    const numericCoordinate = value => value === null || value === undefined || value === '' ? NaN : Number(value);
    const appLat = numericCoordinate(appStation.lat ?? appStation.latitude);
    const appLng = numericCoordinate(appStation.lng ?? appStation.longitude);
    const sourceLat = numericCoordinate(station.latitude), sourceLng = numericCoordinate(station.longitude);
    if ([appLat, appLng, sourceLat, sourceLng].every(Number.isFinite)) {
      return milesBetween(appLat, appLng, sourceLat, sourceLng) <= 0.5;
    }
    return false;
  });
  if (!matched) continue;
  matches.push({
    appStationId: String(matched.id),
    nlrStationId: Number(station.id),
    name: station.station_name ?? null,
    network: station.ev_network ?? null,
    networkWebsite: station.ev_network_web ?? null,
    state: station.state ?? null,
    city: station.city ?? null,
    address: [station.street_address, station.city, station.state, station.zip].filter(Boolean).join(', '),
    zip: station.zip ?? null,
    latitude: typeof station.latitude === 'number' ? station.latitude : null,
    longitude: typeof station.longitude === 'number' ? station.longitude : null,
    statusCode: station.status_code ?? null,
    expectedDate: station.expected_date ?? null,
    accessCode: station.access_code ?? null,
    accessDaysTime: station.access_days_time ?? null,
    connectorTypes: Array.isArray(station.ev_connector_types) ? station.ev_connector_types : [],
    dcFastCount: station.ev_dc_fast_num ?? null,
    level2Count: station.ev_level2_evse_num ?? null,
    pricingDescription: station.ev_pricing ?? null,
    dateLastConfirmed: station.date_last_confirmed ?? null,
    sourceUpdatedAt: station.updated_at ?? null,
    geocodeStatus: station.geocode_status ?? null,
    facilityType: station.facility_type ?? null,
    sourceUrl: 'https://afdc.energy.gov/stations/'
  });
}
matches.sort((a, b) => String(a.state).localeCompare(String(b.state)) || String(a.name).localeCompare(String(b.name)));
if (matches.length === 0) {
  throw new Error('No NLR Tesla stations matched existing CaughtaKWH stations; refusing to replace the prior snapshot.');
}

const snapshot = {
  schemaVersion: 1,
  source: 'U.S. Department of Energy Alternative Fuels Data Center (AFDC) via NLR Developer Network',
  sourceUrl: 'https://developer.nlr.gov/docs/transportation/alt-fuel-stations-v1/',
  methodologyUrl: 'https://afdc.energy.gov/fuels/electricity_infrastructure.html',
  attribution: 'Station inventory and metadata from the Alternative Fuels Data Center. This feed is for station metadata and corroboration, not a real-time pricing source.',
  generatedAt: nowIso(),
  sourceDataUpdatedAt: body.last_updated ?? body.metadata?.last_updated ?? null,
  states,
  network: 'Tesla',
  queryTotalResults: Number(body.total_results),
  matchedStationCount: matches.length,
  stations: matches
};

const previous = await readJson('data/nlr-afdc-stations.json', null);
if (previous && Array.isArray(previous.stations) && previous.stations.length > 0) {
  await writeJson('data/backups/nlr-afdc-stations-previous.json', previous);
}
const hourBucket = new Date().toISOString().slice(0, 13).replace('T', '-');
const archivePath = path.join('data', 'history', 'nlr-afdc-stations', `${hourBucket}.json`);
try {
  await fs.access(archivePath);
} catch {
  await writeJson(archivePath, snapshot);
}
await writeJson('data/nlr-afdc-stations.json', snapshot);
console.log(JSON.stringify({
  generatedAt: snapshot.generatedAt,
  sourceDataUpdatedAt: snapshot.sourceDataUpdatedAt,
  states,
  queryTotalResults: snapshot.queryTotalResults,
  matchedStationCount: snapshot.matchedStationCount,
  source: snapshot.source
}, null, 2));
