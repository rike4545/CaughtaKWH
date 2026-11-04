import path from 'node:path';
import { fetchWithScrapling, closeScraplingWorker } from './scraplingClient.mjs';
import { ProxyAgent, setGlobalDispatcher } from 'undici';
import { dataDir, readJson, writeJson, nowIso, stationHistoryPath } from './lib.mjs';
import { validateCapturedPrices } from './pricingNeuralNetwork.mjs';
import { isScrapeEligible, nextBlockedState, successfulScrapeState } from './scrapePolicy.mjs';
import { fetchHtmlWithRetry, isAccessControlStatus, isTransientStatus, summarizeTransport, transportSignal } from './scrapeTransport.mjs';
import { gatherProxyCandidates, parseProxy, checkProxy } from './proxyPool.mjs';
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
const pricingNeuralModel = await readJson(path.join(dataDir, 'pricing-neural-model.json'), null);
const previousScrapeHealth = await readJson(path.join(dataDir, 'scrape-health.json'), null);
const MAX_STATIONS = Number(process.env.MAX_STATIONS || stations.length || 1);
const DELAY_MS = Number(process.env.SCRAPE_DELAY_MS || 1200);
const LOW_PRICE_THRESHOLD = Number(process.env.LOW_PRICE_THRESHOLD || 0.30);
const SCRAPE_STATES = splitEnvList(process.env.SCRAPE_STATES || process.env.SCRAPE_STATE);
// Optional operator-configured regions are shared operational priorities, never inferred from visitors' locations.
const SCRAPE_PRIORITY_STATES = splitEnvList(process.env.SCRAPE_PRIORITY_STATES).map(state => state.toUpperCase());
const SCRAPE_COUNTRIES = splitEnvList(process.env.SCRAPE_COUNTRIES || process.env.SCRAPE_COUNTRY);
const SCRAPE_STATION_IDS = splitEnvList(process.env.SCRAPE_STATION_IDS || process.env.SCRAPE_STATION_ID);
const SCRAPE_ZIP = String(process.env.SCRAPE_ZIP || '').trim();
// Number('') is 0 and Number.isFinite(0) is true, so an unset SCRAPE_LAT/LNG — the workflow passes
// '' on scheduled runs — would otherwise become a real origin at 0,0 (the null island in the
// Atlantic). The nearby-distance filter then drops every US station and the run scrapes nothing.
// Treat blank/whitespace as "not provided" (NaN) so the scope falls through to states/all instead.
const parseCoord = value => {
  const raw = String(value ?? '').trim();
  return raw === '' ? NaN : Number(raw);
};
const SCRAPE_LAT = parseCoord(process.env.SCRAPE_LAT);
const SCRAPE_LNG = parseCoord(process.env.SCRAPE_LNG);
const SCRAPE_RADIUS_MILES = Number(process.env.SCRAPE_RADIUS_MILES || 150);
const SCRAPE_ROTATE_STATES = ['1', 'true', 'yes'].includes(String(process.env.SCRAPE_ROTATE_STATES || '').toLowerCase());
const SCRAPE_ROTATION_COUNT = Math.max(1, Number(process.env.SCRAPE_ROTATION_COUNT || 1));
const SCRAPE_NEEDS_HISTORY = ['1', 'true', 'yes'].includes(String(process.env.SCRAPE_NEEDS_HISTORY || '').toLowerCase());
const AKAMAI_CIRCUIT_BREAKER = Math.max(1, Number(process.env.AKAMAI_CIRCUIT_BREAKER || 3));
const BLOCK_COOLDOWN_BASE_HOURS = Math.max(1, Number(process.env.BLOCK_COOLDOWN_BASE_HOURS || 6));
const BLOCK_COOLDOWN_MAX_HOURS = Math.max(BLOCK_COOLDOWN_BASE_HOURS, Number(process.env.BLOCK_COOLDOWN_MAX_HOURS || 72));
const SCRAPE_IGNORE_COOLDOWN = ['1', 'true', 'yes'].includes(String(process.env.SCRAPE_IGNORE_COOLDOWN || '').toLowerCase());
const FETCH_MAX_ATTEMPTS = Math.max(1, Number(process.env.FETCH_MAX_ATTEMPTS || 2));
const FETCH_RETRY_DELAY_MS = Math.max(0, Number(process.env.FETCH_RETRY_DELAY_MS || 750));
const ROUTE_BLOCK_COOLDOWN_MINUTES = Math.max(15, Number(process.env.ROUTE_BLOCK_COOLDOWN_MINUTES || 30));
const ROUTE_CANARY_STATIONS = Math.max(1, Number(process.env.ROUTE_CANARY_STATIONS || 1));
const capturedAt = nowIso();
const capturedDate = new Date(capturedAt);

// --- Egress proxy pool with health-checked failover ------------------------
// Routes scraper traffic through one or more proxies. Free/public proxies are dead or blocked
// most of the time, so candidates (SCRAPE_PROXY + SCRAPE_PROXY_LIST + SCRAPE_PROXY_LIST_URL)
// are health-checked and rotated through: a dead one is skipped, and if Akamai blocks stack up
// mid-run the fetch route rotates to the next healthy proxy instead of ending the run. This
// changes network routing only; block detection, cooldowns, and circuit breakers still apply.
const SCRAPE_PROXY_USERNAME = String(process.env.SCRAPE_PROXY_USERNAME || '').trim();
const SCRAPE_PROXY_PASSWORD = String(process.env.SCRAPE_PROXY_PASSWORD || '').trim();
const PROXY_CHECK_URL = String(process.env.SCRAPE_PROXY_CHECK_URL || 'https://api.ipify.org').trim();
const PROXY_CHECK_TIMEOUT_MS = Math.max(1000, Number(process.env.SCRAPE_PROXY_CHECK_TIMEOUT_MS || 8000));
const PROXY_MAX_CANDIDATES = Math.max(1, Number(process.env.SCRAPE_PROXY_MAX_CANDIDATES || 25));
const PROXY_SKIP_CHECK = ['1', 'true', 'yes'].includes(String(process.env.SCRAPE_PROXY_SKIP_CHECK || '').toLowerCase());

const proxyCandidates = (await gatherProxyCandidates(process.env))
  .map(raw => parseProxy(raw, { username: SCRAPE_PROXY_USERNAME, password: SCRAPE_PROXY_PASSWORD }))
  .filter(Boolean)
  .slice(0, PROXY_MAX_CANDIDATES);
const triedProxyUrls = new Set();
let activeProxy = null;

// Find the next candidate that passes a connectivity check, apply it to Node's global fetch
// dispatcher, and return its parsed form (with Playwright config). Returns null when the list
// is exhausted, so callers can fall back to a direct connection.
async function activateNextProxy() {
  for (const candidate of proxyCandidates) {
    if (triedProxyUrls.has(candidate.dispatcherUrl)) continue;
    triedProxyUrls.add(candidate.dispatcherUrl);
    if (!PROXY_SKIP_CHECK) {
      const ok = await checkProxy(candidate, { url: PROXY_CHECK_URL, timeoutMs: PROXY_CHECK_TIMEOUT_MS });
      if (!ok) {
        console.log(`Proxy ${candidate.host} failed the connectivity check; skipping.`);
        continue;
      }
    }
    try {
      setGlobalDispatcher(new ProxyAgent({ uri: candidate.dispatcherUrl }));
    } catch (error) {
      console.warn(`Could not apply proxy ${candidate.host} to fetch: ${error.message}`);
      continue;
    }
    activeProxy = candidate;
    console.log(`Routing scraper fetch traffic through proxy ${candidate.host} (${triedProxyUrls.size}/${proxyCandidates.length} tried).`);
    return candidate;
  }
  return null;
}

if (!proxyCandidates.length) {
  console.log('No proxy configured — using the runner IP directly (likely Akamai-blocked from CI).');
} else {
  await activateNextProxy();
  if (!activeProxy) console.log(`None of the ${proxyCandidates.length} proxy candidate(s) passed the connectivity check — using the runner IP directly.`);
}
// Scrapling receives the current active proxy on each request, including after failover.
const proxyConfig = activeProxy ? activeProxy.dispatcherUrl : null;

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
  // Require both coords finite and not the 0,0 null island (never a real Supercharger origin).
  const hasCoordOrigin = Number.isFinite(SCRAPE_LAT) && Number.isFinite(SCRAPE_LNG)
    && !(SCRAPE_LAT === 0 && SCRAPE_LNG === 0);
  const origin = hasCoordOrigin
    ? { label: `${SCRAPE_LAT},${SCRAPE_LNG}`, lat: SCRAPE_LAT, lng: SCRAPE_LNG }
    : SCRAPE_ZIP
      ? await geocodeZip(SCRAPE_ZIP)
      : null;
  const rotationStates = SCRAPE_ROTATE_STATES ? rotatedStatesForToday(stations, capturedDate) : [];
  // Scheduled runs continue the rotating national sweep while including explicitly configured priority regions.
  const states = SCRAPE_STATES.length
    ? SCRAPE_STATES
    : [...new Set([...rotationStates, ...(SCRAPE_ROTATE_STATES ? SCRAPE_PRIORITY_STATES : [])])];
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
  return fetchHtmlWithRetry(url, {
    headers: FETCH_HEADERS,
    fetchImpl: async target => {
      const result = await fetchWithScrapling(target, { proxy: activeProxy?.dispatcherUrl || null });
      return {
        ok: result.status >= 200 && result.status < 300,
        status: result.status,
        url: result.finalUrl || target,
        headers: { get: name => name.toLowerCase() === 'retry-after' ? result.retryAfter || null : null },
        text: async () => result.html || ''
      };
    },
    maxAttempts: FETCH_MAX_ATTEMPTS,
    retryDelayMs: FETCH_RETRY_DELAY_MS
  });
}

function scrapeError(outcome, attempts, message = outcome) {
  const error = new Error(message);
  error.scrapeOutcome = outcome;
  error.attempts = attempts;
  error.retryAfter = attempts.map(attempt => attempt.retryAfter).find(Boolean) || null;
  return error;
}

function schedulePriceRange(charts, membershipType) {
  const values = Object.values(charts || {})
    .filter(chart => chart?.membershipType === membershipType)
    .flatMap(chart => Array.isArray(chart.slots) ? chart.slots : [])
    .map(slot => Number(slot?.pricePerKwh))
    .filter(value => Number.isFinite(value) && value > 0 && value <= 2.5);
  if (!values.length) return { min: null, max: null, samples: 0 };
  return {
    min: Number(Math.min(...values).toFixed(4)),
    max: Number(Math.max(...values).toFixed(4)),
    samples: values.length
  };
}

async function scrapeOne(station) {
  const candidates = stationCandidates(station);
  const attempts = [];
  let bestValid = null;
  let lastError = null;

  for (const candidate of candidates) {
    const { url, reason } = candidate;

    // Scrapling HTTP fetch: Tesla's SSR pages embed pricing in __NEXT_DATA__ JSON.
    const fetched = await fetchHtml(url);
    const fetchSite = classifySiteContent({ html: fetched.html, status: fetched.status, finalUrl: fetched.finalUrl });
    const fetchSignal = fetchSite.contentSignal !== 'unknown'
      ? fetchSite.contentSignal
      : fetched.status === 0
        ? transportSignal(fetched.status)
        : 'unknown';
    const fetchAttempt = {
      url,
      finalUrl: fetched.finalUrl,
      reason,
      status: fetched.status,
      retryAfter: fetched.retryAfter,
      retryCount: fetched.retryCount,
      requestAttempts: fetched.requestAttempts,
      durationMs: fetched.durationMs,
      contentSignal: fetchSignal,
      hasPrice: false,
      hasAvailability: false,
      via: 'fetch'
    };

    if (fetchSite.blocked || isAccessControlStatus(fetched.status)) {
      attempts.push(fetchAttempt);
      throw scrapeError('access_control', attempts, fetchSite.rateLimited ? 'tesla_rate_limited' : 'tesla_access_controlled');
    }
    if (fetchSite.pageNotFound || fetched.status === 410) {
      attempts.push({ ...fetchAttempt, contentSignal: 'not_found' });
      continue;
    }
    if (isTransientStatus(fetched.status)) {
      attempts.push({ ...fetchAttempt, contentSignal: 'transient_failure', error: fetched.error });
      continue;
    }
    if (fetched.status >= 400) {
      attempts.push({ ...fetchAttempt, contentSignal: 'http_error', error: fetched.error });
      continue;
    }

    if (fetched.status === 200 && fetched.html) {
      const nextData = fetchSite.validTeslaLocation ? extractNextData(fetched.html) : null;
      if (nextData) {
        const timeOfDayPricing = nextData.timeOfDayPricing || {};
        const memberSchedule = schedulePriceRange(timeOfDayPricing, 'member');
        const nonMemberSchedule = schedulePriceRange(timeOfDayPricing, 'non_tesla');
        const memberPrice = nextData.memberPrice ?? memberSchedule.min;
        const memberPeakPrice = nextData.memberPeakPrice ?? (memberSchedule.max !== memberSchedule.min ? memberSchedule.max : null);
        const nonMemberPrice = nextData.nonMemberPrice ?? nonMemberSchedule.min;
        const nonMemberPeakPrice = nextData.nonMemberPeakPrice ?? (nonMemberSchedule.max !== nonMemberSchedule.min ? nonMemberSchedule.max : null);
        const observedRates = [memberPrice, memberPeakPrice, nonMemberPrice, nonMemberPeakPrice]
          .filter(value => typeof value === 'number' && Number.isFinite(value));
        const prices = {
          memberPricePerKwh: memberPrice,
          memberPeakPricePerKwh: memberPeakPrice,
          nonMemberPricePerKwh: nonMemberPrice,
          nonMemberPeakPricePerKwh: nonMemberPeakPrice,
          congestionFeePerMinuteMax: nextData.congestionFee ?? null,
          lowestObservedPricePerKwh: observedRates.length ? Math.min(...observedRates) : null,
          lowPriceId: observedRates.length && Math.min(...observedRates) < LOW_PRICE_THRESHOLD ? 'low_under_030_kwh' : null,
          priceExtractionVersion: 'scrapling-next-data-v2',
          priceCandidateCount: observedRates.length,
          timeOfDayPricing,
          priceEvidence: {
            source: '__NEXT_DATA__',
            scraper: 'Scrapling',
            ...nextData,
            scheduleDerived: { member: memberSchedule, nonTesla: nonMemberSchedule }
          }
        };
        const availability = inferAvailability('', station);
        const siteDetails = inferSiteDetails({ bodyText: '', html: fetched.html, station, url: fetched.finalUrl, candidateReason: reason });
        const hasPrice = prices.memberPricePerKwh != null || prices.nonMemberPricePerKwh != null;
        const hasSchedule = Object.values(prices.timeOfDayPricing || {}).some(chart => Array.isArray(chart.slots) && chart.slots.length > 0);
        attempts.push({ ...fetchAttempt, contentSignal: 'tesla_location_page', hasPrice: hasPrice || hasSchedule, hasSchedule, publicDetailsFound: siteDetails.publicDetailsFound, priceCandidateCount: prices.priceCandidateCount, via: 'fetch+next_data' });
        return { url: fetched.finalUrl, prices, availability, siteDetails, bodyText: '', hasPrice: hasPrice || hasSchedule, hasAvailability: false, attempts };
      }
      // Page loaded but no __NEXT_DATA__ pricing — try text extraction before Playwright
      const prices = fetchSite.validTeslaLocation ? inferPrices('', fetched.html) : inferPrices('', '');
      if (prices.memberPricePerKwh != null || prices.nonMemberPricePerKwh != null) {
        const availability = inferAvailability('', station);
        const siteDetails = inferSiteDetails({ bodyText: '', html: fetched.html, station, url: fetched.finalUrl, candidateReason: reason });
        attempts.push({ ...fetchAttempt, contentSignal: 'tesla_location_page', hasPrice: true, publicDetailsFound: siteDetails.publicDetailsFound, priceCandidateCount: prices.priceCandidateCount, via: 'fetch+html' });
        return { url: fetched.finalUrl, prices, availability, siteDetails, bodyText: '', hasPrice: true, hasAvailability: false, attempts };
      }
    }
    attempts.push(fetchAttempt);

    // Scrapling's standard HTTP fetcher is the sole transport. Tesla's public
    // location pages are server-rendered; if a valid page has no public price
    // evidence, preserve its diagnostics rather than launching a stealth browser.
    if (fetchSite.validTeslaLocation && !bestValid) {
      const prices = inferPrices('', fetched.html);
      const availability = inferAvailability(fetched.html, station);
      const siteDetails = inferSiteDetails({ bodyText: '', html: fetched.html, station, url: fetched.finalUrl, candidateReason: reason });
      bestValid = {
        url: fetched.finalUrl,
        prices,
        availability,
        siteDetails,
        bodyText: '',
        hasPrice: prices.memberPricePerKwh !== null || prices.nonMemberPricePerKwh !== null,
        hasAvailability: availability.availableStalls !== null || availability.utilizationPct !== null || availability.availabilityLabel !== null,
        attempts: [...attempts]
      };
    }
    if (fetchSite.validTeslaLocation) continue;
  }

  if (bestValid) return bestValid;
  const signals = attempts.map(attempt => attempt.contentSignal).filter(Boolean);
  const resolvedSignals = signals.filter(signal => signal !== 'unknown');
  const transientOnly = resolvedSignals.length > 0 && resolvedSignals.every(signal => signal === 'transient_failure');
  throw scrapeError(
    transientOnly ? 'transient_failure' : 'no_usable_candidate',
    attempts,
    lastError ? String(lastError.message || lastError) : transientOnly ? 'temporary_transport_failure' : 'No usable Tesla location candidate'
  );
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
  // Configured regions receive a bounded boost; normal freshness/history scoring still applies.
  if (SCRAPE_PRIORITY_STATES.includes(String(station.state || '').toUpperCase())) score += 100;
  // Stations confirmed Akamai-blocked last run are deprioritized unless they have price history.
  // They still rotate in over time as scrapeAge accumulates, but don't crowd out unknown stations.
  if (station.lastScrapeBlocked && samples === 0) score -= 200;
  return Number(score.toFixed(2));
}

function needsUsableHistory(station) {
  const stationPredictions = predictions.filter(prediction => prediction.stationId === station.id);
  if (!stationPredictions.length) return true;
  return stationPredictions.some(prediction => Number(prediction.sampleCount || 0) < 3 || Number(prediction.latestObservationAgeHours ?? Infinity) > 48);
}

const scope = await scrapeScope();
const distanceByStation = new Map();
let cooldownSkipped = 0;
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
  if (!SCRAPE_IGNORE_COOLDOWN) {
    const beforeCooldown = scoped.length;
    scoped = scoped.filter(station => isScrapeEligible(station, capturedDate));
    cooldownSkipped = beforeCooldown - scoped.length;
  }
  return scoped;
}

const inScope = scopedStations();

const previousHealthAt = previousScrapeHealth?.generatedAt ? new Date(previousScrapeHealth.generatedAt) : null;
const previousHealthAgeMinutes = previousHealthAt && !Number.isNaN(previousHealthAt.getTime())
  ? Math.max(0, (capturedDate.getTime() - previousHealthAt.getTime()) / 60000)
  : Infinity;
const previousRouteBlocked = Boolean(
  previousScrapeHealth?.adaptiveRoute?.routeAccessControlLikely
  || (previousScrapeHealth?.circuitBreaker?.opened && Number(previousScrapeHealth?.validPages || 0) === 0)
);
const routeCooldownActive = previousRouteBlocked && previousHealthAgeMinutes < ROUTE_BLOCK_COOLDOWN_MINUTES;
const effectiveMaxStations = routeCooldownActive
  ? Math.min(MAX_STATIONS, ROUTE_CANARY_STATIONS)
  : MAX_STATIONS;

if (routeCooldownActive) {
  console.log(
    `Recent route-wide access control detected ${Math.round(previousHealthAgeMinutes)}m ago; `
    + `running ${effectiveMaxStations} canary station(s) before resuming the normal ${MAX_STATIONS}-station budget.`
  );
}

const ordered = inScope.map(station => ({ station, priorityScore: priorityFor(station) + (distanceByStation.has(station) ? Math.max(0, 100 - distanceByStation.get(station)) : 0) })).sort((a, b) => b.priorityScore - a.priorityScore).map(item => item.station);

function summarizeAttempts(attempts) {
  return Array.isArray(attempts) ? attempts.slice(0, 8).map(attempt => ({
    url: attempt.url,
    reason: attempt.reason,
    status: attempt.status ?? null,
    retryAfter: attempt.retryAfter ?? null,
    via: attempt.via ?? null,
    durationMs: attempt.durationMs ?? null,
    retryCount: attempt.retryCount ?? 0,
    contentSignal: attempt.contentSignal ?? null,
    hasPrice: Boolean(attempt.hasPrice),
    hasAvailability: Boolean(attempt.hasAvailability),
    priceCandidateCount: attempt.priceCandidateCount ?? 0,
    publicDetailsFound: Boolean(attempt.publicDetailsFound),
    error: attempt.error ?? null
  })) : [];
}

let saved = 0;
let attempted = 0;
let blocked = 0;
let failed = 0;
let transientFailures = 0;
let unusableCandidates = 0;
let validPages = 0;
let consecutiveBlocked = 0;
let circuitOpened = false;
const attemptedStationIds = [];
const blockedStationIds = [];
const transientFailureStationIds = [];
const unusableStationIds = [];
const runAttempts = [];
const blockedCooldownSnapshots = new Map();
for (const station of ordered.slice(0, effectiveMaxStations)) {
  if (consecutiveBlocked >= AKAMAI_CIRCUIT_BREAKER) {
    circuitOpened = true;
    break;
  }
  attempted++;
  attemptedStationIds.push(station.id);
  try {
    const result = await scrapeOne(station);
    runAttempts.push(...result.attempts);
    validPages++;
    consecutiveBlocked = 0;
    const observation = { stationId: station.id, capturedAt, localDate: capturedAt.slice(0, 10), localHour: capturedDate.getHours(), localMinute: capturedDate.getMinutes(), halfHourSlot: halfHourSlot(capturedDate), ...result.prices, ...result.availability, currency: 'USD', source: 'tesla_public_findus_location_page', url: result.url };
    observation.neuralValidation = validateCapturedPrices(pricingNeuralModel, { station, observation });
    const hasPrice = observation.memberPricePerKwh !== null || observation.nonMemberPricePerKwh !== null;
    const hasSchedule = Object.values(observation.timeOfDayPricing || {}).some(chart => Array.isArray(chart?.slots) && chart.slots.length > 0);
    const hasAvailability = observation.availableStalls !== null || observation.utilizationPct !== null || observation.availabilityLabel !== null;
    // Preserve a Tesla time-of-day chart even when the page omits a headline rate and
    // availability. A schedule is useful source evidence, but is not itself a live quote.
    if (hasPrice || hasSchedule || hasAvailability) {
      const history = await readJson(stationHistoryPath(station.id), []);
      const key = `${observation.capturedAt}-${observation.memberPricePerKwh}-${observation.nonMemberPricePerKwh}-${observation.congestionFeePerMinuteMax}-${observation.availableStalls}-${observation.utilizationPct}-${JSON.stringify(observation.timeOfDayPricing || {})}`;
      const merged = [...history.filter(x => `${x.capturedAt}-${x.memberPricePerKwh}-${x.nonMemberPricePerKwh}-${x.congestionFeePerMinuteMax}-${x.availableStalls}-${x.utilizationPct}-${JSON.stringify(x.timeOfDayPricing || {})}` !== key), observation];
      await writeJson(stationHistoryPath(station.id), merged);
      saved++;
    }
    // Only update the stored URL if the result came from a real Tesla page, not a redirect or challenge.
    if (result.url && String(result.url).includes('/findus/location/supercharger/')) station.url = result.url;
    Object.assign(station, successfulScrapeState(capturedAt));
    station.lastScrapeHadPrice = hasPrice;
    station.lastScrapeHadAvailability = hasAvailability;
    station.lastPriceCandidateCount = result.prices.priceCandidateCount;
    station.lastNeuralValidation = observation.neuralValidation;
    station.lastLowPriceId = result.prices.lowPriceId;
    station.lastScrapeAttemptCount = result.attempts.length;
    station.lastTransportSummary = summarizeTransport(result.attempts);
    station.lastScrapeResult = hasPrice ? 'price_found' : hasAvailability ? 'availability_found' : 'valid_page_no_public_data';
    station.lastScrapeCandidates = summarizeAttempts(result.attempts);
    station.lastSiteDetails = {
      ...result.siteDetails,
      lastCheckedAt: capturedAt,
      scrapeResult: station.lastScrapeResult
    };
    station.observationPriorityScore = priorityFor(station);
    delete station.lastScrapeError;
  } catch (error) {
    const outcome = error.scrapeOutcome || 'no_usable_candidate';
    const isBlocked = outcome === 'access_control';
    runAttempts.push(...(Array.isArray(error.attempts) ? error.attempts : []));
    station.lastScrapeError = String(error.message || error);
    station.lastAttemptedAt = capturedAt;
    if (isBlocked) {
      blocked++;
      consecutiveBlocked++;
      blockedStationIds.push(station.id);
      blockedCooldownSnapshots.set(station.id, {
        lastBlockedAt: station.lastBlockedAt ?? null,
        lastScrapeBlocked: Boolean(station.lastScrapeBlocked),
        consecutiveBlockedAttempts: Number(station.consecutiveBlockedAttempts || 0),
        blockCooldownHours: Number(station.blockCooldownHours || 0),
        nextScrapeEligibleAt: station.nextScrapeEligibleAt ?? null
      });
      if (!routeCooldownActive) {
        Object.assign(station, nextBlockedState(station, {
          attemptedAt: capturedAt,
          retryAfter: error.retryAfter,
          baseHours: BLOCK_COOLDOWN_BASE_HOURS,
          maxHours: BLOCK_COOLDOWN_MAX_HOURS
        }));
      } else {
        station.lastAttemptedAt = capturedAt;
      }
      // Free-proxy failover: once blocks reach the circuit-breaker threshold, rotate the fetch
      // route to the next healthy proxy and keep going rather than opening the circuit. Only when
      // every candidate is exhausted does consecutiveBlocked stay high and the breaker trip.
      if (consecutiveBlocked >= AKAMAI_CIRCUIT_BREAKER && triedProxyUrls.size < proxyCandidates.length) {
        const rotated = await activateNextProxy();
        if (rotated) {
          console.log(`Akamai blocks reached the breaker; rotated fetch traffic to proxy ${rotated.host} and continuing.`);
          consecutiveBlocked = 0;
        }
      }
    } else {
      failed++;
      if (outcome === 'transient_failure') {
        transientFailures++;
        transientFailureStationIds.push(station.id);
      } else {
        unusableCandidates++;
        unusableStationIds.push(station.id);
      }
      consecutiveBlocked = 0;
      station.lastScrapeBlocked = false;
      station.consecutiveBlockedAttempts = 0;
      station.blockCooldownHours = 0;
      station.nextScrapeEligibleAt = null;
    }
    station.lastScrapeResult = isBlocked ? (routeCooldownActive ? 'route_access_controlled' : 'access_controlled') : outcome;
    station.lastScrapeAttemptCount = Array.isArray(error.attempts) ? error.attempts.length : 0;
    station.lastScrapeCandidates = summarizeAttempts(error.attempts);
    station.lastTransportSummary = summarizeTransport(error.attempts);
    station.observationPriorityScore = priorityFor(station);
  } finally {
    await sleep(DELAY_MS);
  }
}

const routeAccessControlLikely = Boolean(
  (routeCooldownActive && attempted > 0 && blocked === attempted && validPages === 0)
  || (circuitOpened && blocked >= AKAMAI_CIRCUIT_BREAKER && validPages === 0)
);

// When unrelated stations all hit the same access-control wall, treat that as route health,
// not a station defect. Preserve the diagnostics but roll back station-specific cooldown growth.
if (routeAccessControlLikely) {
  for (const stationId of blockedStationIds) {
    const station = stations.find(item => item.id === stationId);
    const snapshot = blockedCooldownSnapshots.get(stationId);
    if (!station || !snapshot) continue;
    station.lastBlockedAt = snapshot.lastBlockedAt;
    station.lastScrapeBlocked = snapshot.lastScrapeBlocked;
    station.consecutiveBlockedAttempts = snapshot.consecutiveBlockedAttempts;
    station.blockCooldownHours = snapshot.blockCooldownHours;
    station.nextScrapeEligibleAt = snapshot.nextScrapeEligibleAt;
    station.lastScrapeResult = 'route_access_controlled';
  }
}

await closeScraplingWorker();
await writeJson(path.join(dataDir, 'stations.json'), stations);
await writeJson(path.join(dataDir, 'scrape-health.json'), {
  generatedAt: capturedAt,
  requestedLimit: MAX_STATIONS,
  effectiveLimit: effectiveMaxStations,
  inScopeStations: inScope.length,
  attempted,
  validPages,
  savedObservations: saved,
  blocked,
  failed,
  transientFailures,
  unusableCandidates,
  cooldownSkipped,
  attemptedStationIds,
  blockedStationIds,
  transientFailureStationIds,
  unusableStationIds,
  transport: {
    ...summarizeTransport(runAttempts),
    scraper: 'Scrapling FetcherSession',
    scraperVersion: '0.5',
    fetchMaxAttempts: FETCH_MAX_ATTEMPTS,
    retryDelayMs: FETCH_RETRY_DELAY_MS,
    proxyConfigured: Boolean(proxyConfig),
    proxyPool: {
      candidates: proxyCandidates.length,
      tried: triedProxyUrls.size,
      activeHost: activeProxy?.host || null
    }
  },
  circuitBreaker: {
    opened: circuitOpened,
    threshold: AKAMAI_CIRCUIT_BREAKER,
    consecutiveBlocks: consecutiveBlocked
  },
  adaptiveRoute: {
    previousRouteBlocked,
    previousHealthAgeMinutes: Number.isFinite(previousHealthAgeMinutes) ? Number(previousHealthAgeMinutes.toFixed(1)) : null,
    cooldownActive: routeCooldownActive,
    cooldownMinutes: ROUTE_BLOCK_COOLDOWN_MINUTES,
    canaryStations: ROUTE_CANARY_STATIONS,
    routeAccessControlLikely,
    nextProbeAt: routeAccessControlLikely
      ? new Date(capturedDate.getTime() + ROUTE_BLOCK_COOLDOWN_MINUTES * 60000).toISOString()
      : null
  },
  cooldownPolicy: {
    baseHours: BLOCK_COOLDOWN_BASE_HOURS,
    maxHours: BLOCK_COOLDOWN_MAX_HOURS,
    ignored: SCRAPE_IGNORE_COOLDOWN
  },
  scope: {
    states: scope.states,
    countries: scope.countries,
    nearby: scope.origin ? { label: scope.origin.label, radiusMiles: SCRAPE_RADIUS_MILES } : null,
    needsHistory: SCRAPE_NEEDS_HISTORY
  }
});
console.log(`Attempted ${attempted}/${effectiveMaxStations}; valid pages ${validPages}; access-controlled ${blocked}; transient ${transientFailures}; unusable ${unusableCandidates}; saved ${saved}; retries ${summarizeTransport(runAttempts).retries}; cooldown-skipped ${cooldownSkipped}; circuit ${circuitOpened ? 'open' : 'closed'}; route-health ${routeAccessControlLikely ? 'blocked' : routeCooldownActive ? 'canary' : 'normal'}. In-scope stations: ${inScope.length}/${stations.length}.`);
