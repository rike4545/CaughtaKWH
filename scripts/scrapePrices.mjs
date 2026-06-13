import { chromium } from '@playwright/test';
import path from 'node:path';
import { dataDir, readJson, writeJson, nowIso, stationHistoryPath } from './lib.mjs';
import {
  classifySiteContent,
  extractNextData,
  halfHourSlot,
  hoursSince,
  inferSiteDetails,
  inferAvailability,
  inferPrices,
  sleep,
  stationCandidates
} from './teslaSiteParser.mjs';

const stations = await readJson(path.join(dataDir, 'stations.json'), []);
const predictions = await readJson(path.join(dataDir, 'predictions.json'), []);
const MAX_STATIONS = Number(process.env.MAX_STATIONS || stations.length || 1);
const DELAY_MS = Number(process.env.SCRAPE_DELAY_MS || 1200);
const LOW_PRICE_THRESHOLD = Number(process.env.LOW_PRICE_THRESHOLD || 0.30);
const SCRAPE_STATES = splitEnvList(process.env.SCRAPE_STATES || process.env.SCRAPE_STATE);
const SCRAPE_COUNTRIES = splitEnvList(process.env.SCRAPE_COUNTRIES || process.env.SCRAPE_COUNTRY);
const SCRAPE_STATION_IDS = splitEnvList(process.env.SCRAPE_STATION_IDS || process.env.SCRAPE_STATION_ID);
const SCRAPE_ZIP = String(process.env.SCRAPE_ZIP || '').trim();
const SCRAPE_LAT = Number(process.env.SCRAPE_LAT);
const SCRAPE_LNG = Number(process.env.SCRAPE_LNG);
const SCRAPE_RADIUS_MILES = Number(process.env.SCRAPE_RADIUS_MILES || 150);
const SCRAPE_ROTATE_STATES = ['1', 'true', 'yes'].includes(String(process.env.SCRAPE_ROTATE_STATES || '').toLowerCase());
const SCRAPE_ROTATION_COUNT = Math.max(1, Number(process.env.SCRAPE_ROTATION_COUNT || 1));
const SCRAPE_NEEDS_HISTORY = ['1', 'true', 'yes'].includes(String(process.env.SCRAPE_NEEDS_HISTORY || '').toLowerCase());
const TESLA_HEADLESS = !['0', 'false', 'no'].includes(String(process.env.TESLA_HEADLESS ?? 'true').toLowerCase());
const capturedAt = nowIso();
const capturedDate = new Date(capturedAt);

function splitEnvList(value) {
  return String(value || '').split(',').map(item => item.trim()).filter(Boolean);
}

function radians(value) {
  return value * Math.PI / 180;
}

function milesBetween(aLat, aLng, bLat, bLng) {
  const radius = 3958.7613;
  const dLat = radians(bLat - aLat);
  const dLng = radians(bLng - aLng);
  const lat1 = radians(aLat);
  const lat2 = radians(bLat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

async function geocodeZip(zip) {
  const cleaned = String(zip || '').trim().replace(/[^0-9]/g, '').slice(0, 5);
  if (cleaned.length !== 5) throw new Error('SCRAPE_ZIP must be a 5-digit US ZIP code.');
  const response = await fetch(`https://api.zippopotam.us/us/${cleaned}`);
  if (!response.ok) throw new Error(`ZIP lookup failed for ${cleaned}: ${response.status}`);
  const json = await response.json();
  const place = json.places?.[0];
  if (!place) throw new Error(`ZIP lookup returned no place for ${cleaned}.`);
  return { label: `${cleaned} ${place['place name']}, ${place['state abbreviation']}`, lat: Number(place.latitude), lng: Number(place.longitude) };
}

function dayOfYear(date) {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const today = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return Math.floor((today - start) / 86400000);
}

function rotatedStatesForToday(allStations, date) {
  const states = [...new Set(allStations.map(station => station.state).filter(Boolean).map(String))].sort((a, b) => a.localeCompare(b));
  if (!states.length) return [];
  const start = dayOfYear(date) % states.length;
  return Array.from({ length: Math.min(SCRAPE_ROTATION_COUNT, states.length) }, (_, offset) => states[(start + offset) % states.length]);
}

async function scrapeScope() {
  const origin = Number.isFinite(SCRAPE_LAT) && Number.isFinite(SCRAPE_LNG)
    ? { label: `${SCRAPE_LAT},${SCRAPE_LNG}`, lat: SCRAPE_LAT, lng: SCRAPE_LNG }
    : SCRAPE_ZIP
      ? await geocodeZip(SCRAPE_ZIP)
      : null;
  const rotationStates = SCRAPE_ROTATE_STATES ? rotatedStatesForToday(stations, capturedDate) : [];
  const states = SCRAPE_STATES.length ? SCRAPE_STATES : rotationStates;
  return { origin, states, countries: SCRAPE_COUNTRIES };
}

const FETCH_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36';
const FETCH_HEADERS = {
  'User-Agent': FETCH_UA,
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Cache-Control': 'max-age=0',
  'Upgrade-Insecure-Requests': '1',
};

async function fetchHtml(url) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 18000);
    const response = await fetch(url, { headers: FETCH_HEADERS, redirect: 'follow', signal: controller.signal });
    clearTimeout(timer);
    if (!response.ok) return { html: '', status: response.status, finalUrl: response.url };
    const html = await response.text();
    return { html, status: response.status, finalUrl: response.url || url };
  } catch {
    return { html: '', status: 0, finalUrl: url };
  }
}

async function scrapeOne(context, station) {
  const candidates = stationCandidates(station);
  const attempts = [];
  let bestValid = null;
  let lastError = null;
  const hasStoredUrl = Boolean(station.url && String(station.url).includes('tesla.com'));

  for (const candidate of candidates) {
    const { url, reason } = candidate;
    const isStoredUrl = hasStoredUrl && url === station.url;

    // --- Fetch-first: try a plain HTTPS request before spinning up a browser tab.
    // Tesla's SSR pages embed full pricing in __NEXT_DATA__ JSON — no JS execution needed.
    // This is faster and far less detectable than Playwright for pages that cooperate.
    const fetched = await fetchHtml(url);
    if (fetched.status === 200 && fetched.html) {
      const nextData = extractNextData(fetched.html);
      if (nextData) {
        const prices = {
          memberPricePerKwh: nextData.memberPrice,
          nonMemberPricePerKwh: nextData.nonMemberPrice,
          congestionFeePerMinuteMax: nextData.congestionFee ?? null,
          lowestObservedPricePerKwh: [nextData.memberPrice, nextData.nonMemberPrice].filter(v => v != null).sort((a, b) => a - b)[0] ?? null,
          lowPriceId: null,
          priceExtractionVersion: 'tesla-next-data-v1',
          priceCandidateCount: (nextData.memberPrice != null ? 1 : 0) + (nextData.nonMemberPrice != null ? 1 : 0),
          priceEvidence: { source: '__NEXT_DATA__', ...nextData }
        };
        const availability = inferAvailability('', station);
        const siteDetails = inferSiteDetails({ bodyText: '', html: fetched.html, station, url: fetched.finalUrl, candidateReason: reason });
        const attempt = { url, finalUrl: fetched.finalUrl, reason, status: fetched.status, contentSignal: 'tesla_location_page', hasPrice: true, hasAvailability: false, publicDetailsFound: siteDetails.publicDetailsFound, priceCandidateCount: prices.priceCandidateCount, via: 'fetch+next_data' };
        attempts.push(attempt);
        return { url: fetched.finalUrl, prices, availability, siteDetails, bodyText: '', hasPrice: true, hasAvailability: false, attempts };
      }
      // Page loaded but no __NEXT_DATA__ pricing — try text extraction before Playwright
      const prices = inferPrices('', fetched.html);
      if (prices.memberPricePerKwh != null || prices.nonMemberPricePerKwh != null) {
        const availability = inferAvailability('', station);
        const siteDetails = inferSiteDetails({ bodyText: '', html: fetched.html, station, url: fetched.finalUrl, candidateReason: reason });
        attempts.push({ url, finalUrl: fetched.finalUrl, reason, status: fetched.status, contentSignal: 'tesla_location_page', hasPrice: true, hasAvailability: false, publicDetailsFound: siteDetails.publicDetailsFound, priceCandidateCount: prices.priceCandidateCount, via: 'fetch+html' });
        return { url: fetched.finalUrl, prices, availability, siteDetails, bodyText: '', hasPrice: true, hasAvailability: false, attempts };
      }
    }

    // --- Playwright fallback: needed when the page requires JS rendering.
    const page = await context.newPage();
    try {
      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      const status = response?.status() || 0;
      await page.waitForTimeout(isStoredUrl ? 3000 : 5500);
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
      await page.waitForTimeout(isStoredUrl ? 800 : 1200);
      await expandPricingAccordions(page);
      const bodyText = await page.locator('body').innerText({ timeout: 12000 });
      const html = await page.content().catch(() => '');
      const scriptsText = await page.locator('script').evaluateAll(nodes => nodes.map(n => n.textContent || '').join('\n')).catch(() => '');
      const prices = inferPrices(`${bodyText}\n${scriptsText}`, html);
      const availability = inferAvailability(bodyText, station);
      const siteDetails = inferSiteDetails({ bodyText, html, station, url: page.url() || url, candidateReason: reason });
      const hasPrice = prices.memberPricePerKwh !== null || prices.nonMemberPricePerKwh !== null;
      const hasAvailability = availability.availableStalls !== null || availability.utilizationPct !== null || availability.availabilityLabel !== null;
      const site = classifySiteContent({ bodyText, html, status, finalUrl: page.url() });
      const attempt = { url, finalUrl: page.url(), reason, status, contentSignal: site.contentSignal, hasPrice, hasAvailability, publicDetailsFound: siteDetails.publicDetailsFound, priceCandidateCount: prices.priceCandidateCount, via: 'playwright' };
      attempts.push(attempt);
      const result = { url: page.url() || url, prices, availability, siteDetails, bodyText, hasPrice, hasAvailability, attempts };
      if (hasPrice) return result;
      if ((hasAvailability || site.validTeslaLocation) && !bestValid) bestValid = result;
    } catch (error) {
      lastError = error;
      attempts.push({ url, reason, error: String(error.message || error) });
    } finally {
      await page.close();
    }
  }
  if (bestValid) return bestValid;
  const error = lastError || new Error('No usable Tesla location candidate');
  error.attempts = attempts;
  throw error;
}
async function expandPricingAccordions(page) {
  const labels = ['Pricing for Tesla & Members', 'Pricing for Non-Tesla'];
  for (const label of labels) {
    const summary = page.locator('summary').filter({ hasText: label }).first();
    try {
      if (await summary.count()) {
        const detailsOpen = await summary.evaluate(el => el.parentElement?.hasAttribute('open')).catch(() => false);
        if (!detailsOpen) await summary.click({ timeout: 5000 });
        continue;
      }
    } catch {}
    try {
      await page.getByText(label, { exact: true }).click({ timeout: 5000 });
    } catch {}
  }
  await page.waitForTimeout(800);
}
function priorityFor(station) {
  const prediction = predictions.find(p => p.stationId === station.id && p.membershipType === 'member') || predictions.find(p => p.stationId === station.id);
  const scrapeAge = hoursSince(station.lastScrapedAt);
  const observationAge = hoursSince(prediction?.latestObservedAt);
  const volatility = Number(prediction?.volatility || 0);
  const samples = Number(prediction?.sampleCount || 0);
  let score = 0;
  // Stations with proven price history are the top priority — keep them fresh above all else.
  if (samples > 0) score += 600 + Math.min(300, observationAge * 50);
  if (!Number.isFinite(scrapeAge)) score += 500; else score += Math.min(240, scrapeAge * 8);
  if (samples === 0) {
    if (!Number.isFinite(observationAge)) score += 220; else score += Math.min(180, observationAge * 6);
  }
  if (station.lastScrapeHadPrice) score += 120;
  if (!station.lastScrapeHadPrice && samples === 0) score += 40;
  if (station.lastScrapeHadAvailability && !station.lastScrapeHadPrice) score += 45;
  if (station.url) score += 35;
  if (typeof station.stalls === 'number') score += Math.min(40, station.stalls);
  if (typeof station.maxKw === 'number' && station.maxKw >= 250) score += 25;
  if (volatility >= 0.08) score += 90; else if (volatility >= 0.04) score += 45;
  if (samples < 3 && samples > 0) score += 80; else if (samples < 10) score += 35;
  if (SCRAPE_NEEDS_HISTORY && samples < 3) score += 160;
  if (['CA', 'NY', 'FL', 'TX', 'NJ', 'WA', 'MA'].includes(station.state)) score += 12;
  return Number(score.toFixed(2));
}

function needsUsableHistory(station) {
  const stationPredictions = predictions.filter(prediction => prediction.stationId === station.id);
  if (!stationPredictions.length) return true;
  return stationPredictions.some(prediction => Number(prediction.sampleCount || 0) < 3 || Number(prediction.latestObservationAgeHours ?? Infinity) > 48);
}

const scope = await scrapeScope();
const distanceByStation = new Map();
function scopedStations() {
  let scoped = [...stations];
  if (SCRAPE_STATION_IDS.length) {
    const wanted = new Set(SCRAPE_STATION_IDS.map(id => id.toLowerCase()));
    scoped = scoped.filter(station => wanted.has(String(station.id || '').toLowerCase()));
  }
  if (scope.states.length) {
    const wanted = new Set(scope.states.map(state => state.toLowerCase()));
    scoped = scoped.filter(station => wanted.has(String(station.state || '').toLowerCase()));
  }
  if (scope.countries.length) {
    const wanted = new Set(scope.countries.map(country => country.toLowerCase()));
    scoped = scoped.filter(station => wanted.has(String(station.country || '').toLowerCase()));
  }
  if (scope.origin) {
    scoped = scoped
      .filter(station => typeof station.lat === 'number' && typeof station.lng === 'number')
      .filter(station => {
        const distanceMiles = milesBetween(scope.origin.lat, scope.origin.lng, station.lat, station.lng);
        distanceByStation.set(station, distanceMiles);
        return distanceMiles <= SCRAPE_RADIUS_MILES;
      });
  }
  if (SCRAPE_NEEDS_HISTORY) {
    scoped = scoped.filter(needsUsableHistory);
  }
  return scoped;
}

const inScope = scopedStations();
const ordered = inScope.map(station => ({ station, priorityScore: priorityFor(station) + (distanceByStation.has(station) ? Math.max(0, 100 - distanceByStation.get(station)) : 0) })).sort((a, b) => b.priorityScore - a.priorityScore).map(item => item.station);
const browser = await chromium.launch({ headless: TESLA_HEADLESS, args: ['--disable-blink-features=AutomationControlled', '--disable-web-security', '--no-sandbox'] });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  locale: 'en-US',
  timezoneId: 'America/New_York',
  userAgent: FETCH_UA,
  extraHTTPHeaders: {
    'Accept-Language': 'en-US,en;q=0.9',
    'sec-ch-ua': '"Chromium";v="136", "Google Chrome";v="136", "Not.A/Brand";v="99"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"macOS"',
  }
});
let saved = 0;
let attempted = 0;
for (const station of ordered.slice(0, MAX_STATIONS)) {
  attempted++;
  try {
    const result = await scrapeOne(context, station);
    const observation = { stationId: station.id, capturedAt, localDate: capturedAt.slice(0, 10), localHour: capturedDate.getHours(), localMinute: capturedDate.getMinutes(), halfHourSlot: halfHourSlot(capturedDate), ...result.prices, ...result.availability, currency: 'USD', source: 'tesla_public_findus_location_page', url: result.url };
    const hasPrice = observation.memberPricePerKwh !== null || observation.nonMemberPricePerKwh !== null;
    const hasAvailability = observation.availableStalls !== null || observation.utilizationPct !== null || observation.availabilityLabel !== null;
    if (hasPrice || hasAvailability) {
      const history = await readJson(stationHistoryPath(station.id), []);
      const key = `${observation.capturedAt}-${observation.memberPricePerKwh}-${observation.nonMemberPricePerKwh}-${observation.congestionFeePerMinuteMax}-${observation.availableStalls}-${observation.utilizationPct}`;
      const merged = [...history.filter(x => `${x.capturedAt}-${x.memberPricePerKwh}-${x.nonMemberPricePerKwh}-${x.congestionFeePerMinuteMax}-${x.availableStalls}-${x.utilizationPct}` !== key), observation];
      await writeJson(stationHistoryPath(station.id), merged);
      saved++;
    }
    station.url = result.url;
    station.lastScrapedAt = capturedAt;
    station.lastScrapeHadPrice = hasPrice;
    station.lastScrapeHadAvailability = hasAvailability;
    station.lastPriceCandidateCount = result.prices.priceCandidateCount;
    station.lastLowPriceId = result.prices.lowPriceId;
    station.lastScrapeAttemptCount = result.attempts.length;
    station.lastScrapeResult = hasPrice ? 'price_found' : hasAvailability ? 'availability_found' : 'valid_page_no_public_data';
    station.lastScrapeCandidates = result.attempts.map(attempt => ({
      url: attempt.url,
      reason: attempt.reason,
      status: attempt.status ?? null,
      contentSignal: attempt.contentSignal ?? null,
      hasPrice: Boolean(attempt.hasPrice),
      hasAvailability: Boolean(attempt.hasAvailability),
      priceCandidateCount: attempt.priceCandidateCount ?? 0,
      publicDetailsFound: Boolean(attempt.publicDetailsFound),
      error: attempt.error ?? null
    }));
    station.lastSiteDetails = {
      ...result.siteDetails,
      lastCheckedAt: capturedAt,
      scrapeResult: station.lastScrapeResult
    };
    station.observationPriorityScore = priorityFor(station);
    delete station.lastScrapeError;
  } catch (error) {
    station.lastScrapeError = String(error.message || error);
    station.lastScrapedAt = capturedAt;
    station.lastScrapeHadPrice = false;
    station.lastScrapeHadAvailability = false;
    station.lastScrapeResult = 'no_usable_candidate';
    station.lastScrapeAttemptCount = Array.isArray(error.attempts) ? error.attempts.length : 0;
    station.lastScrapeCandidates = Array.isArray(error.attempts) ? error.attempts.slice(0, 8).map(attempt => ({
      url: attempt.url,
      reason: attempt.reason,
      status: attempt.status ?? null,
      contentSignal: attempt.contentSignal ?? null,
      hasPrice: Boolean(attempt.hasPrice),
      hasAvailability: Boolean(attempt.hasAvailability),
      priceCandidateCount: attempt.priceCandidateCount ?? 0,
      publicDetailsFound: Boolean(attempt.publicDetailsFound),
      error: attempt.error ?? null
    })) : [];
    station.observationPriorityScore = priorityFor(station);
  } finally {
    await sleep(DELAY_MS);
  }
}
await browser.close();
await writeJson(path.join(dataDir, 'stations.json'), stations);
console.log(`Attempted ${attempted}; saved price observations for ${saved} station(s). In-scope stations: ${inScope.length}/${stations.length}. States: ${scope.states.join(', ') || 'all'}. Countries: ${scope.countries.join(', ') || 'all'}. Nearby: ${scope.origin ? `${scope.origin.label} within ${SCRAPE_RADIUS_MILES} mi` : 'off'}. Needs-history mode: ${SCRAPE_NEEDS_HISTORY ? 'on' : 'off'}. Hardened extraction v3 enabled. Low price threshold: $${LOW_PRICE_THRESHOLD}/kWh.`);
