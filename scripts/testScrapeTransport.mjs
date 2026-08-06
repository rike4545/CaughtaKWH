import assert from 'node:assert/strict';
import { classifyFetchBlock, fetchHtmlWithRetry, isAccessControlStatus, isTransientStatus, summarizeTransport, transportSignal } from './scrapeTransport.mjs';

assert.equal(isAccessControlStatus(403), true);
assert.equal(isAccessControlStatus(429), true);
assert.equal(isAccessControlStatus(500), false);
assert.equal(isTransientStatus(503), true);
assert.equal(transportSignal(404), 'not_found');
assert.equal(transportSignal(429), 'rate_limited');

const response = (status, body = '', headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  url: 'https://www.tesla.com/findus/location/supercharger/test',
  headers: { get: name => headers[name.toLowerCase()] || null },
  text: async () => body
});

let calls = 0;
const recovered = await fetchHtmlWithRetry('https://example.test', {
  fetchImpl: async () => (++calls === 1 ? response(503) : response(200, '<html>Tesla Supercharger</html>')),
  sleepImpl: async () => {},
  maxAttempts: 2
});
assert.equal(calls, 2);
assert.equal(recovered.status, 200);
assert.equal(recovered.retryCount, 1);

calls = 0;
const blocked = await fetchHtmlWithRetry('https://example.test', {
  fetchImpl: async () => { calls++; return response(403); },
  sleepImpl: async () => {},
  maxAttempts: 2
});
assert.equal(calls, 1, 'Access controls must not be retried immediately');
assert.equal(blocked.retryCount, 0);

const summary = summarizeTransport([{ retryCount: 1, requestAttempts: [{ durationMs: 100 }, { durationMs: 300 }] }]);
assert.deepEqual(summary, { candidateAttempts: 1, requestAttempts: 2, retries: 1, averageRequestMs: 200 });

// A 403 is a JS challenge the browser path exists to solve, so it must escalate rather than
// abandon the station -- this is the whole point of keeping a Playwright fallback around.
const challenged = classifyFetchBlock({ status: 403 });
assert.equal(challenged.blocked, true);
assert.equal(challenged.escalateToBrowser, true);
assert.equal(challenged.outcomeMessage, 'tesla_access_controlled');

// Akamai also serves its interstitial with a 200, caught by content classification instead.
assert.equal(classifyFetchBlock({ blocked: true, status: 200 }).escalateToBrowser, true);

// A rate limit has nothing to solve; hammering it with a browser is worse than stopping.
const limited = classifyFetchBlock({ status: 429 });
assert.equal(limited.rateLimited, true);
assert.equal(limited.escalateToBrowser, false, 'A 429 must never escalate to the browser');
assert.equal(limited.outcomeMessage, 'tesla_rate_limited');
assert.equal(classifyFetchBlock({ blocked: true, rateLimited: true, status: 200 }).escalateToBrowser, false);

// The kill switch restores the old abandon-on-block behaviour.
assert.equal(classifyFetchBlock({ status: 403, browserRetryEnabled: false }).escalateToBrowser, false);

// A healthy response is not a block and must not trigger any of this.
const fine = classifyFetchBlock({ status: 200 });
assert.equal(fine.blocked, false);
assert.equal(fine.escalateToBrowser, false);
assert.equal(classifyFetchBlock({ status: 503 }).escalateToBrowser, false, 'Transient errors are not challenges');
assert.equal(classifyFetchBlock().blocked, false, 'Defaults must be inert');

console.log('Scrape transport tests passed.');
