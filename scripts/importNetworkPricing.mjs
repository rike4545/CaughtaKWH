import { readJson, writeJson, nowIso } from './lib.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';

const API = 'https://dcfctracker.com/api/v1';
const apiKey = String(process.env.DCFC_API_KEY || '').trim();
const states = String(process.env.NETWORK_PRICING_STATES || 'NY,NJ,CT')
  .split(',').map(value => value.trim().toUpperCase()).filter(Boolean);
const networks = [
  'Tesla',
  'Electrify America',
  'EVgo',
  'IONNA',
  'ChargePoint',
  'Blink',
  'bp pulse',
  'Shell Recharge',
  'Rivian Adventure Network',
  'Rivian Waypoints',
  'Mercedes-Benz',
  'Red E Charge',
  'Francis Energy',
  'Walmart'
];

if (!apiKey) {
  console.error('DCFC_API_KEY is required. Configure it as a GitHub Actions secret; never expose it in browser code or public JSON.');
  process.exit(1);
}
if (!states.length || states.some(state => !/^[A-Z]{2}$/.test(state))) {
  throw new Error('NETWORK_PRICING_STATES must be a comma-separated list of two-letter state codes.');
}

async function requestPage(page) {
  const query = new URLSearchParams({
    networks: networks.join(','),
    states: states.join(','),
    page: String(page),
    limit: '1000'
  });
  const response = await fetch(`${API}/stations?${query}`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(45000)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = body?.error?.message || body?.error || response.statusText || 'Unknown API error';
    throw new Error(`DCFC Tracker API returned HTTP ${response.status}: ${message}`);
  }
  if (!Array.isArray(body.data) || !body.pagination || !Number.isFinite(Number(body.pagination.total))) {
    throw new Error('DCFC Tracker API response did not match the expected station-list schema.');
  }
  return body;
}

const collected = [];
let page = 1;
let expectedTotal = null;
let apiGeneratedAt = null;
while (true) {
  const body = await requestPage(page);
  if (expectedTotal === null) {
    expectedTotal = Number(body.pagination.total);
    apiGeneratedAt = body.generatedAt ?? null;
  } else if (body.generatedAt && apiGeneratedAt && body.generatedAt !== apiGeneratedAt) {
    throw new Error('DCFC Tracker changed its snapshot during pagination; refusing to publish a mixed-time snapshot. Retry the import.');
  }
  collected.push(...body.data);
  if (!body.pagination.hasMore) break;
  page += 1;
  if (page > 1000) throw new Error('DCFC Tracker pagination safety limit exceeded.');
}

const allowed = new Set(networks.map(value => value.toLowerCase()));
const stations = collected
  .filter(station => allowed.has(String(station.network || '').toLowerCase()))
  .filter(station => states.includes(String(station.state || '').toUpperCase()))
  .map(station => ({
    id: String(station.id),
    name: station.name ?? null,
    network: station.network ?? null,
    networkName: station.networkName ?? station.network ?? null,
    state: station.state ?? null,
    city: station.city ?? null,
    address: station.address ?? null,
    zip: station.zip ?? null,
    latitude: typeof station.latitude === 'number' ? station.latitude : null,
    longitude: typeof station.longitude === 'number' ? station.longitude : null,
    url: station.url ?? null,
    firstSeenAt: station.firstSeenAt ?? null,
    status: station.status ?? null,
    statusUpdatedAt: station.statusUpdatedAt ?? null,
    connectorTypes: Array.isArray(station.connectorTypes) ? station.connectorTypes : [],
    dcFastCount: station.dcFastCount ?? null,
    nacsCount: station.nacsCount ?? null,
    ccsCount: station.ccsCount ?? null,
    chademoCount: station.chademoCount ?? null,
    maxPowerKw: station.maxPowerKw ?? null,
    siteStationCount: station.siteStationCount ?? null,
    timeZone: station.timeZone ?? null,
    pricePerKwh: typeof station.pricePerKwh === 'number' ? station.pricePerKwh : null,
    memberPricePerKwh: typeof station.memberPricePerKwh === 'number' ? station.memberPricePerKwh : null,
    pricePerMin: typeof station.pricePerMin === 'number' ? station.pricePerMin : null,
    sessionFee: typeof station.sessionFee === 'number' ? station.sessionFee : null,
    priceNote: station.priceNote ?? null,
    priceSource: station.priceSource ?? null,
    priceSourceType: station.priceSourceType ?? null,
    priceRate: station.priceRate ?? null,
    priceUpdatedAt: station.priceUpdatedAt ?? null,
    pricing: station.pricing ?? null,
    sourceUrl: station.url ?? null
  }))
  .sort((a, b) => String(a.state).localeCompare(String(b.state))
    || String(a.network).localeCompare(String(b.network))
    || String(a.name).localeCompare(String(b.name)));

if (stations.length === 0) {
  throw new Error('No station records returned for the configured networks/states; refusing to replace the previous snapshot.');
}
const stationsWithPrices = stations.filter(station =>
  station.pricePerKwh !== null || station.memberPricePerKwh !== null
  || station.pricePerMin !== null || station.sessionFee !== null
  || (Array.isArray(station.pricing?.tracks) && station.pricing.tracks.length > 0)
).length;

const snapshot = {
  schemaVersion: 1,
  source: 'DCFC Tracker API; network price source is labeled per station',
  sourceUrl: 'https://dcfctracker.com/developers',
  methodologyUrl: 'https://dcfctracker.com/methodology',
  attribution: 'Station prices and site details are attributed to the source shown in each station record. Data reflects the source network’s published rate at its last sync and may differ from the rate charged at the stall. Confirm current rates in the network’s official app or at the charger.',
  generatedAt: nowIso(),
  apiGeneratedAt,
  states,
  networks,
  stationCount: stations.length,
  stationsWithPrices,
  stations
};

const previous = await readJson('data/network-pricing.json', null);
if (previous && Array.isArray(previous.stations) && previous.stations.length > 0) {
  const previousPriced = previous.stations.filter(station =>
    station.pricePerKwh !== null && station.pricePerKwh !== undefined
    || station.memberPricePerKwh !== null && station.memberPricePerKwh !== undefined
    || station.pricePerMin !== null && station.pricePerMin !== undefined
    || station.sessionFee !== null && station.sessionFee !== undefined
    || (Array.isArray(station.pricing?.tracks) && station.pricing.tracks.length > 0)
  ).length;
  if (previousPriced > 0 && stationsWithPrices === 0) {
    throw new Error('The new response contains no usable price fields; preserved the existing multi-network snapshot.');
  }
  await writeJson('data/backups/network-pricing-previous.json', previous);
}

const hourBucket = new Date().toISOString().slice(0, 13).replace('T', '-');
const archivePath = path.join('data', 'history', 'network-pricing', `${hourBucket}.json`);
try {
  await fs.access(archivePath);
} catch {
  await writeJson(archivePath, snapshot);
}
await writeJson('data/network-pricing.json', snapshot);
console.log(JSON.stringify({
  generatedAt: snapshot.generatedAt,
  apiGeneratedAt,
  states,
  networks: networks.length,
  stationCount: stations.length,
  stationsWithPrices,
  source: snapshot.source
}, null, 2));
