import { chromium } from '@playwright/test';
import path from 'node:path';
import { dataDir, readJson, writeJson, dedupeBy, nowIso } from './lib.mjs';

const LIST_URL = process.env.TESLA_SUPERCHARGER_LIST_URL || 'https://www.tesla.com/findus/list/superchargers/United%20States';
const MAX_STATIONS = Number(process.env.MAX_STATIONS || 2500);

function stationIdFromHref(href) {
  const m = href.match(/\/findus\/location\/supercharger\/([^?#/]+)/);
  return m?.[1] || null;
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ userAgent: 'CaughtaKWH research bot; public Tesla pages only; contact repo owner' });
await page.goto(LIST_URL, { waitUntil: 'networkidle', timeout: 90000 });
await page.waitForTimeout(2500);

const links = await page.$$eval('a[href*="/findus/location/supercharger/"]', anchors =>
  anchors.map(a => ({ href: a.href, text: a.textContent?.replace(/\s+/g, ' ').trim() || '' }))
);
await browser.close();

const existing = await readJson(path.join(dataDir, 'stations.json'), []);
const discovered = links.map(({ href, text }) => {
  const id = stationIdFromHref(href);
  if (!id) return null;
  const name = text || id.replace(/supercharger$/i, ' Supercharger');
  return {
    id,
    name,
    country: 'United States',
    url: `https://www.tesla.com/findus/location/supercharger/${id}`,
    source: 'tesla_public_findus_list',
    lastDiscoveredAt: nowIso()
  };
}).filter(Boolean).slice(0, MAX_STATIONS);

const merged = dedupeBy([...existing, ...discovered], x => x.id).sort((a, b) => a.name.localeCompare(b.name));
await writeJson(path.join(dataDir, 'stations.json'), merged);
console.log(`Discovered ${discovered.length}; stored ${merged.length} stations.`);
