// agentLib.mjs
// Shared helpers for the CaughtaKWH self-healing / self-improving agents.
// No external deps beyond what the repo already uses (Node 18+ built-ins).

import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

export const ROOT = process.cwd();
export const DATA_DIR = path.join(ROOT, 'data');
export const HISTORY_DIR = path.join(DATA_DIR, 'history');
export const REPORTS_DIR = path.join(ROOT, 'reports');

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const ACTIVE = LEVELS[process.env.AGENT_LOG_LEVEL || 'info'] ?? 20;

export function log(level, msg, extra) {
  if ((LEVELS[level] ?? 20) < ACTIVE) return;
  const line = { t: new Date().toISOString(), level, msg, ...(extra || {}) };
  const stream = level === 'error' ? process.stderr : process.stdout;
  stream.write(JSON.stringify(line) + '\n');
}

export async function readJSON(file, fallback = null) {
  try {
    const raw = await readFile(file, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (fallback !== null) return fallback;
    throw err;
  }
}

export async function writeJSON(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

// Retry with exponential backoff + jitter. Used by the self-heal agent for
// transient failures (network blips, slow renders). NOT a bypass mechanism —
// it just gives ordinary flaky operations a fair chance to succeed.
export async function withRetry(fn, { tries = 4, baseMs = 1500, label = 'op' } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      const transient = isTransient(err);
      log('warn', `attempt ${attempt}/${tries} failed for ${label}`, {
        transient,
        error: String(err && err.message ? err.message : err),
      });
      if (!transient || attempt === tries) break;
      const delay = baseMs * 2 ** (attempt - 1) + Math.random() * baseMs;
      await sleep(delay);
    }
  }
  throw lastErr;
}

export function isTransient(err) {
  const m = String(err && err.message ? err.message : err).toLowerCase();
  return (
    m.includes('timeout') ||
    m.includes('econnreset') ||
    m.includes('etimedout') ||
    m.includes('socket hang up') ||
    m.includes('navigation') ||
    m.includes('net::') ||
    m.includes('502') ||
    m.includes('503') ||
    m.includes('504') ||
    m.includes('429')
  );
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function hoursSince(iso) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return Infinity;
  return (Date.now() - t) / 36e5;
}

// Minimal GitHub helper. Uses GITHUB_TOKEN provided automatically inside
// Actions. Falls back to writing a local report file when no token is present
// so the agents are still useful when run locally.
export async function reportFinding({ title, body, labels = [] }) {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY; // owner/name
  await mkdir(REPORTS_DIR, { recursive: true });
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60);
  const local = path.join(REPORTS_DIR, `finding-${slug}.md`);
  await writeFile(local, `# ${title}\n\n${body}\n`, 'utf8');

  if (!token || !repo) {
    log('info', 'no GITHUB_TOKEN/REPOSITORY — wrote local report instead', { local });
    return { mode: 'local', file: local };
  }

  // De-dupe: don't open a second identical issue if one is already open.
  const q = encodeURIComponent(`repo:${repo} is:issue is:open in:title ${title}`);
  const search = await ghFetch(`https://api.github.com/search/issues?q=${q}`, token);
  if (search && search.total_count > 0) {
    log('info', 'matching open issue already exists, skipping', { title });
    return { mode: 'exists', number: search.items[0].number };
  }

  const created = await ghFetch(`https://api.github.com/repos/${repo}/issues`, token, {
    method: 'POST',
    body: JSON.stringify({ title, body, labels }),
  });
  log('info', 'opened issue', { number: created && created.number });
  return { mode: 'issue', number: created && created.number };
}

async function ghFetch(url, token, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) {
    log('error', 'github api error', { url, status: res.status });
    return null;
  }
  return res.json();
}

export async function listHistoryFiles() {
  if (!existsSync(HISTORY_DIR)) return [];
  const names = await readdir(HISTORY_DIR);
  return names.filter((n) => n.endsWith('.json')).map((n) => path.join(HISTORY_DIR, n));
}

export async function fileAgeHours(file) {
  try {
    const s = await stat(file);
    return (Date.now() - s.mtimeMs) / 36e5;
  } catch {
    return Infinity;
  }
}
