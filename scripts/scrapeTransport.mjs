const TRANSIENT_STATUSES = new Set([408, 425, 500, 502, 503, 504]);

export function isTransientStatus(status) {
  return TRANSIENT_STATUSES.has(Number(status));
}

export function isAccessControlStatus(status) {
  return status === 403 || status === 429;
}

export function transportSignal(status) {
  if (status === 403) return 'blocked';
  if (status === 429) return 'rate_limited';
  if (status === 404 || status === 410) return 'not_found';
  if (isTransientStatus(status) || status === 0) return 'transient_failure';
  if (status >= 200 && status < 300) return 'success';
  return 'http_error';
}

export async function fetchHtmlWithRetry(url, {
  headers = {},
  fetchImpl = fetch,
  sleepImpl = ms => new Promise(resolve => setTimeout(resolve, ms)),
  timeoutMs = 18000,
  maxAttempts = 2,
  retryDelayMs = 750
} = {}) {
  let lastResult = null;
  const requestAttempts = [];

  for (let attempt = 1; attempt <= Math.max(1, maxAttempts); attempt++) {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, { headers, redirect: 'follow', signal: controller.signal });
      const retryAfter = response.headers?.get?.('retry-after') || null;
      const status = Number(response.status || 0);
      const result = {
        html: response.ok ? await response.text() : '',
        status,
        finalUrl: response.url || url,
        retryAfter,
        error: null,
        durationMs: Date.now() - startedAt
      };
      requestAttempts.push({ attempt, status, signal: transportSignal(status), durationMs: result.durationMs });
      lastResult = result;
      if (!isTransientStatus(status) || attempt >= maxAttempts) break;
    } catch (error) {
      const result = {
        html: '',
        status: 0,
        finalUrl: url,
        retryAfter: null,
        error: String(error?.name === 'AbortError' ? 'request_timeout' : error?.message || error),
        durationMs: Date.now() - startedAt
      };
      requestAttempts.push({ attempt, status: 0, signal: 'transient_failure', durationMs: result.durationMs, error: result.error });
      lastResult = result;
      if (attempt >= maxAttempts) break;
    } finally {
      clearTimeout(timer);
    }
    await sleepImpl(retryDelayMs * attempt);
  }

  return { ...lastResult, requestAttempts, retryCount: Math.max(0, requestAttempts.length - 1) };
}

export function summarizeTransport(attempts = []) {
  const rows = Array.isArray(attempts) ? attempts : [];
  const requestAttempts = rows.flatMap(attempt => attempt.requestAttempts || []);
  const durations = requestAttempts.map(attempt => Number(attempt.durationMs)).filter(Number.isFinite);
  return {
    candidateAttempts: rows.length,
    requestAttempts: requestAttempts.length,
    retries: rows.reduce((sum, attempt) => sum + Number(attempt.retryCount || 0), 0),
    averageRequestMs: durations.length ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length) : null
  };
}
