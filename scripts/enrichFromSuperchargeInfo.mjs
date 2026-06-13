/**
 * Enriches stations.json with data from supercharge.info's community database.
 *
 * Matching strategy (in priority order):
 *   1. locationId slug extracted from station.url vs supercharge.info locationId
 *   2. GPS proximity within 0.3 miles + normalized name similarity
 *
 * Enriched fields added to each matched station:
 *   superchargeInfoId, superchargeInfoStatus, dateOpened, powerKilowatt (if missing),
 *   stallCount (if missing), otherEVs, solarCanopy, battery, facilityName,
 *   plugshareId, stallTypes, plugTypes
 */

import path from 'node:path';
import { dataDir, readJson, writeJson, nowIso } from './lib.mjs';

const ALLSITES_URL = 'https://supercharge.info/service/supercharge/allSites';
const DB_INFO_URL  = 'https://supercharge.info/service/supercharge/databaseInfo';
const CACHE_FILE   = path.join(dataDir, 'supercharge-info-cache.json');
const STATIONS_FILE = path.join(dataDir, 'stations.json');

// --- Fetch helpers ---------------------------------------------------------

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { 'Accept': 'application/json', 'User-Agent': 'CaughtaKWH/2.0 (transparency project; contact carrollbh@gmail.com)' },
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.json();
}

// --- Cache: only re-fetch when supercharge.info db has changed -------------

async function loadSites() {
  const [dbInfo, cache] = await Promise.all([
    fetchJson(DB_INFO_URL).catch(() => null),
    readJson(CACHE_FILE, null),
  ]);
  if (cache && dbInfo && cache.lastModified === dbInfo.lastModified) {
    console.log(`supercharge.info cache is current (${dbInfo.lastModifiedString}), skipping fetch.`);
    return cache.sites;
  }
  console.log('Fetching supercharge.info allSites...');
  const sites = await fetchJson(ALLSITES_URL);
  await writeJson(CACHE_FILE, { lastModified: dbInfo?.lastModified ?? null, fetchedAt: nowIso(), sites });
  console.log(`Fetched ${sites.length} sites from supercharge.info.`);
  return sites;
}

// --- Matching helpers ------------------------------------------------------

function slugFromUrl(url) {
  return String(url || '').match(/\/findus\/location\/supercharger\/([^?#/]+)/i)?.[1]?.toLowerCase() ?? null;
}

function radians(v) { return v * Math.PI / 180; }
function milesBetween(aLat, aLng, bLat, bLng) {
  const R = 3958.76;
  const dLat = radians(bLat - aLat);
  const dLng = radians(bLng - aLng);
  const a = Math.sin(dLat/2)**2 + Math.cos(radians(aLat)) * Math.cos(radians(bLat)) * Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function normalizedName(value) {
  return String(value || '').toLowerCase()
    .replace(/supercharger/gi, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

// --- Main ------------------------------------------------------------------

const stations = await readJson(STATIONS_FILE, []);
const scSites  = await loadSites();

// Filter to US+Canada only (regionId 100 = North America) to keep matching fast
const usCanadaSites = scSites.filter(s => s.address?.regionId === 100);

// Build slug index
const bySlug = new Map();
for (const site of usCanadaSites) {
  if (site.locationId) bySlug.set(site.locationId.toLowerCase(), site);
}

// Build GPS grid index (1-decimal-degree cells ≈ 70 mi, coarse bucket)
const byGpsCell = new Map();
for (const site of usCanadaSites) {
  const lat = site.gps?.latitude;
  const lng = site.gps?.longitude;
  if (typeof lat !== 'number' || typeof lng !== 'number') continue;
  const key = `${Math.round(lat * 10)},${Math.round(lng * 10)}`;
  if (!byGpsCell.has(key)) byGpsCell.set(key, []);
  byGpsCell.get(key).push(site);
}

function gpsNeighbors(lat, lng) {
  const results = [];
  for (let dLat = -1; dLat <= 1; dLat++) {
    for (let dLng = -1; dLng <= 1; dLng++) {
      const key = `${Math.round(lat * 10) + dLat},${Math.round(lng * 10) + dLng}`;
      if (byGpsCell.has(key)) results.push(...byGpsCell.get(key));
    }
  }
  return results;
}

let matched = 0;
let unmatched = 0;
let slugMatched = 0;
let gpsMatched = 0;

for (const station of stations) {
  let site = null;
  let matchMethod = null;

  // 1. Slug match (most reliable)
  const slug = slugFromUrl(station.url);
  if (slug) {
    const candidate = bySlug.get(slug);
    if (candidate) { site = candidate; matchMethod = 'slug'; }
  }

  // 2. GPS proximity fallback (within 0.3 mi + name similarity)
  if (!site && typeof station.lat === 'number' && typeof station.lng === 'number') {
    const neighbors = gpsNeighbors(station.lat, station.lng);
    const stationName = normalizedName(station.name);
    let best = null;
    let bestScore = Infinity;
    for (const neighbor of neighbors) {
      const dist = milesBetween(station.lat, station.lng, neighbor.gps.latitude, neighbor.gps.longitude);
      if (dist > 0.3) continue;
      // Prefer closer + name-similar candidates
      const neighborName = normalizedName(neighbor.name);
      const nameSim = stationName === neighborName ? 0 : stationName.includes(neighborName) || neighborName.includes(stationName) ? 0.1 : 0.5;
      const score = dist + nameSim;
      if (score < bestScore) { bestScore = score; best = neighbor; }
    }
    if (best) { site = best; matchMethod = 'gps'; }
  }

  if (!site) { unmatched++; continue; }

  matched++;
  if (matchMethod === 'slug') slugMatched++;
  else gpsMatched++;

  // Enrich station with supercharge.info data
  station.superchargeInfoId     = site.id;
  station.superchargeInfoStatus = site.status; // OPEN / PLAN / CONSTRUCTION / CLOSED_PERM / etc.
  if (site.dateOpened)          station.dateOpened    = site.dateOpened;
  if (typeof site.powerKilowatt === 'number' && site.powerKilowatt > 0)
                                 station.maxKw         = site.powerKilowatt;
  if (typeof site.stallCount === 'number' && site.stallCount > 0)
                                 station.stalls        = site.stallCount;
  station.otherEVs              = Boolean(site.otherEVs);
  station.solarCanopy           = Boolean(site.solarCanopy);
  station.battery               = Boolean(site.battery);
  if (site.facilityName)        station.facilityName  = site.facilityName;
  if (site.plugshareId)         station.plugshareId   = site.plugshareId;
  if (site.stalls && Object.keys(site.stalls).length) station.stallTypes = site.stalls;
  if (site.plugs  && Object.keys(site.plugs).length)  station.plugTypes  = site.plugs;
  station.superchargeInfoMatchedAt = nowIso().slice(0, 10);
}

await writeJson(STATIONS_FILE, stations);
console.log(`Enriched ${matched}/${stations.length} stations from supercharge.info (${slugMatched} by slug, ${gpsMatched} by GPS). ${unmatched} unmatched.`);
