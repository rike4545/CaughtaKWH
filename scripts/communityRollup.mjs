// communityRollup.mjs
// Builds the community contribution layer from the price history that already
// exists. No new data sources, no scraping — it just turns what contributors
// have submitted into credits, a leaderboard, and a "needs a price" worklist.
//
// Outputs (committed, then synced to public/ by `npm run sync:public`):
//   data/contributors.json   leaderboard + per-contributor stats
//   data/needs-price.json     prioritized stations lacking a fresh price + prefill links
//   data/stations-min.json    lightweight {id,name,city,state,url} index for site search
//   CONTRIBUTORS.md           human-readable credits
//
// When run from the ingest workflow with ISSUE_AUTHOR set, it also writes a
// personalized `thanks=` line to $GITHUB_OUTPUT so the success comment can tell
// the contributor their running total and rank.

import fs from 'node:fs';
import path from 'node:path';
import {
  DATA_DIR, ROOT, log, readJSON, writeJSON, listHistoryFiles, hoursSince,
} from './agentLib.mjs';

const REPO = process.env.GITHUB_REPOSITORY || 'rike4545/CaughtaKWH';
const FRESH_HOURS = 24;
const NEEDS_LIMIT = 200;

function reportUrl(stationId) {
  return `https://github.com/${REPO}/issues/new?template=price-report.yml&station=${encodeURIComponent(stationId)}`;
}

async function main() {
  const stations = await readJSON(path.join(DATA_DIR, 'stations.json'), []);
  const byId = new Map(stations.map((s) => [String(s.id), s]));

  // Walk history once: per-station counts/latest, and per-contributor credits.
  const obsByStation = new Map();   // id -> {count, latestCapturedAt, lowestPrice}
  const contributors = new Map();   // login -> {reports, stations:Set, latestAt, lowestSeen}

  for (const file of await listHistoryFiles()) {
    const id = path.basename(file, '.json');
    const rows = await readJSON(file, []);
    if (!Array.isArray(rows) || rows.length === 0) continue;

    let latest = null, lowest = null;
    for (const r of rows) {
      if (!latest || Date.parse(r.capturedAt) > Date.parse(latest)) latest = r.capturedAt;
      const p = r.memberPricePerKwh;
      if (p != null && (lowest == null || p < lowest)) lowest = p;

      if (r.source === 'community_report') {
        const login = r.reportedBy || 'unknown';
        const c = contributors.get(login) || { reports: 0, stations: new Set(), latestAt: null, lowestSeen: null };
        c.reports++;
        c.stations.add(id);
        if (!c.latestAt || Date.parse(r.capturedAt) > Date.parse(c.latestAt)) c.latestAt = r.capturedAt;
        if (p != null && (c.lowestSeen == null || p < c.lowestSeen)) c.lowestSeen = p;
        contributors.set(login, c);
      }
    }
    obsByStation.set(id, { count: rows.length, latestCapturedAt: latest, lowestPrice: lowest });
  }

  // ---- Leaderboard ---------------------------------------------------------
  const leaderboard = [...contributors.entries()]
    .map(([login, c]) => ({
      login,
      reports: c.reports,
      stations: c.stations.size,
      latestAt: c.latestAt,
      lowestPriceFound: c.lowestSeen,
    }))
    .sort((a, b) => b.reports - a.reports || b.stations - a.stations);
  leaderboard.forEach((row, i) => { row.rank = i + 1; });

  await writeJSON(path.join(DATA_DIR, 'contributors.json'), {
    generatedAt: new Date().toISOString(),
    totalReports: leaderboard.reduce((n, r) => n + r.reports, 0),
    totalContributors: leaderboard.length,
    leaderboard,
  });

  // ---- Needs-a-price worklist ---------------------------------------------
  const needs = stations
    .map((s) => {
      const o = obsByStation.get(String(s.id));
      const count = o ? o.count : 0;
      const ageH = o && o.latestCapturedAt ? hoursSince(o.latestCapturedAt) : Infinity;
      const stale = ageH > FRESH_HOURS;
      return { s, count, ageH, stale };
    })
    .filter((x) => x.count === 0 || x.stale)
    .sort((a, b) => {
      // Zero-history first; then by the project's own priority score; then staleness.
      if ((a.count === 0) !== (b.count === 0)) return a.count === 0 ? -1 : 1;
      const pa = a.s.observationPriorityScore || 0, pb = b.s.observationPriorityScore || 0;
      return pb - pa || b.ageH - a.ageH;
    })
    .slice(0, NEEDS_LIMIT)
    .map((x) => ({
      id: x.s.id,
      name: x.s.name || x.s.id,
      city: x.s.city || null,
      state: x.s.state || null,
      lat: x.s.lat ?? null,
      lng: x.s.lng ?? null,
      observations: x.count,
      status: x.count === 0 ? 'no_price_yet' : 'stale',
      lastPriceAgeHours: Number.isFinite(x.ageH) ? Math.round(x.ageH) : null,
      reportUrl: reportUrl(x.s.id),
    }));

  await writeJSON(path.join(DATA_DIR, 'needs-price.json'), {
    generatedAt: new Date().toISOString(),
    totalStations: stations.length,
    withFreshPrice: stations.length - needs.length > 0 ? undefined : undefined, // computed client-side
    needsCount: needs.length,
    stations: needs,
  });

  // ---- Lightweight search index -------------------------------------------
  await writeJSON(path.join(DATA_DIR, 'stations-min.json'),
    stations.map((s) => ({ id: s.id, name: s.name || s.id, city: s.city || null, state: s.state || null })));

  // ---- CONTRIBUTORS.md -----------------------------------------------------
  const md = [
    '# Contributors',
    '',
    'CaughtaKWH\'s pricing record is built by EV drivers reporting what they see. Thank you to everyone below.',
    '',
    `_${leaderboard.reduce((n, r) => n + r.reports, 0)} community price reports from ${leaderboard.length} contributors._`,
    '',
    '| Rank | Contributor | Reports | Stations |',
    '| ---: | --- | ---: | ---: |',
    ...leaderboard.slice(0, 100).map((r) => `| ${r.rank} | [@${r.login}](https://github.com/${r.login}) | ${r.reports} | ${r.stations} |`),
    '',
    `Want to appear here? [Report a price](https://github.com/${REPO}/issues/new?template=price-report.yml) — it takes about 20 seconds.`,
    '',
    '_Auto-generated by scripts/communityRollup.mjs._',
  ].join('\n');
  fs.writeFileSync(path.join(ROOT, 'CONTRIBUTORS.md'), md + '\n');

  log('info', 'community rollup', {
    contributors: leaderboard.length, reports: leaderboard.reduce((n, r) => n + r.reports, 0), needs: needs.length,
  });

  // ---- Personalized thank-you (only when triggered by an ingest) ----------
  const author = process.env.ISSUE_AUTHOR;
  const out = process.env.GITHUB_OUTPUT;
  if (author && out) {
    const me = leaderboard.find((r) => r.login === author);
    let thanks = '';
    if (me) {
      const rankNote = me.rank <= 10 ? ` — **#${me.rank}** on the leaderboard 🏆` : '';
      thanks = `That's **${me.reports}** report${me.reports === 1 ? '' : 's'} across **${me.stations}** station${me.stations === 1 ? '' : 's'}${rankNote}. Thank you for keeping the public pricing record honest! See all contributors in CONTRIBUTORS.md.`;
    }
    fs.appendFileSync(out, `thanks<<THX_EOF\n${thanks}\nTHX_EOF\n`);
  }
}

main().catch((err) => {
  log('error', 'community rollup crashed', { error: String(err && err.stack ? err.stack : err) });
  process.exitCode = 1;
});
