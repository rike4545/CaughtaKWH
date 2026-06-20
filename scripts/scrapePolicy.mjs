const HOUR_MS = 36e5;

export function blockCooldownHours(consecutiveBlocks, { baseHours = 6, maxHours = 72 } = {}) {
  const count = Math.max(1, Number(consecutiveBlocks || 1));
  return Math.min(maxHours, baseHours * 2 ** (count - 1));
}

export function parseRetryAfterHours(value, now = new Date()) {
  if (value == null || value === '') return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds / 3600);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return Math.max(0, (date.getTime() - now.getTime()) / HOUR_MS);
}

export function nextBlockedState(station, { attemptedAt, retryAfter = null, baseHours = 6, maxHours = 72 } = {}) {
  const at = new Date(attemptedAt || Date.now());
  const consecutiveBlockedAttempts = Math.max(0, Number(station?.consecutiveBlockedAttempts || 0)) + 1;
  const exponentialHours = blockCooldownHours(consecutiveBlockedAttempts, { baseHours, maxHours });
  const retryAfterHours = parseRetryAfterHours(retryAfter, at);
  const cooldownHours = Math.min(maxHours, Math.max(exponentialHours, retryAfterHours || 0));
  return {
    lastAttemptedAt: at.toISOString(),
    lastBlockedAt: at.toISOString(),
    lastScrapeBlocked: true,
    consecutiveBlockedAttempts,
    blockCooldownHours: Number(cooldownHours.toFixed(2)),
    nextScrapeEligibleAt: new Date(at.getTime() + cooldownHours * HOUR_MS).toISOString()
  };
}

export function successfulScrapeState(attemptedAt) {
  const at = new Date(attemptedAt || Date.now()).toISOString();
  return {
    lastAttemptedAt: at,
    lastScrapedAt: at,
    lastSuccessfulScrapeAt: at,
    lastScrapeBlocked: false,
    consecutiveBlockedAttempts: 0,
    blockCooldownHours: 0,
    nextScrapeEligibleAt: null
  };
}

export function isScrapeEligible(station, now = new Date()) {
  if (!station?.nextScrapeEligibleAt) return true;
  const eligibleAt = new Date(station.nextScrapeEligibleAt);
  if (Number.isNaN(eligibleAt.getTime())) return true;
  return eligibleAt <= now;
}
