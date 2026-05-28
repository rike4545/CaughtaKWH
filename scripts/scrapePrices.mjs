import { chromium } from '@playwright/test';
import path from 'node:path';
import { dataDir, readJson, writeJson, nowIso, stationHistoryPath } from './lib.mjs';

const stations = await readJson(path.join(dataDir, 'stations.json'), []);
const predictions = await readJson(path.join(dataDir, 'predictions.json'), []);
const MAX_STATIONS = Number(process.env.MAX_STATIONS || stations.length || 1);
const DELAY_MS = Number(process.env.SCRAPE_DELAY_MS || 1200);
const capturedAt = nowIso();
const capturedDate = new Date(capturedAt);

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function halfHourSlot(date) { return date.getHours() * 2 + (date.getMinutes() >= 30 ? 1 : 0); }
function compact(value) { return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]/g, ''); }
function plausibleTeslaSlug(value) { return /[a-z]/i.test(String(value || '')) && /supercharger/i.test(String(value || '')); }
function hoursSince(iso) { return iso ? Math.max(0, (Date.now() - new Date(iso).getTime()) / 36e5) : Infinity; }
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
function firstMoneyAfter(text, labels) {
  for (const label of labels) {
    const index = text.toLowerCase().indexOf(label.toLowerCase());
    if (index < 0) continue;
    const slice = text.slice(index, index + 500);
    const match = slice.match(/\$\s*([0-9]+(?:\.[0-9]{1,2})?)\s*\/\s*(?:kwh|kw h|min)/i);
    if (match) return { value: Number(Number(match[1]).toFixed(2)), label, evidence: slice.slice(0, 240).replace(/\s+/g, ' ').trim() };
  }
  return null;
}
function inferPrices(text, html = '') {
  const normalized = `${text}\n${html}`.replace(/\s+/g, ' ');
  const lower = normalized.toLowerCase();
  const allKwh = [...normalized.matchAll(/\$\s*([0-9]+(?:\.[0-9]{1,2})?)\s*\/\s*(?:kwh|kw h)/ig)].map(m => Number(m[1]));
  const member = firstMoneyAfter(normalized, ['Pricing for Tesla & Members', 'Tesla & Members', 'Teslas and Members', 'Tesla and Members', 'Tesla/Member', 'Members']);
  const nonMember = firstMoneyAfter(normalized, ['Pricing for Non-Tesla', 'Pricing for Non-Members', 'Non-Tesla', 'Non Members', 'Non-Members']);
  const congestion = firstMoneyAfter(normalized, ['Congestion fees', 'Congestion fee']);
  const fallbackMember = !member && allKwh.length && /pricing|members|kwh/i.test(normalized) ? { value: allKwh[0], label: 'first $/kWh on page', evidence: 'Matched first visible $/kWh value on a pricing page.' } : null;
  const fallbackNonMember = !nonMember && allKwh.length > 1 && lower.includes('non-tesla') ? { value: allKwh[1], label: 'second $/kWh on non-Tesla page', evidence: 'Matched second visible $/kWh value near non-Tesla pricing text.' } : null;
  const memberEvidence = member || fallbackMember;
  const nonMemberEvidence = nonMember || fallbackNonMember;
  return { memberPricePerKwh: memberEvidence?.value ?? null, nonMemberPricePerKwh: nonMemberEvidence?.value ?? null, congestionFeePerMinuteMax: congestion?.value ?? null, priceEvidence: { member: memberEvidence, nonMember: nonMemberEvidence, congestion } };
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
      await page.waitForTimeout(3500);
      const bodyText = await page.locator('body').innerText({ timeout: 12000 });
      const html = await page.content().catch(() => '');
      const prices = inferPrices(bodyText, html);
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
  if (!Number.isFinite(scrapeAge)) score += 500;
  else score += Math.min(240, scrapeAge * 8);
  if (!Number.isFinite(observationAge)) score += 220;
  else score += Math.min(180, observationAge * 6);
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
const context = await browser.newContext({ viewport: { width: 1440, height: 1600 } });
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
console.log(`Attempted ${attempted}; saved price observations for ${saved} station(s). Dynamic priority sampling enabled.`);
