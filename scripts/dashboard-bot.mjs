import fs from 'node:fs/promises';
import path from 'node:path';
import { dataDir, readJson, writeJson } from './lib.mjs';

const root = process.cwd();
const reportsDir = path.join(root, 'reports');
const historyDir = path.join(dataDir, 'history');

function pct(value, total) {
  return total ? Number((value / total * 100).toFixed(2)) : 0;
}

function hoursSince(iso) {
  if (!iso) return null;
  const hours = (Date.now() - new Date(iso).getTime()) / 36e5;
  return Number.isFinite(hours) ? Math.max(0, hours) : null;
}

function shortStation(station) {
  return {
    id: station.id,
    name: station.name || station.id,
    state: station.state || '',
    city: station.city || '',
    lastScrapedAt: station.lastScrapedAt || null,
    lastScrapeResult: station.lastScrapeResult || 'not_checked',
    priorityScore: Number(station.observationPriorityScore || 0)
  };
}

function stationWord(count) {
  return count === 1 ? 'station' : 'stations';
}

const stations = await readJson(path.join(dataDir, 'stations.json'), []);
const predictions = await readJson(path.join(dataDir, 'predictions.json'), []);
const priceChanges = await readJson(path.join(dataDir, 'price-changes.json'), []);
let historyFiles = [];
try {
  historyFiles = (await fs.readdir(historyDir)).filter(file => file.endsWith('.json'));
} catch {}

const now = new Date().toISOString();
const pricedStationIds = new Set(predictions.map(prediction => prediction.stationId));
const recentPredictionIds = new Set(predictions.filter(prediction => Number(prediction.latestObservationAgeHours) <= 24).map(prediction => prediction.stationId));
const usablePredictionIds = new Set(predictions.filter(prediction => Number(prediction.sampleCount || 0) >= 3 && Number(prediction.latestObservationAgeHours ?? Infinity) <= 48).map(prediction => prediction.stationId));
const strongPredictionIds = new Set(predictions.filter(prediction => Number(prediction.sampleCount || 0) >= 10 && Number(prediction.latestObservationAgeHours ?? Infinity) <= 24).map(prediction => prediction.stationId));
const checkedStations = stations.filter(station => station.lastScrapedAt);
const priceFound = stations.filter(station => station.lastScrapeHadPrice);
const availabilityOnly = stations.filter(station => station.lastScrapeHadAvailability && !station.lastScrapeHadPrice);
const staleOrUnchecked = stations.filter(station => !station.lastScrapedAt || (hoursSince(station.lastScrapedAt) ?? Infinity) > 72);
const withCoords = stations.filter(station => typeof station.lat === 'number' && typeof station.lng === 'number');
const withAddress = stations.filter(station => station.address);

const stateRows = [...new Set(stations.map(station => station.state).filter(Boolean))].sort().map(state => {
  const rows = stations.filter(station => station.state === state);
  const checked = rows.filter(station => station.lastScrapedAt).length;
  const priced = rows.filter(station => pricedStationIds.has(station.id)).length;
  const usable = rows.filter(station => usablePredictionIds.has(station.id)).length;
  const stale = rows.filter(station => !station.lastScrapedAt || (hoursSince(station.lastScrapedAt) ?? Infinity) > 72).length;
  const priorityScore = rows.reduce((sum, station) => sum + Number(station.observationPriorityScore || 0), 0);
  return { state, stations: rows.length, checked, priced, usable, stale, checkedPct: pct(checked, rows.length), pricedPct: pct(priced, rows.length), usablePct: pct(usable, rows.length), priorityScore: Number(priorityScore.toFixed(2)) };
});

const statePriorities = stateRows
  .filter(row => row.stale || row.pricedPct < 5)
  .sort((a, b) => b.stale - a.stale || b.priorityScore - a.priorityScore)
  .slice(0, 8);

const refreshTargets = stations
  .filter(station => !station.lastScrapeHadPrice || !usablePredictionIds.has(station.id) || (hoursSince(station.lastScrapedAt) ?? Infinity) > 48)
  .sort((a, b) => Number(b.observationPriorityScore || 0) - Number(a.observationPriorityScore || 0))
  .slice(0, 10)
  .map(shortStation);

const improvementQueue = [
  {
    title: 'Grow repeated observations',
    status: usablePredictionIds.size >= 25 ? 'in_progress' : 'needs_data',
    detail: `${usablePredictionIds.size} of ${stations.length} US ${stationWord(stations.length)} ${usablePredictionIds.size === 1 ? 'has' : 'have'} usable price history. A station becomes usable after at least 3 recent price observations.`
  },
  {
    title: 'Keep fresh data visible',
    status: recentPredictionIds.size ? 'active' : 'needs_data',
    detail: `${recentPredictionIds.size} ${stationWord(recentPredictionIds.size)} ${recentPredictionIds.size === 1 ? 'has' : 'have'} a price observation from the last 24 hours. Freshness should stay prominent so visitors know what is current.`
  },
  {
    title: 'Prioritize slow Tesla pages',
    status: staleOrUnchecked.length ? 'active' : 'healthy',
    detail: `${staleOrUnchecked.length} stations are unchecked or older than 72 hours. Refreshes should stay staggered by state because each Tesla candidate page needs render time.`
  },
  {
    title: 'Add local power context state by state',
    status: 'next',
    detail: 'New York has public commercial-rate context in the app. Add verified benchmarks only when the source and period are clear.'
  }
];

const health = {
  generatedAt: now,
  scope: 'United States Superchargers first',
  summary: {
    stationCount: stations.length,
    checkedStations: checkedStations.length,
    checkedPct: pct(checkedStations.length, stations.length),
    priceFoundStations: priceFound.length,
    priceFoundPct: pct(priceFound.length, stations.length),
    availabilityOnlyStations: availabilityOnly.length,
    pricedStations: pricedStationIds.size,
    pricedPct: pct(pricedStationIds.size, stations.length),
    usableHistoryStations: usablePredictionIds.size,
    usableHistoryPct: pct(usablePredictionIds.size, stations.length),
    strongHistoryStations: strongPredictionIds.size,
    strongHistoryPct: pct(strongPredictionIds.size, stations.length),
    freshPriceStations: recentPredictionIds.size,
    staleOrUncheckedStations: staleOrUnchecked.length,
    coordinatePct: pct(withCoords.length, stations.length),
    addressPct: pct(withAddress.length, stations.length),
    historyFiles: historyFiles.length,
    priceChangeEvents: priceChanges.length
  },
  statePriorities,
  refreshTargets,
  improvementQueue
};

await writeJson(path.join(dataDir, 'dashboard-health.json'), health);

const stateLines = statePriorities.length
  ? statePriorities.map(row => `- ${row.state}: ${row.stale} stale/unchecked, ${row.pricedPct}% priced`)
  : ['- No state-level refresh priority detected.'];
const targetLines = refreshTargets.length
  ? refreshTargets.slice(0, 5).map(station => `- ${station.name} (${station.id}) · ${station.lastScrapeResult}`)
  : ['- No station-specific refresh target detected.'];
const queueLines = improvementQueue.map(item => `- ${item.title}: ${item.detail}`);

const report = [
  '# Dashboard Improvement Bot',
  '',
  `Generated: ${now}`,
  '',
  '## Public Dashboard Health',
  '',
  `- Scope: ${health.scope}`,
  `- Stations: ${health.summary.stationCount}`,
  `- Checked by scraper: ${health.summary.checkedStations} (${health.summary.checkedPct}%)`,
  `- Stations with any price history: ${health.summary.pricedStations} (${health.summary.pricedPct}%)`,
  `- Stations with usable price history: ${health.summary.usableHistoryStations} (${health.summary.usableHistoryPct}%)`,
  `- Stations with strong price history: ${health.summary.strongHistoryStations} (${health.summary.strongHistoryPct}%)`,
  `- Fresh price stations: ${health.summary.freshPriceStations}`,
  `- Stale or unchecked stations: ${health.summary.staleOrUncheckedStations}`,
  '',
  '## State Refresh Priorities',
  '',
  ...stateLines,
  '',
  '## Station Refresh Targets',
  '',
  ...targetLines,
  '',
  '## Improvement Queue',
  '',
  ...queueLines,
  '',
  '## Automation',
  '',
  'The dashboard improvement workflow regenerates this report and `data/dashboard-health.json`, syncs public data, validates the site data, and commits any changed dashboard-health output.',
  ''
].join('\n');

await fs.mkdir(reportsDir, { recursive: true });
await fs.writeFile(path.join(reportsDir, 'dashboard-bot.md'), report);
console.log(report);
