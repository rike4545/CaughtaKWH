// Proxy pool with health-checked failover.
//
// Free/public proxies are dead or blocked most of the time, so pointing the scraper at a
// single one is fragile. This module gathers candidates from a few sources, normalizes them,
// and lets the scraper health-check and rotate through them — skipping ones that don't even
// connect — so one bad proxy doesn't waste a whole run.
//
// Sources (all optional, combined in priority order):
//   SCRAPE_PROXY          single proxy (back-compat)
//   SCRAPE_PROXY_LIST     inline list, comma/newline/space separated
//   SCRAPE_PROXY_LIST_URL URL returning a proxy list (plain ip:port lines, proxy URLs, or JSON)

import { ProxyAgent } from 'undici';

const CHECK_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36';

export function splitList(value) {
  return String(value || '')
    .split(/[\s,]+/)
    .map(item => item.trim())
    .filter(Boolean);
}

// Pull bare host:port tokens or proxy URLs out of an arbitrary text/JSON payload.
function parseListPayload(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return [];
  // JSON array of strings, or array of objects with ip/port-ish fields.
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const data = JSON.parse(trimmed);
      const arr = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : [];
      const out = [];
      for (const item of arr) {
        if (typeof item === 'string') { out.push(item); continue; }
        const host = item.ip || item.host || item.address || item.ipAddress;
        const port = item.port || item.Port;
        if (host && port) out.push(`${host}:${port}`);
        else if (host) out.push(String(host));
      }
      if (out.length) return out;
    } catch { /* fall through to line parsing */ }
  }
  return splitList(trimmed);
}

// Normalize a raw entry (`ip:port`, `http://ip:port`, `http://user:pass@host:port`) into the
// pieces the scraper needs: a dispatcher URL for undici/fetch and a Playwright proxy config.
export function parseProxy(raw, { username = '', password = '' } = {}) {
  let value = String(raw || '').trim();
  if (!value) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) value = `http://${value}`;
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (!url.host) return null;
  const user = username || decodeURIComponent(url.username || '');
  const pass = password || decodeURIComponent(url.password || '');
  const token = user && pass ? `${encodeURIComponent(user)}:${encodeURIComponent(pass)}@` : '';
  const dispatcherUrl = `${url.protocol}//${token}${url.host}`;
  const server = `${url.protocol}//${url.host}`;
  const playwright = user ? { server, username: user, password: pass } : { server };
  return { raw: value, host: url.host, dispatcherUrl, playwright };
}

// Gather candidate proxy strings from env (single + inline list + remote list URL), de-duped.
export async function gatherProxyCandidates(env = process.env) {
  const out = [];
  if (env.SCRAPE_PROXY) out.push(...splitList(env.SCRAPE_PROXY));
  if (env.SCRAPE_PROXY_LIST) out.push(...splitList(env.SCRAPE_PROXY_LIST));
  const listUrl = String(env.SCRAPE_PROXY_LIST_URL || '').trim();
  if (listUrl) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Number(env.SCRAPE_PROXY_LIST_TIMEOUT_MS || 10000));
      const response = await fetch(listUrl, { headers: { 'User-Agent': CHECK_UA }, signal: controller.signal });
      clearTimeout(timer);
      if (response.ok) out.push(...parseListPayload(await response.text()));
      else console.warn(`Proxy list URL returned ${response.status}; ignoring it.`);
    } catch (error) {
      console.warn(`Could not fetch SCRAPE_PROXY_LIST_URL: ${error.message}`);
    }
  }
  return [...new Set(out)];
}

// Returns true if a quick request succeeds through the proxy (i.e. it's alive and forwarding).
// This only proves connectivity — Akamai can still block the proxy IP on Tesla; that's handled
// by the scraper's per-station block detection.
export async function checkProxy(parsed, { url = 'https://api.ipify.org', timeoutMs = 8000 } = {}) {
  if (!parsed?.dispatcherUrl) return false;
  let dispatcher;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    dispatcher = new ProxyAgent(parsed.dispatcherUrl);
    const response = await fetch(url, {
      dispatcher,
      signal: controller.signal,
      headers: { 'User-Agent': CHECK_UA }
    });
    return response.status >= 200 && response.status < 400;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
    try { await dispatcher?.close(); } catch { /* ignore */ }
  }
}
