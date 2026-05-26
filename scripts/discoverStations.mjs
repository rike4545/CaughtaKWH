import { chromium } from '@playwright/test';
import path from 'node:path';
import { dataDir, readJson, writeJson, dedupeBy, nowIso } from './lib.mjs';

const TESLA_LIST_URL = process.env.TESLA_SUPERCHARGER_LIST_URL || 'https://www.tesla.com/findus/list/superchargers/United%20States';
const SUPERCHARGE_URL = process.env.SUPERCHARGE_INFO_URL || 'https://supercharge.info/service/supercharge/allSites';
const MAX_STATIONS = Number(process.env.MAX_STATIONS || 2500);

function stationIdFromHref(href) {
  const m = String(href || '').match(/\/findus\/location\/supercharger\/([^?#/]+)/);
  return m?.[1] || null;
}

function slug(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

function normalizeCountry(site) {
  return site?.address?.country || site?.address?.countryId || site?.country || site?.countryId || site?.location?.country || site?.location?.countryId || '';
}

function isUnitedStates(site) {
  const country = String(normalizeCountry(site)).toLowerCase().trim();
  return ['us', 'usa', 'united states', 'united states of america'].includes(country);
}

function isOpen(site) {
  const status = String(site?.status || site?.siteStatus || '').toLowerCase();
  return !status || status.includes('open') || status === 'live';
}

function normalizeSuperchargeSite(site) {
  const address = site.address || {};
  const gps = site.gps || site.location || {};
  const city = address.city || site.city || '';
  const state = address.state || site.state || '';
  const name = site.name || site.title || `${city} ${state} Supercharger`.trim();
  const locationId = site.locationId || site.location_id || site.teslaId || site.teslaLocationId || null;
  const id = locationId || site.id || `${slug(name)}-${slug(city)}-${slug(state)}`;
  const lat = Number(gps.latitude ?? gps.lat ?? site.latitude ?? site.lat);
  const lng = Number(gps.longitude ?? gps.lng ?? site.longitude ?? site.lng);
  const street = address.street || address.address || site.addressLine || '';
  const zip = address.zip || address.postcode || site.zip || '';
  return {
    id: String(id),
    name: String(name || id),
    city: city || null,
    state: state || null,
    country: 'United States',
    address: [street, city, state, zip].filter(Boolean).join(', ') || null,
    url: locationId ? `https://www.tesla.com/findus/location/supercharger/${locationId}` : (site.url || site.discussURL || site.permalink || null),
    source: locationId ? 'supercharge_info_with_tesla_location_id' : 'supercharge_info_directory',
    stalls: Number(site.stalls || site.stallCount || site.numStalls) || null,
    maxKw: Number(site.powerKilowatt || site.power || site.maxPowerKw || site.maxKw) || null,
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
    lastDiscoveredAt: nowIso()
  };
}

async function discoverFromSuperchargeInfo() {
  try {
    const response = await fetch(SUPERCHARGE_URL, { headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const sites = await response.json();
    if (!Array.isArray(sites)) throw new Error('unexpected Supercharge.info response');
    const usSites = sites.filter(isUnitedStates).filter(isOpen).map(normalizeSuperchargeSite);
    console.log(`Supercharge.info returned ${sites.length} sites; ${usSites.length} US open/live sites.`);
    return usSites;
  } catch (error) {
    console.log(`Supercharge.info discovery skipped: ${error.message}`);
    return [];
  }
}

async function discoverFromTeslaList() {
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(TESLA_LIST_URL, { waitUntil: 'networkidle', timeout: 90000 });
    await page.waitForTimeout(3500);
    const links = await page.$$eval('a[href*="/findus/location/supercharger/"]', anchors =>
      anchors.map(a => ({ href: a.href, text: a.textContent?.replace(/\s+/g, ' ').trim() || '' }))
    );
    console.log(`Tesla list returned ${links.length} station links.`);
    return links.map(({ href, text }) => {
      const id = stationIdFromHref(href);
      if (!id) return null;
      return {
        id,
        name: text || id.replace(/supercharger$/i, ' Supercharger'),
        country: 'United States',
        url: `https://www.tesla.com/findus/location/supercharger/${id}`,
        source: 'tesla_public_findus_list',
        lastDiscoveredAt: nowIso()
      };
    }).filter(Boolean);
  } catch (error) {
    console.log(`Tesla list discovery skipped: ${error.message}`);
    return [];
  } finally {
    if (browser) await browser.close();
  }
}

const existing = await readJson(path.join(dataDir, 'stations.json'), []);
const supercharge = await discoverFromSuperchargeInfo();
const tesla = await discoverFromTeslaList();
const discovered = dedupeBy([...supercharge, ...tesla], x => x.id).slice(0, MAX_STATIONS);
if (discovered.length <= 1) throw new Error(`Discovery returned only ${discovered.length} station(s). Refusing to overwrite dataset.`);
const merged = dedupeBy([...existing, ...discovered], x => x.id).sort((a, b) => String(a.name).localeCompare(String(b.name)));
await writeJson(path.join(dataDir, 'stations.json'), merged);
console.log(`Discovered ${discovered.length}; stored ${merged.length} stations.`);
