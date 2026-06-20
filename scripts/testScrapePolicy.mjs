import assert from 'node:assert/strict';
import { blockCooldownHours, isScrapeEligible, nextBlockedState, parseRetryAfterHours, successfulScrapeState } from './scrapePolicy.mjs';

assert.deepEqual([1, 2, 3, 4, 5, 6].map(blockCooldownHours), [6, 12, 24, 48, 72, 72]);
assert.equal(parseRetryAfterHours('7200', new Date('2026-06-20T00:00:00Z')), 2);
assert.equal(parseRetryAfterHours('Sat, 20 Jun 2026 06:00:00 GMT', new Date('2026-06-20T00:00:00Z')), 6);

const previous = {
  lastScrapedAt: '2026-06-19T12:00:00.000Z',
  lastScrapeHadPrice: true,
  consecutiveBlockedAttempts: 1
};
const blocked = nextBlockedState(previous, { attemptedAt: '2026-06-20T00:00:00.000Z' });
assert.equal(blocked.consecutiveBlockedAttempts, 2);
assert.equal(blocked.blockCooldownHours, 12);
assert.equal(blocked.nextScrapeEligibleAt, '2026-06-20T12:00:00.000Z');
assert.equal(previous.lastScrapedAt, '2026-06-19T12:00:00.000Z');
assert.equal(previous.lastScrapeHadPrice, true);
assert.equal(isScrapeEligible({ ...previous, ...blocked }, new Date('2026-06-20T06:00:00Z')), false);
assert.equal(isScrapeEligible({ ...previous, ...blocked }, new Date('2026-06-20T13:00:00Z')), true);

const success = successfulScrapeState('2026-06-20T13:00:00.000Z');
assert.equal(success.lastScrapeBlocked, false);
assert.equal(success.consecutiveBlockedAttempts, 0);
assert.equal(success.lastScrapedAt, success.lastSuccessfulScrapeAt);

console.log('Scrape block policy tests passed.');
