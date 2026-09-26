import React from 'react';
import { isCurrentPrediction } from '../kpis.js';
import { ageText, money, shortDate, titleCase } from '../utils/formatters.js';

const CURRENT_PRICE_MAX_HOURS = 2;

export function statusText(value) {
  return ({ active: 'Active', healthy: 'Healthy', in_progress: 'In progress', needs_data: 'Needs data', next: 'Next' })[value] || titleCase(value);
}
export function stationCountText(count, verb = 'have') {
  const value = Number(count || 0);
  const noun = value === 1 ? 'station' : 'stations';
  const action = value === 1 && verb === 'have' ? 'has' : verb;
  return `${value.toLocaleString()} ${noun} ${action}`;
}
export function usableHistoryState(prediction, rows) {
  const sampleCount = Number(prediction?.sampleCount || 0);
  const recentRows = rows.filter(row => typeof row.memberPricePerKwh === 'number' || typeof row.nonMemberPricePerKwh === 'number');
  const uniqueSlots = new Set(recentRows.map(row => row.halfHourSlot ?? `${row.localHour}:${row.localMinute}`)).size;
  const ageHours = Number(prediction?.latestObservationAgeHours ?? Infinity);
  if (sampleCount >= 10 && uniqueSlots >= 3 && ageHours <= 24) return { label: 'Strong history', tone: 'ok', next: 'This station has enough recent observations to start comparing time windows with more confidence.' };
  if (sampleCount >= 3 && ageHours <= 48) return { label: 'Usable history', tone: 'ok', next: `Usable now. Add ${Math.max(0, 10 - sampleCount)} more observations across different times to strengthen the cheaper-window model.` };
  if (sampleCount > 0) return { label: 'Needs more observations', tone: 'warn', next: `We have ${sampleCount} price observation${sampleCount === 1 ? '' : 's'}. Get to 3 recent observations before treating the history as usable.` };
  return { label: 'No usable history yet', tone: 'warn', next: 'Run a focused refresh for this station to start building usable price history.' };
}
export function manualCheckFromCurrentData(selected, prediction, rows) {
  const latest = [...rows].filter(row => row.memberPricePerKwh != null || row.nonMemberPricePerKwh != null).at(-1);
  return {
    ok: true,
    stationId: selected?.id || null,
    source: 'CaughtaKWH public data',
    latestObservedAt: latest?.capturedAt || prediction?.latestObservedAt || null,
    memberPricePerKwh: latest?.memberPricePerKwh ?? prediction?.latestObservedPrice ?? null,
    memberPeakPricePerKwh: latest?.memberPeakPricePerKwh ?? null,
    nonMemberPricePerKwh: latest?.nonMemberPricePerKwh ?? null,
    nonMemberPeakPricePerKwh: latest?.nonMemberPeakPricePerKwh ?? null,
    confidence: prediction?.confidenceLabel || 'last saved',
    historyCount: rows.length,
    currentTeslaPriceGuaranteed: false
  };
}

export function priceState(selected, prediction) {
  if (prediction?.latestObservedAt) {
    const current = isCurrentPrediction(prediction);
    const attemptNote = selected?.lastScrapeBlocked
      ? ` Tesla blocked the latest automated attempt${selected.lastAttemptedAt ? ` on ${shortDate(selected.lastAttemptedAt)}` : ''}; the saved observation was preserved.`
      : selected?.lastScrapeResult === 'transient_failure'
        ? ` The latest automated attempt had a temporary connection problem${selected.lastAttemptedAt ? ` on ${shortDate(selected.lastAttemptedAt)}` : ''}; the saved observation was preserved.`
        : '';
    return {
      title: current ? 'Recent Tesla public price observed' : 'Stale historical price only',
      tone: current ? 'ok' : 'warn',
      detail: `${money(prediction.latestObservedPrice)} last observed ${shortDate(prediction.latestObservedAt)} · ${ageText(prediction.latestObservationAgeHours)}. ${current ? 'Treat this as recently observed, but still verify in Tesla before charging.' : `Older than ${CURRENT_PRICE_MAX_HOURS} hours, so CaughtaKWH keeps it as history instead of showing it as the current Tesla price.`}${attemptNote}`
    };
  }
  if (selected?.lastScrapeBlocked) return { title: 'Tesla blocked the automated check', tone: 'warn', detail: `Attempted ${shortDate(selected.lastAttemptedAt || selected.lastBlockedAt || selected.lastScrapedAt)}. CaughtaKWH preserved prior data and will wait until ${shortDate(selected.nextScrapeEligibleAt)} before retrying.` };
  if (selected?.lastScrapeResult === 'transient_failure') return { title: 'Temporary connection problem', tone: 'warn', detail: `The attempt on ${shortDate(selected.lastAttemptedAt)} could not reliably reach Tesla. It was not counted as a successful page check, and prior data was preserved.` };
  if (selected?.lastScrapeResult === 'no_usable_candidate') return { title: 'Tesla station page not confirmed', tone: 'warn', detail: `The attempt on ${shortDate(selected.lastAttemptedAt)} did not find a valid public page for this station. No price state was changed.` };
  if (selected?.lastScrapeHadAvailability) return { title: 'Tesla shows the site, but not the price', tone: 'warn', detail: 'The station page had availability info last time we checked, but it did not show a public $/kWh rate.' };
  if (selected?.lastScrapedAt) return { title: 'No price on the public page yet', tone: 'warn', detail: `Last checked ${shortDate(selected.lastScrapedAt)}. The live rate may only be visible in the Tesla app or inside the car.` };
  return { title: 'We have not checked this one yet', tone: 'warn', detail: 'Until the scraper gets a clean look at this station, use Tesla for the live price.' };
}

export function PriceTruthNotice({ selected, prediction }) {
  const state = priceState(selected, prediction);
  return <div className={state.tone === 'ok' ? 'truthNotice ok' : 'truthNotice'}>
    <strong>{state.title}</strong>
    <p>{state.detail}</p>
  </div>;
}


