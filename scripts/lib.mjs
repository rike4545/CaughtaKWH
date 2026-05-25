import fs from 'node:fs/promises';
import path from 'node:path';

export const root = process.cwd();
export const dataDir = path.join(root, 'data');
export const historyDir = path.join(dataDir, 'history');

export async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

export async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

export async function writeJson(file, data) {
  await ensureDir(path.dirname(file));
  await fs.writeFile(file, JSON.stringify(data, null, 2) + '\n');
}

export function dedupeBy(items, keyFn) {
  const map = new Map();
  for (const item of items) map.set(keyFn(item), item);
  return [...map.values()];
}

export function parseMoney(text) {
  const match = String(text || '').match(/\$\s*([0-9]+(?:\.[0-9]+)?)/);
  return match ? Number(match[1]) : null;
}

export function nowIso() {
  return new Date().toISOString();
}

export function stationHistoryPath(id) {
  return path.join(historyDir, `${id}.json`);
}
