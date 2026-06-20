import assert from 'node:assert/strict';
import { fetchHtmlWithRetry, isAccessControlStatus, isTransientStatus, summarizeTransport, transportSignal } from './scrapeTransport.mjs';

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

console.log('Scrape transport tests passed.');
