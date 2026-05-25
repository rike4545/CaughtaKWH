import { chromium } from '@playwright/test';
import path from 'node:path';
import { dataDir, readJson, writeJson, parseMoney, nowIso, stationHistoryPath } from './lib.mjs';

const stations = await readJson(path.join(dataDir, 'stations.json'), []);
const MAX_STATIONS = Number(process.env.MAX_STATIONS || stations.length || 1);
const DELAY_MS = Number(process.env.SCRAPE_DELAY_MS || 1500);
const capturedAt = nowIso();

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function inferPrices(text) {
  const normalized = text.replace(/\s+/g, ' ');
  const memberMatch = normalized.match(/(?:Teslas and Members|Tesla(?:s)?\/Members|Members?)[:\s$]*\$?([0-9]+\.[0-9]{2})\s*\/\s*kWh/i);
  const nonMemberMatch = normalized.match(/(?:Non[-\s]?Members?|Pricing for Non[-\s]?Members?)[:\s$]*\$?([0-9]+\.[0-9]{2})\s*\/\s*kWh/i);
  const congestionMatch = normalized.match(/Congestion fees?[^$]*\$?([0-9]+\.[0-9]{2})\s*\/\s*min/i);
  return {
    memberPricePerKwh: memberMatch ? Number(memberMatch[1]) : null,
    nonMemberPricePerKwh: nonMemberMatch ? Number(nonMemberMatch[1]) : null,
    congestionFeePerMinuteMax: congestionMatch ? Number(congestionMatch[1]) : null
  };
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1400 } });

let saved = 0;
for (const station of stations.slice(0, MAX_STATIONS)) {
  const page = await context.newPage();
  try {
    await page.goto(station.url, { waitUntil: 'networkidle', timeout: 90000 });
    await page.waitForTimeout(2500);
    const bodyText = await page.locator('body').innerText({ timeout: 10000 });
    const prices = inferPrices(bodyText);

    const address = await page.locator('body').innerText().then(t => {
      const m = t.match(/([0-9][^\n]+(?:NY|CA|TX|FL|NJ|CT|PA|MA|VA|NC|SC|GA|WA|OR|AZ|NV|CO|UT|IL|OH|MI|MD|DE|RI|VT|NH|ME|TN|KY|IN|WI|MN|IA|MO|AR|LA|MS|AL|OK|KS|NE|SD|ND|MT|WY|ID|NM)\s+\d{5})/);
      return m?.[1] || station.address || null;
    }).catch(() => station.address || null);

    const observation = {
      stationId: station.id,
      capturedAt,
      localDate: new Date().toISOString().slice(0, 10),
      localHour: new Date().getHours(),
      ...prices,
      currency: 'USD',
      source: 'tesla_public_findus_location_page'
    };

    const hasPrice = observation.memberPricePerKwh !== null || observation.nonMemberPricePerKwh !== null;
    if (hasPrice) {
      const history = await readJson(stationHistoryPath(station.id), []);
      const key = `${observation.capturedAt}-${observation.memberPricePerKwh}-${observation.nonMemberPricePerKwh}`;
      const merged = [...history.filter(x => `${x.capturedAt}-${x.memberPricePerKwh}-${x.nonMemberPricePerKwh}` !== key), observation];
      await writeJson(stationHistoryPath(station.id), merged);
      saved++;
    }

    if (address && !station.address) station.address = address;
    station.lastScrapedAt = capturedAt;
    station.lastScrapeHadPrice = hasPrice;
  } catch (error) {
    station.lastScrapeError = String(error.message || error);
    station.lastScrapedAt = capturedAt;
  } finally {
    await page.close();
    await sleep(DELAY_MS);
  }
}

await browser.close();
await writeJson(path.join(dataDir, 'stations.json'), stations);
console.log(`Saved price observations for ${saved} station(s).`);
