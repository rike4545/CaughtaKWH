const CACHE_TTL_SECONDS = 10 * 60;

function json(status, body) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,OPTIONS',
      'access-control-allow-headers': 'content-type'
    }
  });
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

export default async function handler(request) {
  if (request.method === 'OPTIONS') return json(200, { ok: true });
  const url = new URL(request.url);
  const stationId = url.searchParams.get('id');
  const liveRequested = url.searchParams.get('live') === '1';
  if (!stationId) return json(400, { ok: false, error: 'Missing station id.' });

  const base = process.env.CAUGHTAKWH_DATA_BASE || 'https://rike4545.github.io/CaughtaKWH/data';
  const [predictions, history] = await Promise.allSettled([
    fetchJson(`${base}/predictions.json?t=${Date.now()}`),
    fetchJson(`${base}/history/${encodeURIComponent(stationId)}.json?t=${Date.now()}`)
  ]);

  const predictionRows = predictions.status === 'fulfilled' && Array.isArray(predictions.value) ? predictions.value : [];
  const historyRows = history.status === 'fulfilled' && Array.isArray(history.value) ? history.value : [];
  const latestHistory = historyRows
    .filter(row => row.memberPricePerKwh != null || row.nonMemberPricePerKwh != null)
    .sort((a, b) => new Date(b.capturedAt) - new Date(a.capturedAt))[0] || null;
  const memberPrediction = predictionRows.find(row => row.stationId === stationId && row.membershipType === 'member') || null;
  const latestObservedAt = latestHistory?.capturedAt || memberPrediction?.latestObservedAt || null;
  const ageSeconds = latestObservedAt ? Math.round((Date.now() - new Date(latestObservedAt).getTime()) / 1000) : null;

  return json(200, {
    ok: true,
    stationId,
    liveRequested,
    mode: liveRequested ? 'live-check-requested-served-from-cache' : 'last-known-plus-on-demand-api-scaffold',
    source: 'CaughtaKWH public dataset cache',
    currentTeslaPriceGuaranteed: false,
    note: liveRequested
      ? 'A live Tesla check must run server-side in a hidden/headless browser (the page is cross-origin and behind anti-bot protection, so it cannot be read from the visitor browser). Until a headless worker is wired up here, this returns the freshest CaughtaKWH observation instead of opening a window for the user.'
      : 'This endpoint returns the freshest CaughtaKWH observation available. A deployed worker/function can be extended to run a live Tesla page check on demand, but Tesla does not always expose public $/kWh pricing.',
    cachePolicy: {
      freshForSeconds: CACHE_TTL_SECONDS,
      stale: typeof ageSeconds === 'number' ? ageSeconds > CACHE_TTL_SECONDS : true
    },
    latestObservedAt,
    ageSeconds,
    memberPricePerKwh: latestHistory?.memberPricePerKwh ?? memberPrediction?.latestObservedPrice ?? null,
    nonMemberPricePerKwh: latestHistory?.nonMemberPricePerKwh ?? null,
    confidence: latestObservedAt ? (ageSeconds <= CACHE_TTL_SECONDS ? 'fresh' : ageSeconds <= 3600 ? 'recent' : 'stale') : 'none',
    historyCount: historyRows.length,
    prediction: memberPrediction
  });
}
