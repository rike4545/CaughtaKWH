import { spawn } from 'node:child_process';
import readline from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const workerPath = fileURLToPath(new URL('./scraplingFetcher.py', import.meta.url));
let child = null;
let nextId = 1;
const pending = new Map();
let closed = false;

function rejectPending(error) {
  for (const entry of pending.values()) entry.reject(error);
  pending.clear();
}

function start() {
  if (child) return;
  const python = process.env.PYTHON || process.env.PYTHON3 || 'python3';
  child = spawn(python, ['-u', workerPath], {
    cwd: process.cwd(),
    stdio: ['pipe', 'pipe', 'inherit'],
    env: process.env
  });
  const lines = readline.createInterface({ input: child.stdout });
  lines.on('line', line => {
    let message;
    try { message = JSON.parse(line); }
    catch { return rejectPending(new Error('Scrapling worker returned invalid JSON.')); }
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    entry.resolve(message);
  });
  child.on('error', error => rejectPending(new Error(`Unable to start Scrapling worker: ${error.message}`)));
  child.on('exit', (code, signal) => {
    child = null;
    if (!closed) rejectPending(new Error(`Scrapling worker exited unexpectedly (code=${code}, signal=${signal}). Check Python and Scrapling installation.`));
  });
}

export function fetchWithScrapling(url, { proxy = null } = {}) {
  if (closed) return Promise.reject(new Error('Scrapling worker is closed.'));
  start();
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    child.stdin.write(JSON.stringify({ id, url, proxy }) + '\n', error => {
      if (error) {
        pending.delete(id);
        reject(error);
      }
    });
  });
}

export async function closeScraplingWorker() {
  closed = true;
  if (!child) return;
  const current = child;
  child = null;
  await new Promise(resolve => {
    current.once('exit', resolve);
    current.stdin.end();
    setTimeout(() => {
      if (current.exitCode === null) current.kill('SIGTERM');
    }, 3000).unref();
  });
  rejectPending(new Error('Scrapling worker closed.'));
}
