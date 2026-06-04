const LOW_PRICE_THRESHOLD = Number(process.env.LOW_PRICE_THRESHOLD || 0.30);
const TESLA_LOCATION_BASE = 'https://www.tesla.com/findus/location/supercharger';

export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function halfHourSlot(date) {
  return date.getHours() * 2 + (date.getMinutes() >= 30 ? 1 : 0);
}

export function hoursSince(iso) {
  return iso ? Math.max(0, (Date.now() - new Date(iso).getTime()) / 36e5) : Infinity;
}

function compact(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]/g, '');
}

function readableSlug(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\[.*?\]/g, '')
    .replace(/supercharger/ig, '')
    .replace(/&/g, 'and')
    .replace(/[^a-zA-Z0-9]+/g, '')
    .trim();
}

function locationIdFromUrl(value) {
  return String(value || '').match(/\/findus\/location\/supercharger\/([^?#/]+)/i)?.[1] || null;
}

function plausibleLocationId(value) {
  const id = String(value || '').trim();
  if (/^\d{3,}$/.test(id)) return true;
  return /[a-z]/i.test(id) && /supercharger/i.test(id);
}

function locationUrl(id) {
  return `${TESLA_LOCATION_BASE}/${encodeURIComponent(String(id))}`;
}

export function stationCandidates(station) {
  const candidates = [];
  const push = (url, reason) => {
    if (!url || !String(url).includes('/findus/location/supercharger/')) return;
    const id = locationIdFromUrl(url);
    if (!plausibleLocationId(id)) return;
    candidates.push({ url: String(url).split('?')[0], reason });
  };
  const pushId = (id, reason) => {
    if (plausibleLocationId(id)) push(locationUrl(id), reason);
  };

  push(station.url, 'stored_tesla_url');
  pushId(station.teslaLocationId || station.locationId, 'explicit_location_id');
  pushId(station.id, 'station_id');

  const city = readableSlug(station.city || '').replace(/^The/i, '');
  const state = compact(station.state || '');
  const name = readableSlug(station.name || '');
  const cityState = city && state ? `${city}${state}supercharger` : '';
  const nameState = name && state ? `${name}${state}supercharger` : '';
  const nameOnly = name ? `${name}supercharger` : '';

  pushId(cityState, 'city_state_slug');
  pushId(nameState, 'name_state_slug');
  pushId(nameOnly, 'name_slug');

  const seen = new Set();
  return candidates
    .filter(candidate => {
      const key = candidate.url.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, Number(process.env.MAX_SITE_CANDIDATES || 6));
}

function decodeEntities(value) {
  return String(value || '')
    .replace(/\\u002F/gi, '/')
    .replace(/\\u0026/gi, '&')
    .replace(/&amp;/gi, '&')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#x2F;/gi, '/')
    .replace(/&#47;/g, '/')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

export function normalizeText(text) {
  return decodeEntities(text)
    .replace(/\u00a0/g, ' ')
    .replace(/<\s*br\s*\/?>/gi, ' ')
    .replace(/<\/(p|div|section|article|span|li|dt|dd|tr|td|th|h\d)>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\\n|\\r|\\t/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseDollarValue(value) {
  const parsed = Number(String(value).replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(parsed)) return null;
  if (parsed <= 0 || parsed > 2.5) return null;
  return Number(parsed.toFixed(2));
}

function lowPriceId(price) {
  return typeof price === 'number' && price < LOW_PRICE_THRESHOLD ? 'low_under_030_kwh' : null;
}

function extractPriceCandidates(text) {
  const normalized = normalizeText(text);
  const candidates = [];
  const patterns = [
    /(?:\$\s*([0-9]+(?:\.[0-9]{1,3})?)\s*(?:\/|per)?\s*(?:kwh|kw\s*h|kilowatt[-\s]?hour))/ig,
    /(?:([0-9]+(?:\.[0-9]{1,3})?)\s*(?:usd|dollars?)?\s*(?:\/|per)\s*(?:kwh|kw\s*h|kilowatt[-\s]?hour))/ig,
    /(?:(?:kwh|kw\s*h|kilowatt[-\s]?hour)[^$0-9]{0,60}\$\s*([0-9]+(?:\.[0-9]{1,3})?))/ig,
    /(?:price|pricing|rate|cost|charging)[^$0-9]{0,80}\$\s*([0-9]+(?:\.[0-9]{1,3})?)/ig
  ];
  for (const pattern of patterns) {
    for (const match of normalized.matchAll(pattern)) {
      const price = parseDollarValue(match[1]);
      if (price === null) continue;
      const index = match.index ?? 0;
      const evidence = normalized.slice(Math.max(0, index - 180), Math.min(normalized.length, index + 300));
      candidates.push({ price, index, evidence, lowPriceId: lowPriceId(price) });
    }
  }
  const deduped = [];
  const seen = new Set();
  for (const candidate of candidates) {
    const key = `${candidate.price}-${Math.floor(candidate.index / 80)}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(candidate);
    }
  }
  return deduped;
}

function scoreCandidate(candidate, role) {
  const evidence = candidate.evidence.toLowerCase();
  let score = 0;
  if (/pricing|price|rate|cost|charging/.test(evidence)) score += 20;
  if (/kwh|kw h|kilowatt/.test(evidence)) score += 25;
  if (/supercharg/.test(evidence)) score += 8;
  if (/member|tesla/.test(evidence)) score += role === 'member' ? 22 : 4;
  if (/non[-\s]?tesla|non[-\s]?member|other ev|third[-\s]?party|nacs partner/.test(evidence)) score += role === 'nonMember' ? 25 : -12;
  if (/idle|parking|minute|min|congestion/.test(evidence)) score -= role === 'congestion' ? -15 : 30;
  if (candidate.price < 0.08) score -= 20;
  if (candidate.price > 1.25) score -= 15;
  return score;
}

function bestCandidate(candidates, role) {
  if (!candidates.length) return null;
  return [...candidates].sort((a, b) => scoreCandidate(b, role) - scoreCandidate(a, role))[0];
}

function firstMoneyAfter(text, labels, unitPattern = '(?:kwh|kw h|kilowatt[-\\s]?hour)') {
  const normalized = normalizeText(text);
  for (const label of labels) {
    const index = normalized.toLowerCase().indexOf(label.toLowerCase());
    if (index < 0) continue;
    const slice = normalized.slice(index, index + 700);
    const match = slice.match(new RegExp(`\\$\\s*([0-9]+(?:\\.[0-9]{1,3})?)\\s*(?:\\/|per)?\\s*${unitPattern}`, 'i')) || slice.match(/\$\s*([0-9]+(?:\.[0-9]{1,3})?)/i);
    const value = match ? parseDollarValue(match[1]) : null;
    if (value !== null) return { value, label, evidence: slice.slice(0, 300).replace(/\s+/g, ' ').trim(), lowPriceId: lowPriceId(value) };
  }
  return null;
}

export function inferPrices(text, html = '') {
  const normalized = normalizeText(`${text}\n${html}`);
  const candidates = extractPriceCandidates(normalized);
  const member = firstMoneyAfter(normalized, [
    'Pricing for Tesla & Members',
    'Pricing for Tesla and Members',
    'Tesla & Members',
    'Teslas and Members',
    'Tesla and Members',
    'Tesla/Member',
    'Members',
    'Tesla drivers',
    'Tesla vehicles'
  ]);
  const nonMember = firstMoneyAfter(normalized, [
    'Pricing for Non-Tesla',
    'Pricing for Non-Members',
    'Non-Tesla',
    'Non Tesla',
    'Non Members',
    'Non-Members',
    'Other EVs',
    'NACS partners'
  ]);
  const congestion = firstMoneyAfter(normalized, ['Congestion fees', 'Congestion fee'], '(?:min|minute)');
  const fallbackMember = !member ? bestCandidate(candidates, 'member') : null;
  const fallbackNonMember = !nonMember && /non[-\s]?tesla|non[-\s]?member|other ev|nacs partner/i.test(normalized)
    ? bestCandidate(candidates.filter(c => c.price !== (member?.value ?? null)), 'nonMember')
    : null;
  const memberEvidence = member || (fallbackMember ? { value: fallbackMember.price, label: 'best scored $/kWh candidate', evidence: fallbackMember.evidence, lowPriceId: fallbackMember.lowPriceId } : null);
  const nonMemberEvidence = nonMember || (fallbackNonMember ? { value: fallbackNonMember.price, label: 'best scored non-Tesla $/kWh candidate', evidence: fallbackNonMember.evidence, lowPriceId: fallbackNonMember.lowPriceId } : null);
  const bestObserved = [memberEvidence?.value, nonMemberEvidence?.value].filter(v => typeof v === 'number').sort((a, b) => a - b)[0] ?? null;

  return {
    memberPricePerKwh: memberEvidence?.value ?? null,
    nonMemberPricePerKwh: nonMemberEvidence?.value ?? null,
    congestionFeePerMinuteMax: congestion?.value ?? null,
    lowestObservedPricePerKwh: bestObserved,
    lowPriceId: lowPriceId(bestObserved),
    priceExtractionVersion: 'tesla-public-v3-site-diagnostics',
    priceCandidateCount: candidates.length,
    priceEvidence: { member: memberEvidence, nonMember: nonMemberEvidence, congestion, candidates: candidates.slice(0, 8) }
  };
}

export function inferAvailability(text, station = {}) {
  const normalized = normalizeText(text);
  const totalFromStation = typeof station.stalls === 'number' ? station.stalls : null;
  const ofTotalMatch = normalized.match(/(\d+)\s+(?:of|\/)\s+(\d+)\s+(?:stalls?|chargers?|posts?)\s+available/i)
    || normalized.match(/available\s+(?:stalls?|chargers?|posts?)\s*[:\-]?\s*(\d+)\s+(?:of|\/)\s+(\d+)/i);
  const availableOnlyMatch = normalized.match(/(\d+)\s+(?:stalls?|chargers?|posts?)\s+available/i)
    || normalized.match(/available\s+(?:stalls?|chargers?|posts?)\s*[:\-]?\s*(\d+)/i);
  const availableStalls = ofTotalMatch ? Number(ofTotalMatch[1]) : availableOnlyMatch ? Number(availableOnlyMatch[1]) : null;
  const totalStalls = ofTotalMatch ? Number(ofTotalMatch[2]) : totalFromStation;
  const utilizationPct = typeof availableStalls === 'number' && typeof totalStalls === 'number' && totalStalls > 0
    ? Number(((totalStalls - availableStalls) / totalStalls).toFixed(4))
    : null;
  const availabilityLabel = /temporarily\s+unavailable|out\s+of\s+service/i.test(normalized)
    ? 'unavailable'
    : /limited\s+(?:stalls?|chargers?|availability)/i.test(normalized)
      ? 'limited'
      : /full|no\s+(?:stalls?|chargers?)\s+available/i.test(normalized)
        ? 'full'
        : typeof availableStalls === 'number'
          ? 'available'
          : null;
  return { availableStalls, totalStalls, utilizationPct, availabilityLabel };
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function extractTitle(html) {
  const match = String(html || '').match(/<title[^>]*>(.*?)<\/title>/is);
  return match ? normalizeText(match[1]) : null;
}

function hasAny(text, patterns) {
  return patterns.some(pattern => pattern.test(text));
}

export function inferSiteDetails({ bodyText = '', html = '', station = {}, url = '', candidateReason = '' } = {}) {
  const normalized = normalizeText(`${bodyText}\n${html}`);
  const lower = normalized.toLowerCase();
  const amenities = unique([
    hasAny(lower, [/restroom/, /toilet/, /bathroom/]) ? 'Restrooms' : null,
    hasAny(lower, [/wifi|wi-fi/]) ? 'Wi-Fi' : null,
    hasAny(lower, [/restaurant|food|dining|cafe|coffee/]) ? 'Food nearby' : null,
    hasAny(lower, [/shopping|retail|mall|market|grocery/]) ? 'Shopping nearby' : null,
    hasAny(lower, [/lodging|hotel|inn|motel/]) ? 'Lodging nearby' : null,
    hasAny(lower, [/parking/]) ? 'Parking' : null,
    hasAny(lower, [/trailer/]) ? 'Trailer friendly' : null,
    hasAny(lower, [/accessible|accessibility|ada/]) ? 'Accessible stalls' : null
  ]);
  const accessMatch = normalized.match(/(?:Open|Available)\s+24\/7/i)
    || normalized.match(/24\s*(?:hours|hrs?)/i)
    || normalized.match(/(?:Access|Hours)\s*[:\-]?\s*([^.;|]{3,80})/i);
  const directionsMatch = normalized.match(/(?:Located|Find us|Directions?)\s*[:\-]?\s*([^.;|]{10,140})/i);
  const chargerGeneration = typeof station.maxKw === 'number'
    ? station.maxKw >= 320 ? 'V4 / high-power capable' : station.maxKw >= 250 ? 'V3 high-power' : station.maxKw >= 150 ? 'Urban / V2-era power' : 'Power unknown'
    : null;

  return {
    pageTitle: extractTitle(html),
    candidateReason: candidateReason || null,
    canonicalUrl: url || null,
    address: station.address || null,
    city: station.city || null,
    state: station.state || null,
    coordinates: typeof station.lat === 'number' && typeof station.lng === 'number' ? { lat: station.lat, lng: station.lng } : null,
    stalls: typeof station.stalls === 'number' ? station.stalls : null,
    maxKw: typeof station.maxKw === 'number' ? station.maxKw : null,
    estimatedSiteKw: typeof station.estimatedSiteKw === 'number' ? station.estimatedSiteKw : null,
    chargerGeneration,
    amenities,
    accessHint: accessMatch ? normalizeText(accessMatch[0]) : null,
    directionsHint: directionsMatch ? normalizeText(directionsMatch[1] || directionsMatch[0]) : null,
    pageTextLength: normalized.length,
    publicDetailsFound: amenities.length > 0 || Boolean(accessMatch)
  };
}

export function classifySiteContent({ bodyText = '', html = '', status = 0, finalUrl = '' } = {}) {
  const normalized = normalizeText(`${bodyText}\n${html}`);
  const pageNotFound = status === 404 || /page not found|404|not found/i.test(normalized);
  const blocked = status === 403 || /access denied|request blocked|captcha|verify you are human/i.test(normalized);
  const validTeslaLocation = !pageNotFound && /supercharger|findus|tesla/i.test(normalized + finalUrl);
  return {
    status,
    pageNotFound,
    blocked,
    validTeslaLocation,
    contentSignal: pageNotFound ? 'not_found' : blocked ? 'blocked' : validTeslaLocation ? 'tesla_location_page' : 'unknown'
  };
}
