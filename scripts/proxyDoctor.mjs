// Proxy doctor — does your egress actually get past Tesla's Akamai?
//
// `checkProxy` in proxyPool.mjs only proves a proxy forwards a request to a neutral endpoint
// (ipify). That is necessary but not sufficient: Akamai Bot Manager blocks by IP reputation, so
// a proxy can connect fine and still be denied on every tesla.com page. Setting the SCRAPE_PROXY
// secret and hoping meant digging through buried scrape logs to find out whether it worked.
//
// This diagnostic closes that gap. For every configured proxy candidate (and, for contrast, the
// direct GitHub-Actions egress), it:
//   1. Confirms connectivity and reports the egress IP (checkProxy + ipify).
//   2. Fetches a sample of REAL Supercharger pages through it and classifies each result with the
//      same classifier the scraper uses — usable Tesla page / Akamai-blocked / rate-limited.
//   3. Prints a plain PASS/FAIL table and a verdict.
//
// Exit code: non-zero when proxies are configured but none returns a usable Tesla page, so the
// one-click workflow surfaces a red X the moment a proxy can't beat Akamai. When no proxy is
// configured it exits 0 (informational) after showing that direct egress is blocked — which is
// exactly why a residential proxy is needed.
//
// Run: `npm run scrape:proxy-test`  (env: PROXY_TEST_SAMPLE, PROXY_TEST_DELAY_MS,
// PROXY_TEST_INCLUDE_DIRECT, SCRAPE_PROXY[_LIST|_LIST_URL], SCRAPE_PROXY_USERNAME/PASSWORD)

import path from 'node:path';
import { ProxyAgent } from 'undici';
import { dataDir, readJson } from './lib.mjs';
import { gatherProxyCandidates, parseProxy, checkProxy } from './proxyPool.mjs';
import { classifySiteContent, extractNextData, sleep } from './teslaSiteParser.mjs';

const FETCH_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36';
const FETCH_HEADERS = {
  'User-Agent': FETCH_UA,
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Cache-Control': 'max-age=0',
  'Upgrade-Insecure-Requests': '1',
};

const SAMPLE_SIZE = Math.max(1, Number(process.env.PROXY_TEST_SAMPLE || 6));
const DELAY_MS = Math.max(0, Number(process.env.PROXY_TEST_DELAY_MS || 1500));
const FETCH_TIMEOUT_MS = Math.max(3000, Number(process.env.PROXY_TEST_TIMEOUT_MS || 20000));
const INCLUDE_DIRECT = !['0', 'false', 'no'].includes(String(process.env.PROXY_TEST_INCLUDE_DIRECT ?? 'true').toLowerCase());
const CHECK_URL = String(process.env.SCRAPE_PROXY_CHECK_URL || 'https://api.ipify.org').trim();
const PROXY_USERNAME = String(process.env.SCRAPE_PROXY_USERNAME || '').trim();
const PROXY_PASSWORD = String(process.env.SCRAPE_PROXY_PASSWORD || '').trim();

// Pick a spread of real Supercharger URLs to probe. Prefer stations that returned a price last
// run, so a genuinely unblocked fetch should also yield __NEXT_DATA__ pricing (proving the whole
// path, not just that Akamai let an empty shell through). Top up with any URL'd station.
function sampleStations(stations) {
  const withUrl = stations.filter(s => s.url && String(s.url).includes('/findus/location/supercharger/'));
  const priced = withUrl.filter(s => s.lastScrapeHadPrice);
  const rest = withUrl.filter(s => !s.lastScrapeHadPrice);
  const picked = [];
  const seen = new Set();
  for (const list of [priced, rest]) {
    // Even stride so we spread across the list rather than clustering alphabetically.
    const stride = Math.max(1, Math.floor(list.length / SAMPLE_SIZE));
    for (let i = 0; i < list.length && picked.length < SAMPLE_SIZE; i += stride) {
      const s = list[i];
      if (seen.has(s.url)) continue;
      seen.add(s.url);
      picked.push(s);
    }
    if (picked.length >= SAMPLE_SIZE) break;
  }
  return picked.slice(0, SAMPLE_SIZE);
}

async function fetchThrough(url, dispatcher) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: FETCH_HEADERS,
      redirect: 'follow',
      signal: controller.signal,
      ...(dispatcher ? { dispatcher } : {})
    });
    const status = Number(response.status || 0);
    const html = response.ok ? await response.text() : '';
    return { status, html, finalUrl: response.url || url, error: null };
  } catch (error) {
    return { status: 0, html: '', finalUrl: url, error: String(error?.name === 'AbortError' ? 'timeout' : error?.message || error) };
  } finally {
    clearTimeout(timer);
  }
}

async function egressIp(dispatcher) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(CHECK_URL, {
      headers: { 'User-Agent': FETCH_UA },
      signal: controller.signal,
      ...(dispatcher ? { dispatcher } : {})
    });
    if (!response.ok) return null;
    return (await response.text()).trim().slice(0, 45) || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Probe one egress route (a parsed proxy, or null for direct) against the sample URLs.
async function probeRoute({ label, parsed }, stations) {
  const dispatcher = parsed ? new ProxyAgent(parsed.dispatcherUrl) : null;
  const tally = { usable: 0, priced: 0, blocked: 0, rateLimited: 0, notFound: 0, error: 0, other: 0 };
  let connected = true;
  let ip = null;

  try {
    if (parsed) {
      connected = await checkProxy(parsed, { url: CHECK_URL, timeoutMs: 8000 });
      if (!connected) {
        return { label, connected: false, ip: null, tally, verdict: 'DEAD', total: 0 };
      }
    }
    ip = await egressIp(dispatcher);

    for (const station of stations) {
      const { status, html, finalUrl, error } = await fetchThrough(station.url, dispatcher);
      if (error) { tally.error++; }
      else {
        const site = classifySiteContent({ html, status, finalUrl });
        if (site.blocked && site.rateLimited) tally.rateLimited++;
        else if (site.blocked) tally.blocked++;
        else if (site.pageNotFound) tally.notFound++;
        else if (site.validTeslaLocation || site.hasRealContent) {
          tally.usable++;
          if (extractNextData(html)) tally.priced++;
        } else tally.other++;
      }
      if (DELAY_MS) await sleep(DELAY_MS);
    }
  } finally {
    try { await dispatcher?.close(); } catch { /* ignore */ }
  }

  const total = stations.length;
  const verdict = tally.usable > 0 ? 'PASS' : (tally.blocked + tally.rateLimited) > 0 ? 'BLOCKED' : 'FAIL';
  return { label, connected, ip, tally, verdict, total };
}

function pct(n, total) {
  return total > 0 ? `${Math.round((n / total) * 100)}%` : '—';
}

function printReport(results) {
  console.log('\n================ Proxy Doctor ================');
  for (const r of results) {
    console.log(`\n• ${r.label}`);
    if (!r.connected) {
      console.log('    connectivity : DEAD (proxy did not forward a request) — skipped Tesla probes');
      continue;
    }
    console.log(`    egress IP    : ${r.ip || 'unknown'}`);
    console.log(`    Tesla probes : ${r.total}  →  usable ${r.tally.usable} (${pct(r.tally.usable, r.total)}), ` +
      `priced ${r.tally.priced}, blocked ${r.tally.blocked}, rate-limited ${r.tally.rateLimited}, ` +
      `not-found ${r.tally.notFound}, error ${r.tally.error}, other ${r.tally.other}`);
    console.log(`    verdict      : ${r.verdict}` +
      (r.verdict === 'PASS' ? '  ✅ gets past Akamai'
        : r.verdict === 'BLOCKED' ? '  ⛔ Akamai is denying this IP'
        : '  ⚠️  no usable Tesla pages'));
  }
  console.log('\n=============================================');
}

const stations = await readJson(path.join(dataDir, 'stations.json'), []);
const sample = sampleStations(stations);
if (!sample.length) {
  console.error('No Supercharger station URLs available to probe. Run `npm run discover` first.');
  process.exit(1);
}

const rawCandidates = await gatherProxyCandidates(process.env);
const parsedProxies = rawCandidates
  .map(raw => parseProxy(raw, { username: PROXY_USERNAME, password: PROXY_PASSWORD }))
  .filter(Boolean);

console.log(`Probing ${sample.length} Supercharger page(s) per route (delay ${DELAY_MS}ms).`);
console.log(`Configured proxy candidates: ${parsedProxies.length}` + (parsedProxies.length ? ` (${parsedProxies.map(p => p.host).join(', ')})` : ''));

const routes = parsedProxies.map((parsed, i) => ({ label: `proxy #${i + 1} — ${parsed.host}`, parsed }));
if (INCLUDE_DIRECT || !routes.length) {
  routes.push({ label: 'direct (no proxy — GitHub Actions egress)', parsed: null });
}

const results = [];
for (const route of routes) {
  results.push(await probeRoute(route, sample));
}
printReport(results);

const proxyResults = results.filter(r => r.label.startsWith('proxy #'));
const anyProxyPasses = proxyResults.some(r => r.verdict === 'PASS');

if (!parsedProxies.length) {
  const direct = results.find(r => r.label.startsWith('direct'));
  console.log('\nNo SCRAPE_PROXY configured — only direct egress was tested.');
  if (direct && direct.verdict !== 'PASS') {
    console.log('Direct egress is being blocked by Akamai (expected from datacenter IPs). Configure a');
    console.log('residential SCRAPE_PROXY secret and re-run this to confirm it gets through. Supercharger');
    console.log('pages are ~100–500 KB each, so pay-as-you-go residential bandwidth costs pennies per run.');
  }
  process.exit(0);
}

if (anyProxyPasses) {
  console.log('\n✅ At least one configured proxy gets past Akamai. The scraper can widen live coverage through it.');
  process.exit(0);
}

console.error('\n❌ No configured proxy returned a usable Tesla page. They connect but Akamai denies their IPs.');
console.error('   Free/public proxy IPs are almost always on Akamai\'s blocklist. Use a residential proxy');
console.error('   (IPRoyal, SOAX, Bright Data, Oxylabs pay-as-you-go all work) and re-run this check.');
process.exit(1);
