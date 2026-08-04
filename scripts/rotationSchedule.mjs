// Prints which states the scheduled scraper rotates through, today and upcoming.
//
// Mirrors the rotation in scripts/scrapePrices.mjs (rotatedStatesForToday + dayOfYear):
// the window is SCRAPE_ROTATION_COUNT wide and slides one state/day through the alphabetical
// list of distinct states in data/stations.json, using day-of-year in UTC. This is a read-only
// display helper — the scraper remains the source of truth.
//
// Usage: node scripts/rotationSchedule.mjs [days] [rotationCount]
//   days           how many days to list (default 7)
//   rotationCount  override states/day (default: read from price-refresh.yml, else 8)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const stations = JSON.parse(fs.readFileSync(path.join(root, 'data', 'stations.json'), 'utf8'));

// Read the live SCRAPE_ROTATION_COUNT from the workflow so this stays honest if it changes.
function rotationCountFromWorkflow() {
  try {
    const yml = fs.readFileSync(path.join(root, '.github', 'workflows', 'price-refresh.yml'), 'utf8');
    const match = yml.match(/^\s*SCRAPE_ROTATION_COUNT:\s*(\d+)/m);
    return match ? Number(match[1]) : null;
  } catch { return null; }
}

const days = Math.max(1, Number(process.argv[2]) || 7);
const rotationCount = Math.max(1, Number(process.argv[3]) || rotationCountFromWorkflow() || 8);

const dayOfYear = date => {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const today = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return Math.floor((today - start) / 86400000);
};

const states = [...new Set(stations.map(s => s.state).filter(Boolean).map(String))].sort((a, b) => a.localeCompare(b));
const N = states.length;
const forDate = date => {
  const start = dayOfYear(date) % N;
  return Array.from({ length: Math.min(rotationCount, N) }, (_, o) => states[(start + o) % N]);
};

const now = new Date();
console.log(`Scrape rotation — ${rotationCount} states/day over ${N} regions (${days}-day view)`);
console.log(`Sweep period is fixed at ${N} days; each state gets a ${rotationCount}-day coverage burst per cycle.\n`);
for (let i = 0; i < days; i++) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + i));
  const iso = d.toISOString().slice(0, 10);
  const dow = d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
  const marker = i === 0 ? '  <- today' : '';
  console.log(`  ${iso} (${dow}): ${forDate(d).join(', ')}${marker}`);
}
