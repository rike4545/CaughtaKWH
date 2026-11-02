import fs from 'node:fs/promises';
import path from 'node:path';
import { summarizeScrapeHealth } from './scrapeHealthSummary.mjs';

const healthPath = path.join(process.cwd(), 'data', 'scrape-health.json');
const health = JSON.parse(await fs.readFile(healthPath, 'utf8'));
if (!health.generatedAt) throw new Error('scrape-health.json is missing generatedAt');

const report = summarizeScrapeHealth(health);
const markdown = [
  '## CaughtaKWH pricing refresh health',
  '',
  ...report.lines,
  '',
  '_A successful workflow run does not mean Tesla prices were refreshed. Only the saved-observation count confirms new price data._',
  ''
].join('\n');

console.log(markdown);
if (process.env.GITHUB_STEP_SUMMARY) {
  await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, markdown, 'utf8');
}
if (report.annotation) {
  const escaped = report.annotation.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  console.log(`::warning::${escaped}`);
}
