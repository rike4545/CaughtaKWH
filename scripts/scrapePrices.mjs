import { chromium } from '@playwright/test';
import path from 'node:path';
import { dataDir, readJson, writeJson, nowIso, stationHistoryPath } from './lib.mjs';

const stations = await readJson(path.join(dataDir, 'stations.json'), []);
const predictions = await readJson(path.join(dataDir, 'predictions.json'), []);
const MAX_STATIONS = Number(process.env.MAX_STATIONS || stations.length || 1);
const DELAY_MS = Number(process.env.SCRAPE_DELAY_MS || 1200);
const LOW_PRICE_THRESHOLD = Number(process.env.LOW_PRICE_THRESHOLD || 0.30);
const capturedAt = nowIso();
const capturedDate = new Date(capturedAt);

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function halfHourSlot(date) { return date.getHours() * 2 + (date.getMinutes() >= 30 ? 1 : 0); }
function compact(value) { return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]/g, ''); }
function plausibleTeslaSlug(value) { return /[a-z]/i.test(String(value || '')) && /supercharger/i.test(String(value || '')); }
function hoursSince(iso) { return iso ? Math.max(0, (Date.now() - new Date(iso).getTime()) / 36e5) : Infinity; }
function lowPriceId(price) { return typeof price === 'number' && price < LOW_PRICE_THRESHOLD ? 'low_under_030_kwh' : null; }
function stationCandidates(station) {
  const urls = [];
  if (station.url && String(station.url).includes('tesla.com/findus/location/supercharger/') && plausibleTeslaSlug(station.url)) urls.push(station.url);
  const city = compact(station.city || '').replace(/^The/i, '');
  const state = compact(station.state || '');
  const name = compact(String(station.name || '').replace(/\[.*?\]/g, '').replace(/supercharger/i, ''));
  const ids = [station.id, `${city}${state}supercharger`, `${name}${state}supercharger`, `${name}supercharger`].filter(Boolean).filter(plausibleTeslaSlug);
  for (const id of ids) urls.push(`https://www.tesla.com/findus/location/supercharger/${id}`);
  return [...new Set(urls)].slice(0, 4);
}
function normalizeText(text) {
  return String(text || '')
    .replace(/\u00a0/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}
function parseDollarValue(value) {
  const parsed = Number(String(value).replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(parsed)) return null;
  if (parsed <= 0 || parsed > 2.5) return null;
  return Number(parsed.toFixed(2));
}
function extractPriceCandidates(text) {
  const normalized = normalizeText(text);
  const candidates = [];
  const patterns = [
    /(?:\$\s*([0-9]+(?:\.[0-9]{1,3})?)\s*(?:\/|per)?\s*(?:kwh|kw\s*h|kilowatt[-\s]?hour))/ig,
    /(?:([0-9]+(?:\.[0-9]{1,3})?)\s*(?:usd|dollars?)?\s*(?:\/|per)\s*(?:kwh|kw\s*h|kilowatt[-\s]?hour))/ig,
    /(?:(?:kwh|kw\s*h|kilowatt[-\s]?hour)[^$0-9]{0,40}\$\s*([0-9]+(?:\.[0-9]{1,3})?))/ig,
    /(?:price[^$0-9]{0,40}\$\s*([0-9]+(?:\.[0-9]{1,3})?))/ig
  ];
  for (const pattern of patterns) {
    for (const match of normalized.matchAll(pattern)) {
      const price = parseDollarValue(match[1]);
      if (price === null) continue;
      const index = match.index ?? 0;
      const window = normalized.slice(Math.max(0, index - 180), Math.min(normalized.length, index + 280));
      candidates.push({ price, index, evidence: window, lowPriceId: lowPriceId(price) });
    }
  }
  const deduped = [];
  const seen = new Set();
  for (const c of candidates) {
    const key = `${c.price}-${Math.floor(c.index / 80)}`;
    if (!seen.has(key)) { seen.add(key); deduped.push(c); }
  }
  return deduped;
}
function scoreCandidate(candidate, role) {
  const e = candidate.evidence.toLowerCase();
  let score = 0;
  if (/pricing|price|rate|cost/.test(e)) score += 20;
  if (/kwh|kw h|kilowatt/.test(e)) score += 25;
  if (/supercharg/.test(e)) score += 8;
  if (/member|tesla/.test(e)) score += role === 'member' ? 22 : 4;
  if (/non[-\s]?tesla|non[-\s]?member|other ev|third[-\s]?party/.test(e)) score += role === 'nonMember' ? 25 : -12;
  if (/idle|parking|minute|min|congestion/.test(e)) score -= role === 'congestion' ? -15 : 30;
  if (candidate.price < 0.08) score -= 20;
  if (candidate.price > 1.25) score -= 15;
  return score;
}
function bestCandidate(candidates, role) {
  if (!candidates.length) return null;
  return [...candidates].sort((a, b) => scoreCandidate(b, role) - scoreCandidate(a, role))[0];
}
function firstMoneyAfter(text, labels, unitPattern = '(?:kwh|kw h|min|minute)') {
  const normalized = normalizeText(text);
  for (const label of labels) {
    const index = normalized.toLowerCase().indexOf(label.toLowerCase());
    if (index < 0) continue;
    const slice = normalized.slice(index, index + 650);
    const match = slice.match(new RegExp(`\\$\\s*([0-9]+(?:\\.[0-9]{1,3})?)\\s*(?:\\/|per)?\\s*${unitPattern}`, 'i')) || slice.match(/\$\s*([0-9]+(?:\.[0-9]{1,3})?)/i);
    const value = match ? parseDollarValue(match[1]) : null;
    if (value !== null) return { value, label, evidence: slice.slice(0, 280).replace(/\s+/g, ' ').trim(), lowPriceId: lowPriceId(value) };
  }
  return null;
}
function inferPrices(text, html = '') {
  const normalized = normalizeText(`${text}\n${html.replace(/<[^>]+>/g, ' ')}`);
  const candidates = extractPriceCandidates(normalized);
  const member = firstMoneyAfter(normalized, ['Pricing for Tesla & Members', 'Tesla & Members', 'Teslas and Members', 'Tesla and Members', 'Tesla/Member', 'Members', 'Tesla drivers', 'Tesla vehicles']);
  const nonMember = firstMoneyAfter(normalized, ['Pricing for Non-Tesla', 'Pricing for Non-Members', 'Non-Tesla', 'Non Members', 'Non-Members', 'Other EVs', 'NACS partners']);
  const congestion = firstMoneyAfter(normalized, ['Congestion fees', 'Congestion fee'], '(?:min|minute)');
  const fallbackMember = !member ? bestCandidate(candidates, 'member') : null;
  const fallbackNonMember = !nonMember && /non[-\s]?tesla|non[-\s]?member|other ev/i.test(normalized) ? bestCandidate(candidates.filter(c => c.price !== (member?.value ?? null)), 'nonMember') : null;
  const memberEvidence = member || (fallbackMember ? { value: fallbackMember.price, label: 'best scored $/kWh candidate', evidence: fallbackMember.evidence, lowPriceId: fallbackMember.lowPriceId } : null);
  const nonMemberEvidence = nonMember || (fallbackNonMember ? { value: fallbackNonMember.price, label: 'best scored non-Tesla $/kWh candidate', evidence: fallbackNonMember.evidence, lowPriceId: fallbackNonMember.lowPriceId } : null);
  const bestObserved = [memberEvidence?.value, nonMemberEvidence?.value].filter(v => typeof v === 'number').sort((a, b) => a - b)[0] ?? null;
  return {
    memberPricePerKwh: memberEvidence?.value ?? null,
    nonMemberPricePerKwh: nonMemberEvidence?.value ?? null,
    congestionFeePerMinuteMax: congestion?.value ?? null,
    lowestObservedPricePerKwh: bestObserved,
    lowPriceId: lowPriceId(bestObserved),
    priceExtractionVersion: 'tesla-public-v2-hardened',
    priceCandidateCount: candidates.length,
    priceEvidence: { member: memberEvidence, nonMember: nonMemberEvidence, congestion, candidates: candidates.slice(0, 8) }
  };
}
function inferAvailability(text, station) {
  const normalized = text.replace(/\s+/g, ' ');
  const totalFromStation = typeof station.stalls === 'number' ? station.stalls : null;
  const ofTotalMatch = normalized.match(/(\d+)\s+(?:of|\/)\s+(\d+)\s+(?:stalls?|chargers?|posts?)\s+available/i);
  const availableOnlyMatch = normalized.match(/(\d+)\s+(?:stalls?|chargers?|posts?)\s+available/i);
  const availableStalls = ofTotalMatch ? Number(ofTotalMatch[1]) : availableOnlyMatch ? Number(availableOnlyMatch[1]) : null;
  const totalStalls = ofTotalMatch ? Number(ofTotalMatch[2]) : totalFromStation;
  const utilizationPct = typeof availableStalls === 'number' && typeof totalStalls === 'number' && totalStalls > 0 ? Number(((totalStalls - availableStalls) / totalStalls).toFixed(4)) : null;
  const availabilityLabel = /limited\s+(?:stalls?|chargers?|availability)/i.test(normalized) ? 'limited' : /full|no\s+(?:stalls?|chargers?)\s+available/i.test(normalized) ? 'full' : typeof availableStalls === 'number' ? 'available' : null;
  return { availableStalls, totalStalls, utilizationPct, availabilityLabel };
}
async function scrapeOne(context, station) {
  const candidates = stationCandidates(station);
  let lastError = null;
  for (const url of candidates) {
    const page = await context.newPage();
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(5500);
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
      await page.waitForTimeout(1200);
      const bodyText = await page.locator('body').innerText({ timeout: 12000 });
      const html = await page.content().catch(() => '');
      const scriptsText = await page.locator('script').evaluateAll(nodes => nodes.map(n => n.textContent || '').join('\n')).catch(() => '');
      const prices = inferPrices(`${bodyText}\n${scriptsText}`, html);
      const availability = inferAvailability(bodyText, station);
      const hasPrice = prices.memberPricePerKwh !== null || prices.nonMemberPricePerKwh !== null;
      const titleLooksValid = /supercharger|pricing|tesla/i.test(bodyText) && !/page not found|404/i.test(bodyText);
      if (hasPrice || titleLooksValid) return { url, prices, availability, bodyText, hasPrice };
    } catch (error) {
      lastError = error;
    } finally {
      await page.close();
    }
  }
  throw lastError || new Error('No usable Tesla location candidate');
}
function priorityFor(station) {
  const prediction = predictions.find(p => p.stationId === station.id && p.membershipType === 'member') || predictions.find(p => p.stationId === station.id);
  const scrapeAge = hoursSince(station.lastScrapedAt);
  const observationAge = hoursSince(prediction?.latestObservedAt);
  const volatility = Number(prediction?.volatility || 0);
  const samples = Number(prediction?.sampleCount || 0);
  let score = 0;
  if (!Number.isFinite(scrapeAge)) score += 500; else score += Math.min(240, scrapeAge * 8);
  if (!Number.isFinite(observationAge)) score += 220; else score += Math.min(180, observationAge * 6);
  if (!station.lastScrapeHadPrice) score += 80;
  if (station.lastScrapeHadAvailability && !station.lastScrapeHadPrice) score += 45;
  if (station.url) score += 35;
  if (typeof station.stalls === 'number') score += Math.min(40, station.stalls);
  if (typeof station.maxKw === 'number' && station.maxKw >= 250) score += 25;
  if (volatility >= 0.08) score += 90; else if (volatility >= 0.04) score += 45;
  if (samples < 3) score += 80; else if (samples < 10) score += 35;
  if (['CA', 'NY', 'FL', 'TX', 'NJ', 'WA', 'MA'].includes(station.state)) score += 12;
  return Number(score.toFixed(2));
}

const ordered = [...stations].map(station => ({ station, priorityScore: priorityFor(station) })).sort((a, b) => b.priorityScore - a.priorityScore).map(item => item.station);
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1800 }, userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36' });
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
    station.observationPriorityScore = priorityFor(station);
    delete station.lastScrapeError;
  } catch (error) {
    station.lastScrapeError = String(error.message || error);
    station.lastScrapedAt = capturedAt;
    station.lastScrapeHadPrice = false;
    station.lastScrapeHadAvailability = false;
    station.observationPriorityScore = priorityFor(station);
  } finally {
    await sleep(DELAY_MS);
  }
}
await browser.close();
await writeJson(path.join(dataDir, 'stations.json'), stations);
console.log(`Attempted ${attempted}; saved price observations for ${saved} station(s). Hardened extraction v2 enabled. Low price threshold: $${LOW_PRICE_THRESHOLD}/kWh.`);
