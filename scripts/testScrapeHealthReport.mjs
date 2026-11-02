import assert from 'node:assert/strict';
import { summarizeScrapeHealth } from './scrapeHealthSummary.mjs';

const cooldown = summarizeScrapeHealth({ inScopeStations: 10, attempted: 0, cooldownSkipped: 10 });
assert.equal(cooldown.status, 'cooldown');
assert.match(cooldown.title, /cooling down/);
assert.match(cooldown.annotation, /No network requests/);

const blocked = summarizeScrapeHealth({ inScopeStations: 10, attempted: 10, validPages: 0, savedObservations: 0, blocked: 10 });
assert.equal(blocked.status, 'blocked');
assert.match(blocked.annotation, /Tesla\/Akamai blocked/);

const captured = summarizeScrapeHealth({ inScopeStations: 10, attempted: 10, validPages: 10, savedObservations: 3 });
assert.equal(captured.status, 'captured');
assert.equal(captured.annotation, null);

const checked = summarizeScrapeHealth({ inScopeStations: 4, attempted: 4, validPages: 4, savedObservations: 0 });
assert.equal(checked.status, 'no-price');

console.log('Scrape health reporting tests passed.');
