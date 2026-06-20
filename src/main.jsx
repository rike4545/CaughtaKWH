import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Activity, AlertTriangle, BatteryCharging, Clock3, Compass, Eye, EyeOff, ExternalLink, MapPin, Navigation, RefreshCw, Search, ShieldCheck, Target, TrendingDown, Users, Zap } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { geocodeZip, nearestStations } from './zipSearch.js';
import { coverageKpis, currentPricingStats, isCurrentPrediction, pricingStats } from './kpis.js';
import { TESLA_BATTERY_PRESETS, estimateChargeCost } from './chargeCost.js';
import './styles.css';

const CURRENT_PRICE_MAX_HOURS = 2;
const money = value => typeof value === 'number' ? `$${value.toFixed(2)}` : '—';
const cents = value => typeof value === 'number' ? `${value.toFixed(value % 1 ? 2 : 0)}¢` : '—';
const signedCents = value => typeof value === 'number' ? `${value >= 0 ? '+' : '-'}${cents(Math.abs(value))}` : '—';
const shortDate = iso => iso ? new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
const distance = miles => typeof miles === 'number' ? `${miles.toFixed(miles < 10 ? 1 : 0)} mi` : '';
const slotLabel = slot => `${String(Math.floor(slot / 2)).padStart(2, '0')}:${slot % 2 === 0 ? '00' : '30'}`;
const REPORT_FORM = 'https://github.com/rike4545/CaughtaKWH/issues/new?template=price-report.yml';
const reportUrl = id => id ? `report.html?station=${encodeURIComponent(id)}` : 'report.html';
const CONTRIBUTE_URL = './contribute.html';

const EV_PRICE_LAWS = [
  {
    state: "Federal / NEVI",
    status: "enacted",
    requirement: "Price must be displayed prior to initiating a session in $/kWh. Real-time price must be shown and cannot change mid-session. All additional fees must be clearly disclosed. Price data must be available via open API to third parties.",
    scope: "NEVI-funded DC fast chargers only",
    authority: "Federal Highway Administration (FHWA) / U.S. DOT",
    effectiveDate: "March 30, 2023",
    citation: "23 CFR §§ 680.106, 680.116",
  },
  {
    state: "CA",
    status: "enacted",
    requirement: "Two overlapping requirements: (1) CARB requires disclosure at point of sale of all fees and the price in $/kWh before the session starts; (2) CDFA weights-and-measures rule requires all commercial EVSE to display unit price in $/kWh. Billing by the minute is prohibited — pricing must be energy-based.",
    scope: "All publicly available commercial chargers (L2 and DCFC)",
    authority: "California Air Resources Board (CARB); CA Dept. of Food & Agriculture (CDFA)",
    effectiveDate: "2022 (DCFC), 2023 (L2)",
    citation: "Cal. Code Regs. tit. 13, § 2360.1; tit. 4, § 4002.11",
  },
  {
    state: "WA",
    status: "enacted",
    requirement: "EV service providers must clearly disclose all charges, fees, and costs at the point of sale prior to initiating a session, including parking fees, price in $/kWh, and variable pricing terms. Free charging must also be disclosed before the session begins.",
    scope: "All publicly available EVSE (L2 and DCFC)",
    authority: "Washington State Dept. of Agriculture (WSDA) — Weights & Measures",
    effectiveDate: "January 1, 2023",
    citation: "RCW 19.94.560 (SB 5192, 2021)",
  },
  {
    state: "TX",
    status: "enacted",
    requirement: "Providers must display on the charger: the method for calculating the fee, the current rate, and applicable surcharges. Itemized receipts available on request. TDLR administers registration, inspections, and consumer complaints.",
    scope: "All publicly available EVSE",
    authority: "Texas Dept. of Licensing and Regulation (TDLR)",
    effectiveDate: "June 18, 2023 (statute); Dec 1, 2024 (TDLR rules)",
    citation: "Texas Occ. Code §§ 2311.0206, 2311.0303–2311.0306 (SB 1001, 2023)",
  },
  {
    state: "GA",
    status: "enacted",
    requirement: "All public EV charging stations must accurately measure and display electricity dispensed on a per-kWh basis. The Dept. of Revenue conducts inspections. Violations subject to fines up to $1,000. Compliance deadline was extended to 2027.",
    scope: "All public EV charging stations (L2 and DCFC)",
    authority: "Georgia Dept. of Revenue",
    effectiveDate: "January 1, 2027 (compliance deadline)",
    citation: "Georgia Code § 10-1-222 (SB 146, 2023; extended by HB 516, 2024)",
  },
  {
    state: "MN",
    status: "enacted",
    requirement: "Retail EV chargers must display: price per kWh in whole or tenths of a cent (or indicate free); terms for variable pricing; charger power level; type of energy transfer; and any additional fees. Mirrors a weights-and-measures retail labeling approach.",
    scope: "All retail (commercial public) chargers where electricity is sold as vehicle fuel",
    authority: "Minnesota Dept. of Commerce — Weights & Measures",
    effectiveDate: "June 14, 2025",
    citation: "Minn. Stat. § 296A.073 (2025 Legislature, 1st Special Session)",
  },
  {
    state: "NY",
    status: "pending",
    requirement: "Requires publicly available EV charging stations that received state funding, grants, tax benefits, or ratepayer support to clearly post the total price at the point of sale before a session starts. Prohibits requiring a mobile device as the sole payment method and barring access without a subscription. DPS must finalize rules by June 1, 2027; compliance required for stations constructed or upgraded after January 1, 2028.",
    scope: "Publicly available chargers that received any state funding, grants, tax benefits, rebates, or ratepayer support",
    authority: "NY Dept. of Public Service (DPS) / Public Service Commission",
    effectiveDate: "Awaiting Governor signature (passed both chambers June 2, 2026); compliance Jan 1, 2028",
    citation: "S7260A / A7633 (2025-2026 session), proposing Public Service Law § 66-x",
  },
  {
    state: "MA",
    status: "pending",
    requirement: "Requires the Division of Standards to promulgate regulations setting minimum requirements for the communication and display of pricing information at public EV charging stations. Separately requires real-time data sharing including price by port. Law is enacted; implementing regulations are still being drafted.",
    scope: "Public EV charging stations (residential properties with 4 or fewer units excluded)",
    authority: "Massachusetts Division of Standards; Executive Office of Energy and Environmental Affairs (EOEEA)",
    effectiveDate: "Law signed Nov 21, 2024; implementing regulations pending as of June 2026",
    citation: "St. 2024, c. 239 (An Act Promoting a Clean Energy Grid), §§ 31, 42 (amending M.G.L. cc. 25B, 98)",
  },
  {
    state: "NJ",
    status: "none",
    requirement: "No confirmed EV-charging-specific price disclosure law. Secondary sources reference a proposed 'Electric Vehicle Charging Public Disclosure Act' but no enacted statute citation could be verified in official legislative records as of June 2026.",
    scope: "",
    authority: "",
    effectiveDate: "",
    citation: "",
  },
  {
    state: "CT",
    status: "none",
    requirement: "No confirmed enacted law or PURA regulation requiring consumer-facing price display at public EV chargers. PURA's EV Charging Program governs utility incentive programs and rate design but does not mandate point-of-sale price disclosure at third-party public stations.",
    scope: "",
    authority: "",
    effectiveDate: "",
    citation: "",
  },
];
const wrapSlot = slot => (slot + 48) % 48;
const ageText = hours => typeof hours === 'number' ? hours < 1 ? `${Math.round(hours * 60)} min old` : `${hours.toFixed(hours < 10 ? 1 : 0)} hr old` : 'No public price yet';
const percent = value => typeof value === 'number' ? `${Math.round(value * 100)}%` : '—';
const coords = station => typeof station?.lat === 'number' && typeof station?.lng === 'number' ? `${station.lat.toFixed(4)}, ${station.lng.toFixed(4)}` : '—';
const titleCase = value => String(value || '—').replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
const scrapeResultLabel = value => ({
  price_found: 'Price found',
  availability_found: 'Availability found',
  valid_page_no_public_data: 'Page loaded, price hidden',
  access_controlled: 'Access controlled',
  transient_failure: 'Temporary connection problem',
  no_usable_candidate: 'Station page not confirmed'
})[value] || titleCase(value);
const candidateLabel = value => ({
  stored_tesla_url: 'Saved Tesla link',
  explicit_location_id: 'Tesla location ID',
  station_id: 'Station ID',
  city_state_slug: 'City and state',
  name_state_slug: 'Station name',
  name_slug: 'Name fallback'
})[value] || titleCase(value);
const signalLabel = value => ({
  tesla_location_page: 'Tesla station page',
  not_found: 'Not found',
  blocked: 'Blocked',
  rate_limited: 'Rate limited',
  akamai_challenge: 'Access challenge',
  transient_failure: 'Temporary connection problem',
  http_error: 'Page request failed',
  unknown: 'Unknown'
})[value] || titleCase(value);
const freshnessLabel = iso => {
  if (!iso) return 'No recent observation';
  const ageHours = (Date.now() - new Date(iso).getTime()) / 36e5;
  if (ageHours < 0.5) return 'Fresh, under 30 min';
  if (ageHours < 2) return 'Recent, under 2 hr';
  if (ageHours < 24) return 'Getting old, over 2 hr';
  return 'Old, over 24 hr';
};
// EIA Table 5.6.B — Commercial sector average retail prices, March 2026.
// https://www.eia.gov/electricity/monthly/epm_table_grapher.php?lv=true&t=epmt_5_6_b
const commercialBenchmarks = {
  CA: { centsPerKwh: 29.14, label: 'CA commercial avg', period: 'EIA Mar 2026', sourceUrl: 'https://www.eia.gov/electricity/monthly/epm_table_grapher.php?lv=true&t=epmt_5_6_b' },
  MA: { centsPerKwh: 26.08, label: 'MA commercial avg', period: 'EIA Mar 2026', sourceUrl: 'https://www.eia.gov/electricity/monthly/epm_table_grapher.php?lv=true&t=epmt_5_6_b' },
  NY: { centsPerKwh: 22.21, label: 'NY commercial avg', period: 'EIA Mar 2026', secondary: 'NYSERDA Feb 2026: 23.5¢/kWh', sourceUrl: 'https://www.eia.gov/electricity/monthly/epm_table_grapher.php?lv=true&t=epmt_5_6_a', secondaryUrl: 'https://www.nyserda.ny.gov/Energy-Prices/Electricity/Monthly-Avg-Electricity-Commercial' },
  CT: { centsPerKwh: 21.84, label: 'CT commercial avg', period: 'EIA Mar 2026', sourceUrl: 'https://www.eia.gov/electricity/monthly/epm_table_grapher.php?lv=true&t=epmt_5_6_b' },
  NJ: { centsPerKwh: 17.92, label: 'NJ commercial avg', period: 'EIA Mar 2026', sourceUrl: 'https://www.eia.gov/electricity/monthly/epm_table_grapher.php?lv=true&t=epmt_5_6_b' },
  CO: { centsPerKwh: 14.21, label: 'CO commercial avg', period: 'EIA Mar 2026', sourceUrl: 'https://www.eia.gov/electricity/monthly/epm_table_grapher.php?lv=true&t=epmt_5_6_b' },
  AZ: { centsPerKwh: 13.55, label: 'AZ commercial avg', period: 'EIA Mar 2026', sourceUrl: 'https://www.eia.gov/electricity/monthly/epm_table_grapher.php?lv=true&t=epmt_5_6_b' },
  MI: { centsPerKwh: 13.41, label: 'MI commercial avg', period: 'EIA Mar 2026', sourceUrl: 'https://www.eia.gov/electricity/monthly/epm_table_grapher.php?lv=true&t=epmt_5_6_b' },
  IL: { centsPerKwh: 12.98, label: 'IL commercial avg', period: 'EIA Mar 2026', sourceUrl: 'https://www.eia.gov/electricity/monthly/epm_table_grapher.php?lv=true&t=epmt_5_6_b' },
  PA: { centsPerKwh: 12.44, label: 'PA commercial avg', period: 'EIA Mar 2026', sourceUrl: 'https://www.eia.gov/electricity/monthly/epm_table_grapher.php?lv=true&t=epmt_5_6_b' },
  FL: { centsPerKwh: 12.31, label: 'FL commercial avg', period: 'EIA Mar 2026', sourceUrl: 'https://www.eia.gov/electricity/monthly/epm_table_grapher.php?lv=true&t=epmt_5_6_b' },
  GA: { centsPerKwh: 11.47, label: 'GA commercial avg', period: 'EIA Mar 2026', sourceUrl: 'https://www.eia.gov/electricity/monthly/epm_table_grapher.php?lv=true&t=epmt_5_6_b' },
  TX: { centsPerKwh: 11.23, label: 'TX commercial avg', period: 'EIA Mar 2026', sourceUrl: 'https://www.eia.gov/electricity/monthly/epm_table_grapher.php?lv=true&t=epmt_5_6_b' },
  OH: { centsPerKwh: 11.18, label: 'OH commercial avg', period: 'EIA Mar 2026', sourceUrl: 'https://www.eia.gov/electricity/monthly/epm_table_grapher.php?lv=true&t=epmt_5_6_b' },
  VA: { centsPerKwh: 9.84,  label: 'VA commercial avg', period: 'EIA Mar 2026', sourceUrl: 'https://www.eia.gov/electricity/monthly/epm_table_grapher.php?lv=true&t=epmt_5_6_b' },
  NC: { centsPerKwh: 9.62,  label: 'NC commercial avg', period: 'EIA Mar 2026', sourceUrl: 'https://www.eia.gov/electricity/monthly/epm_table_grapher.php?lv=true&t=epmt_5_6_b' },
  WA: { centsPerKwh: 9.11,  label: 'WA commercial avg', period: 'EIA Mar 2026', sourceUrl: 'https://www.eia.gov/electricity/monthly/epm_table_grapher.php?lv=true&t=epmt_5_6_b' },
};

function useJson(url, fallback, refreshMs = 300000) {
  const [data, setData] = useState(fallback);
  const [error, setError] = useState(null);
  const [fetchedAt, setFetchedAt] = useState(null);
  useEffect(() => {
    let live = true;
    // Reset to fallback when the URL changes so one station's data never bleeds into the
    // next when the new fetch 404s (e.g. a station with no saved price history file).
    setData(fallback);
    const load = () => {
      setError(null);
      fetch(`${url}?t=${Date.now()}`, { cache: 'no-store' })
        .then(response => {
          if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
          return response.json();
        })
        .then(json => {
          if (!live) return;
          setData(json);
          setFetchedAt(new Date().toISOString());
        })
        .catch(error => { if (live) { setError(error.message); setData(fallback); } });
    };
    load();
    const timer = refreshMs ? window.setInterval(load, refreshMs) : null;
    return () => { live = false; if (timer) window.clearInterval(timer); };
  }, [url, refreshMs]);
  return { data, error, fetchedAt };
}

function Card({ children, className = '' }) { return <section className={`card ${className}`}>{children}</section>; }
function Stat({ icon, label, value, note }) { return <Card className="stat"><div className="statIcon">{icon}</div><div><p>{label}</p><strong>{value}</strong>{note && <small>{note}</small>}</div></Card>; }
function EmptyState({ title, children }) { return <div className="empty"><AlertTriangle size={18}/><div><strong>{title}</strong><p>{children}</p></div></div>; }

function ChartTooltip({ active, payload, label, formatter }) {
  if (!active || !payload?.length) return null;
  return <div className="chartTooltip">
    {label && <p className="chartTooltipLabel">{label}</p>}
    {payload.map((entry, i) => <p key={i} style={{ color: entry.color || entry.stroke || 'inherit' }}>{entry.name}: <strong>{formatter ? formatter(entry.value) : entry.value}</strong></p>)}
  </div>;
}
function statusText(value) {
  return ({ active: 'Active', healthy: 'Healthy', in_progress: 'In progress', needs_data: 'Needs data', next: 'Next' })[value] || titleCase(value);
}
function stationCountText(count, verb = 'have') {
  const value = Number(count || 0);
  const noun = value === 1 ? 'station' : 'stations';
  const action = value === 1 && verb === 'have' ? 'has' : verb;
  return `${value.toLocaleString()} ${noun} ${action}`;
}
function usableHistoryState(prediction, rows) {
  const sampleCount = Number(prediction?.sampleCount || 0);
  const recentRows = rows.filter(row => typeof row.memberPricePerKwh === 'number' || typeof row.nonMemberPricePerKwh === 'number');
  const uniqueSlots = new Set(recentRows.map(row => row.halfHourSlot ?? `${row.localHour}:${row.localMinute}`)).size;
  const ageHours = Number(prediction?.latestObservationAgeHours ?? Infinity);
  if (sampleCount >= 10 && uniqueSlots >= 3 && ageHours <= 24) return { label: 'Strong history', tone: 'ok', next: 'This station has enough recent observations to start comparing time windows with more confidence.' };
  if (sampleCount >= 3 && ageHours <= 48) return { label: 'Usable history', tone: 'ok', next: `Usable now. Add ${Math.max(0, 10 - sampleCount)} more observations across different times to strengthen the cheaper-window model.` };
  if (sampleCount > 0) return { label: 'Needs more observations', tone: 'warn', next: `We have ${sampleCount} price observation${sampleCount === 1 ? '' : 's'}. Get to 3 recent observations before treating the history as usable.` };
  return { label: 'No usable history yet', tone: 'warn', next: 'Run a focused refresh for this station to start building usable price history.' };
}
function manualCheckFromCurrentData(selected, prediction, rows) {
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

function priceState(selected, prediction) {
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

function PriceTruthNotice({ selected, prediction }) {
  const state = priceState(selected, prediction);
  return <div className={state.tone === 'ok' ? 'truthNotice ok' : 'truthNotice'}>
    <strong>{state.title}</strong>
    <p>{state.detail}</p>
  </div>;
}

function RateTile({ kind, label, icon, off, peak, fresh, benchDelta }) {
  const hasPrice = typeof off === 'number';
  return <div className={`rateTile ${kind}${fresh && hasPrice ? ' fresh' : ''}${hasPrice ? '' : ' empty'}`}>
    <div className="rateTileHead">{icon}<span>{label}</span></div>
    {hasPrice ? <>
      <div className="rateBig">{money(off)}<small>/kWh{peak != null ? ' off-peak' : ''}</small></div>
      {peak != null
        ? <div className="ratePeak"><span className="peakDot" /> to <strong>{money(peak)}</strong> at peak</div>
        : <div className="rateFlat">flat rate, all day</div>}
      {benchDelta != null && <div className={`rateBench ${benchDelta > 0 ? 'over' : 'under'}`}>{signedCents(benchDelta)} vs local grid</div>}
    </> : <div className="rateBig empty">Hidden<small>no public rate shown</small></div>}
  </div>;
}

function PriceMatrix({ memberOff, memberPeak, nonOff, nonPeak, congestion, fresh, benchmarkCents, observedAt }) {
  const benchmark = typeof benchmarkCents === 'number' ? benchmarkCents : null;
  const delta = price => (typeof price === 'number' && benchmark != null) ? price * 100 - benchmark : null;
  const anyPrice = typeof memberOff === 'number' || typeof nonOff === 'number';
  return <div className={`priceMatrix${fresh ? ' fresh' : ''}`}>
    <div className="rateRow">
      <RateTile kind="member" label="Tesla / member" icon={<Zap size={15}/>} off={memberOff} peak={memberPeak} fresh={fresh} benchDelta={delta(memberOff)} />
      <RateTile kind="nonmember" label="Non-Tesla" icon={<Users size={15}/>} off={nonOff} peak={nonPeak} fresh={fresh} benchDelta={delta(nonOff)} />
    </div>
    <div className="rateFooter">
      <span className="rateFoot"><Clock3 size={14}/> Congestion fee <strong>{congestion != null ? `${money(congestion)}/min` : 'none shown'}</strong></span>
      <span className="rateFoot"><TrendingDown size={14}/> Local grid <strong>{benchmark != null ? `${cents(benchmark)}/kWh` : 'no benchmark'}</strong></span>
      <span className={`rateFoot rateFreshTag${fresh ? ' ok' : ''}`}>{anyPrice ? (fresh ? 'Recently observed' : observedAt ? 'Historical only' : 'Saved') : 'Not checked yet'}</span>
    </div>
  </div>;
}

function ChargeCostCalculator({ currentPrice, cheapestPrice, cheapestLabel, rateLabel, fresh, congestion }) {
  const [presetId, setPresetId] = useState('m3-lr');
  const [manualKwh, setManualKwh] = useState('');
  const [arrival, setArrival] = useState(40);
  const [target, setTarget] = useState(80);
  const preset = TESLA_BATTERY_PRESETS.find(p => p.id === presetId) || TESLA_BATTERY_PRESETS[0];
  const manualMode = presetId === 'other' || manualKwh.trim() !== '';
  const usableKwh = manualKwh.trim() !== '' ? Number(manualKwh) : preset.usableKwh;
  const priceForCalc = typeof currentPrice === 'number' ? currentPrice : null;
  const now = estimateChargeCost({ usableKwh, arrivalPct: arrival, targetPct: target, pricePerKwh: priceForCalc });
  const best = typeof cheapestPrice === 'number'
    ? estimateChargeCost({ usableKwh, arrivalPct: arrival, targetPct: target, pricePerKwh: cheapestPrice })
    : null;
  const savings = now && best ? Number((now.cost - best.cost).toFixed(2)) : null;
  const needBattery = !(typeof usableKwh === 'number' && usableKwh > 0);
  return <Card>
    <div className="sectionTitle"><div><p>Cost to charge</p><h2>{now ? `≈ ${money(now.cost)} to ${target}%` : 'Estimate your session cost'}</h2></div><span className={fresh ? 'badge fresh' : 'badge'}>{rateLabel}</span></div>
    <p className="muted">Pick your car (or enter usable kWh), then your arrival charge. We multiply the energy you need by the {fresh ? 'latest observed' : 'best available'} {rateLabel.toLowerCase()} rate.</p>
    <div className="costCalcInputs">
      <label>Vehicle
        <select value={presetId} onChange={e => { setPresetId(e.target.value); if (e.target.value !== 'other') setManualKwh(''); }}>
          {TESLA_BATTERY_PRESETS.map(p => <option key={p.id} value={p.id}>{p.label}{p.usableKwh ? ` · ${p.usableKwh} kWh` : ''}</option>)}
        </select>
      </label>
      <label>Usable battery (kWh)
        <input type="number" inputMode="decimal" min="10" max="250" step="0.5" placeholder={preset.usableKwh ? String(preset.usableKwh) : 'e.g. 75'} value={manualKwh} onChange={e => setManualKwh(e.target.value)} />
      </label>
      <label>Arrive at (%)
        <input type="number" inputMode="numeric" min="0" max="100" step="1" value={arrival} onChange={e => setArrival(e.target.value)} />
      </label>
      <label>Charge to (%)
        <input type="number" inputMode="numeric" min="0" max="100" step="1" value={target} onChange={e => setTarget(e.target.value)} />
      </label>
    </div>
    {needBattery
      ? <EmptyState title="Pick your car or enter a battery size">Choose a Tesla model above, or type your usable battery capacity in kWh, to estimate the cost.</EmptyState>
      : !now
        ? <EmptyState title="No price to estimate with yet">We have not observed a public {rateLabel.toLowerCase()} rate for this charger, so there is no price to multiply by. Check Tesla for the live rate.</EmptyState>
        : <>
          <div className="costCalcResult">
            <div className="costNow">
              <span>Estimated cost{fresh ? '' : ' (from history)'}</span>
              <strong>{money(now.cost)}</strong>
              <small>{now.kwh} kWh added · {arrival}% → {target}% · {cents(now.pricePerKwh * 100)}/kWh</small>
            </div>
            {best && cheapestLabel && <div className="costBest">
              <span>At the cheapest window ({cheapestLabel})</span>
              <strong>{money(best.cost)}</strong>
              <small>{cents(best.pricePerKwh * 100)}/kWh{savings > 0 ? ` · save ≈ ${money(savings)}` : ''}</small>
            </div>}
          </div>
          {congestion != null && <p className="muted compactNote">Heads up: this station has shown a congestion fee of {money(congestion)}/min above a high state of charge — it is billed by the minute, not included here.</p>}
          <p className="muted compactNote">Energy = (charge to − arrive at) × usable battery. Real sessions vary with charging speed, preconditioning, and temperature. Always confirm the live rate in Tesla before charging.</p>
        </>}
  </Card>;
}

const isTesla = /Tesla\//.test(navigator.userAgent);
const isMobile = !isTesla && navigator.maxTouchPoints > 0
  && window.matchMedia('(pointer: coarse)').matches
  && window.screen.width < 1024;

function App() {
  const { data: stations, fetchedAt: stationsFetchedAt } = useJson('./data/stations.json', []);
  const { data: predictions, fetchedAt: predictionsFetchedAt } = useJson('./data/predictions.json', []);
  const { data: dashboardHealth } = useJson('./data/dashboard-health.json', null);
  const [query, setQuery] = useState('');
  const [stateFilter, setStateFilter] = useState('All');
  const [rateType, setRateType] = useState('member');
  const [selectedId, setSelectedId] = useState(() => window.location.hash.slice(1) || null);
  const [zip, setZip] = useState('');
  const [origin, setOrigin] = useState(null);
  const [originMode, setOriginMode] = useState('browse');
  const [geoError, setGeoError] = useState('');
  const [geoLoading, setGeoLoading] = useState(false);
  const [activeView, setActiveView] = useState('chargers');
  const [manualCheck, setManualCheck] = useState({ status: 'idle' });
  const [autoLocateDone, setAutoLocateDone] = useState(false);
  const detailRef = useRef(null);

  const selected = stations.find(station => station.id === selectedId) ?? null;
  const { data: history } = useJson(selected?.id ? `./data/history/${selected.id}.json` : './data/history/none.json', []);
  const prediction = predictions.find(item => item.stationId === selected?.id && item.membershipType === rateType) || predictions.find(item => item.stationId === selected?.id);

  useEffect(() => {
    setManualCheck({ status: 'idle' });
  }, [selected?.id]);

  // Sync URL hash and page title with the selected station. Keyed on selectedId so the
  // hash survives initial load (selectedId is seeded from the hash before stations arrive).
  useEffect(() => {
    if (selectedId) {
      const hash = `#${selectedId}`;
      if (window.location.hash !== hash) window.history.replaceState(null, '', hash);
      document.title = `${selected?.name || selected?.city || selectedId} · CaughtaKWH`;
    } else {
      if (window.location.hash) window.history.replaceState(null, '', window.location.pathname);
      document.title = 'CaughtaKWH';
    }
  }, [selectedId, selected?.name]);

  // Once stations load, drop a hash-seeded selection that doesn't match any real station.
  useEffect(() => {
    if (stations.length && selectedId && !stations.some(s => s.id === selectedId)) setSelectedId(null);
  }, [stations.length]);

  const states = useMemo(() => ['All', ...Array.from(new Set(stations.map(station => station.state).filter(Boolean))).sort()], [stations]);
  const nearbyLimit = originMode === 'near-me' ? 5 : originMode === 'zip' ? 5 : 0;
  const nearbyList = useMemo(() => origin ? nearestStations(stations, origin, nearbyLimit || 25) : [], [stations, origin, nearbyLimit]);
  const filtered = useMemo(() => {
    const normalized = query.toLowerCase().trim();
    return stations.filter(station => {
      const matchesState = stateFilter === 'All' || station.state === stateFilter;
      const text = [station.name, station.city, station.state, station.address, station.id].filter(Boolean).join(' ').toLowerCase();
      return matchesState && (!normalized || text.includes(normalized));
    });
  }, [stations, query, stateFilter]);
  const hasFilter = query.trim() || stateFilter !== 'All';
  const list = origin ? nearbyList : hasFilter ? filtered : [];

  // Auto-geolocate on load for Tesla browser and mobile — skip the search step entirely.
  useEffect(() => {
    if (autoLocateDone || !stations.length) return;
    if (!isTesla && !isMobile) return;
    setAutoLocateDone(true);
    if (!navigator.geolocation) return;
    setGeoLoading(true);
    navigator.geolocation.getCurrentPosition(position => {
      const found = { zip: 'current location', city: 'Your location', state: '', lat: position.coords.latitude, lng: position.coords.longitude };
      setOrigin(found);
      setOriginMode('near-me');
      const closest = nearestStations(stations, found, 1)[0];
      if (closest) setSelectedId(closest.id);
      setGeoLoading(false);
    }, () => setGeoLoading(false), { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
  }, [stations.length, autoLocateDone]);

  async function findZip(event) {
    event.preventDefault();
    setGeoLoading(true);
    setGeoError('');
    try {
      const found = await geocodeZip(zip);
      setOrigin(found);
      setOriginMode('zip');
      setQuery('');
      setStateFilter('All');
      const closest = nearestStations(stations, found, 1)[0];
      if (closest) setSelectedId(closest.id);
    } catch (error) { setGeoError(error.message || 'ZIP lookup failed.'); }
    finally { setGeoLoading(false); }
  }

  function useMyLocation() {
    setGeoLoading(true);
    setGeoError('');
    if (!navigator.geolocation) { setGeoError('Location is not available in this browser.'); setGeoLoading(false); return; }
    navigator.geolocation.getCurrentPosition(position => {
      const found = { zip: 'current location', city: 'Your location', state: '', lat: position.coords.latitude, lng: position.coords.longitude };
      setOrigin(found);
      setOriginMode('near-me');
      setQuery('');
      setStateFilter('All');
      const closest = nearestStations(stations, found, 1)[0];
      if (closest) setSelectedId(closest.id);
      setGeoLoading(false);
    }, error => { setGeoError(error.message || 'Location permission denied.'); setGeoLoading(false); }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 });
  }

  async function checkSelectedNow() {
    if (!selected?.id || manualCheck.status === 'loading') return;
    setManualCheck({ status: 'loading' });
    try {
      const response = await fetch(`/api/station-price?id=${encodeURIComponent(selected.id)}&t=${Date.now()}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      const json = await response.json();
      setManualCheck({ status: 'success', checkedAt: new Date().toISOString(), data: json });
    } catch (error) {
      setManualCheck({
        status: 'success',
        checkedAt: new Date().toISOString(),
        data: manualCheckFromCurrentData(selected, prediction, historyRows),
        note: 'Showing the newest data already loaded in this dashboard.'
      });
    }
  }

  const historyRows = useMemo(() => (Array.isArray(history) ? history : []).map(row => ({ ...row, capturedLabel: shortDate(row.capturedAt), member: row.memberPricePerKwh ?? null, nonMember: row.nonMemberPricePerKwh ?? null })).slice(-120), [history]);
  const modelRows = useMemo(() => Array.from({ length: 48 }, (_, slot) => {
    const rows = prediction?.slots || prediction?.hourly || [];
    const row = rows.find(item => Number(item.slot ?? (Number(item.hour) * 2 + (Number(item.minute || 0) >= 30 ? 1 : 0))) === slot);
    return { slot, slotLabel: slotLabel(slot), expectedPrice: row?.expectedPrice ?? null, ci95High: row?.ci95High ?? null, ci95Low: row?.ci95Low ?? null, sampleCount: row?.sampleCount ?? 0 };
  }), [prediction]);

  const memberPreds = predictions.filter(item => item.membershipType === 'member');
  const currentPreds = memberPreds.filter(isCurrentPrediction);
  const cheapest = [...currentPreds].sort((a, b) => a.expectedPrice - b.expectedPrice)[0];
  const pricedStations = new Set(predictions.map(item => item.stationId)).size;
  const currentStations = new Set(predictions.filter(isCurrentPrediction).map(item => item.stationId)).size;
  const coverage = coverageKpis(stations, predictions);
  const priceSummary = pricingStats(predictions);
  const currentPriceSummary = currentPricingStats(predictions);
  const state = priceState(selected, prediction);
  const pricingFresh = isCurrentPrediction(prediction);
  const latestHistory = historyRows.at(-1);
  const historyReadiness = usableHistoryState(prediction, historyRows);
  const manualData = manualCheck.data || null;
  const publicCheckResult = pricingFresh ? 'Recent price found' : prediction?.latestObservedAt ? 'Stale history only' : selected?.lastScrapeBlocked ? 'Automated check blocked' : selected?.lastScrapeHadAvailability ? 'Availability only' : selected?.lastScrapedAt ? 'No price shown' : 'Not checked yet';
  const siteDetails = selected?.lastSiteDetails || {};
  const lastCandidate = selected?.lastScrapeCandidates?.find(candidate => candidate.hasPrice || candidate.hasAvailability) || selected?.lastScrapeCandidates?.[0];
  const amenityList = Array.isArray(siteDetails.amenities) ? siteDetails.amenities : [];
  const chargerGeneration = siteDetails.chargerGeneration || (selected?.maxKw >= 320 ? 'V4 / high-power capable' : selected?.maxKw >= 250 ? 'V3 high-power' : selected?.maxKw ? `${selected.maxKw} kW class` : 'Power unknown');
  const availabilitySummary = latestHistory?.availabilityLabel
    ? `${titleCase(latestHistory.availabilityLabel)}${latestHistory.availableStalls != null ? ` · ${latestHistory.availableStalls}/${latestHistory.totalStalls || selected?.stalls || '—'} open` : ''}`
    : selected?.lastScrapeHadAvailability ? 'Availability showed up' : 'No availability shown';
  const commercialBenchmark = commercialBenchmarks[selected?.state];
  const memberCents = typeof latestHistory?.memberPricePerKwh === 'number' ? latestHistory.memberPricePerKwh * 100 : null;
  const nonTeslaCents = typeof latestHistory?.nonMemberPricePerKwh === 'number' ? latestHistory.nonMemberPricePerKwh * 100 : null;
  const rateMemberOff = latestHistory?.memberPricePerKwh ?? (pricingFresh ? prediction?.latestObservedPrice : null) ?? null;
  const rateMemberPeak = latestHistory?.memberPeakPricePerKwh ?? null;
  const rateNonOff = latestHistory?.nonMemberPricePerKwh ?? null;
  const rateNonPeak = latestHistory?.nonMemberPeakPricePerKwh ?? null;
  const rateCongestion = latestHistory?.congestionFeePerMinuteMax ?? null;
  const bestWindowSlot = prediction?.bestHour != null ? prediction.bestHour * 2 + (prediction.bestMinute >= 30 ? 1 : 0) : null;
  const bestWindowLabel = bestWindowSlot != null ? slotLabel(bestWindowSlot) : '—';
  const calcCurrentRate = (rateType === 'member' ? rateMemberOff : rateNonOff)
    ?? (pricingFresh ? prediction?.latestObservedPrice : null)
    ?? prediction?.averageObservedPrice ?? null;
  const calcCheapestRate = prediction?.expectedPrice ?? null;
  const calcRateLabel = rateType === 'member' ? 'Tesla / member' : 'Non-Tesla';
  const benchmarkCents = commercialBenchmark?.centsPerKwh ?? null;
  const memberVsBenchmark = memberCents && benchmarkCents ? memberCents / benchmarkCents : null;
  const nonTeslaVsBenchmark = nonTeslaCents && benchmarkCents ? nonTeslaCents / benchmarkCents : null;
  const memberSpreadCents = memberCents && benchmarkCents ? memberCents - benchmarkCents : null;
  const nonTeslaSpreadCents = nonTeslaCents && benchmarkCents ? nonTeslaCents - benchmarkCents : null;
  const priceSpreadCents = memberCents && nonTeslaCents ? nonTeslaCents - memberCents : null;
  const dashboardSummary = dashboardHealth?.summary || {
    checkedStations: coverage.checked,
    checkedPct: Number(coverage.checkedPct),
    pricedStations,
    pricedPct: stations.length ? Number((pricedStations / stations.length * 100).toFixed(2)) : 0,
    freshPriceStations: coverage.withPrice,
    staleOrUncheckedStations: stations.filter(station => !station.lastScrapedAt).length,
    priceChangeEvents: 0
  };
  const dashboardQueue = dashboardHealth?.improvementQueue || [];
  const dashboardTargets = dashboardHealth?.refreshTargets?.length ? dashboardHealth.refreshTargets : stations
    .filter(station => !station.lastScrapeHadPrice)
    .slice(0, 6)
    .map(station => ({ id: station.id, name: station.name || station.id, state: station.state || '', lastScrapeResult: station.lastScrapeResult || 'not_checked' }));
  const dashboardStates = dashboardHealth?.statePriorities || [];

  const darkStations = stations.length - pricedStations;
  const darkPct = stations.length ? Math.round(darkStations / stations.length * 100) : 100;
  const CROWDSOURCE_URL = "https://github.com/rike4545/CaughtaKWH/issues/new?template=price-report.yml";

  return <main className={isTesla ? 'tesla-mode' : isMobile ? 'mobile-mode' : ''}>
    {isTesla
      ? <header className="teslaHeader">
          <div className="eyebrow"><Zap size={16}/> CaughtaKWH</div>
          <p className="muted">{geoLoading ? 'Finding nearby chargers…' : origin ? `Showing chargers near ${origin.city || 'your location'}` : 'Finding chargers near you…'}</p>
        </header>
      : <header className="hero">
          <div>
            <div className="eyebrow"><Zap size={16}/> CaughtaKWH</div>
            <h1>EV charging prices should be public.</h1>
            <p>Tesla operates {stations.length.toLocaleString()} Supercharger stations across the United States. Pricing at <strong style={{color:"var(--text)"}}>{darkPct}% of them is hidden</strong> from the public — no posted rate, no advance disclosure. Gas stations post prices at the pump. Utilities publish rate schedules. EV charging should be no different.</p>
          </div>
          <div className="heroPanel">
            <strong>Why this matters</strong>
            <p>Without posted prices, drivers cannot comparison-shop, budget a trip, or hold operators accountable. CaughtaKWH scrapes Tesla's public pages, tracks what prices do appear, and compares them to local commercial electricity benchmarks — building the public record that Tesla has not provided.</p>
            <a className="crowdsourceLink" href={CROWDSOURCE_URL} target="_blank" rel="noreferrer"><Users size={15}/> Saw a price? Report it</a>
            <a className="crowdsourceLink" href={CONTRIBUTE_URL} target="_blank" rel="noreferrer"><Target size={15}/> Stations needing prices &amp; leaderboard</a>
          </div>
        </header>}

    {!isTesla && <nav className="viewTabs" aria-label="Dashboard views">
      <button className={activeView === 'chargers' ? 'active' : ''} onClick={() => setActiveView('chargers')}><Search size={17}/><span>Find chargers</span></button>
      <button className={activeView === 'transparency' ? 'active' : ''} onClick={() => setActiveView('transparency')}><Eye size={17}/><span>Transparency</span></button>
      <button className={activeView === 'health' ? 'active' : ''} onClick={() => setActiveView('health')}><Activity size={17}/><span>System health</span></button>
    </nav>}

    {(isTesla || activeView === 'chargers') && <>
      {!isTesla && <section className="statsGrid">
        <Stat icon={<MapPin/>} label="US Supercharger stations" value={stations.length.toLocaleString()} note={`${coverage.coordsPct}% with coordinates`} />
        <Stat icon={<EyeOff/>} label="Stations hiding price" value={`${darkPct}%`} note={`${darkStations.toLocaleString()} of ${stations.length.toLocaleString()} never shown publicly`} />
        <Stat icon={<Clock3/>} label="Prices captured" value={pricedStations} note={currentStations ? `${currentStations} current (under 2 hr)` : 'none current'} />
        <Stat icon={<TrendingDown/>} label="Lowest captured price" value={cheapest ? money(cheapest.expectedPrice) : '—'} note={cheapest?.stationId || 'no current prices'} />
      </section>}

      <section className="layout">
      <Card className="sidebar">
        <div className="nearbyBox betterNearby"><div><strong>Find chargers nearby</strong><small>Enter a ZIP or use your location to find the 5 closest chargers.</small></div><form onSubmit={findZip}><div className="zipRow"><input placeholder="ZIP code" value={zip} onChange={event => setZip(event.target.value)} inputMode="numeric" maxLength={5}/><button disabled={geoLoading}>Find 5</button></div></form><button className="nearMeButton" onClick={useMyLocation} disabled={geoLoading}><Compass size={18}/><span>{geoLoading ? 'Finding…' : 'Use my location'}</span><small>Closest 5</small></button>{origin && <small>{originMode === 'near-me' ? 'Showing the closest 5 chargers to you. This same area can be used for a focused refresh run.' : `Showing 5 chargers near ${origin.zip} — ${origin.city}, ${origin.state}. This ZIP can be used for a focused refresh run.`}</small>}{geoError && <small className="errorText"><AlertTriangle size={12}/> {geoError}</small>}{origin && <button className="linkButton" onClick={() => { setOrigin(null); setOriginMode('browse'); }}>Clear nearby mode</button>}</div>
        <label className="search"><Search size={16}/><input placeholder="Search station, city, state..." value={query} onChange={event => setQuery(event.target.value)} /></label>
        <select className="filter" value={stateFilter} onChange={event => setStateFilter(event.target.value)}>{states.map(state => <option key={state}>{state}</option>)}</select>
        <div className="stationList">{!origin && !hasFilter && <p className="muted listPrompt">Enter a ZIP, use your location, or search to find chargers.</p>}{list.map(station => {
          const pred = predictions.find(p => p.stationId === station.id && p.membershipType === 'member');
          const hasFresh = pred && isCurrentPrediction(pred);
          return <button key={station.id} className={station.id === selected?.id ? 'active' : ''} onClick={() => { setSelectedId(station.id); setTimeout(() => detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50); }}>
            <div className="stationRow"><strong>{station.name}</strong>{hasFresh && pred.latestObservedPrice != null && <em className="stationPrice">{money(pred.latestObservedPrice)}</em>}</div>
            <span>{station.distanceMiles !== undefined ? `${distance(station.distanceMiles)} • ` : ''}{station.address || [station.city, station.state].filter(Boolean).join(', ') || station.id}</span>
          </button>;
        })}</div>
      </Card>

      <div className="content" ref={detailRef}>
        <PriceTruthNotice selected={selected} prediction={prediction} />
        <Card>
          <div className="sectionTitle"><div><p>Selected charger</p><h2>{selected?.name || 'Pick a charger'}</h2></div>{selected?.url && <a href={selected.url}>Open Tesla page</a>}</div>
          <p className="muted">{selected?.address || 'We do not have the street address for this one yet.'}</p>
          <div className="toolbar"><button className={rateType === 'member' ? 'active' : ''} onClick={() => setRateType('member')}>Tesla / member</button><button className={rateType === 'non_member' ? 'active' : ''} onClick={() => setRateType('non_member')}>Non-Tesla</button><button className="refreshButton" onClick={checkSelectedNow} disabled={manualCheck.status === 'loading'}><RefreshCw size={16} className={manualCheck.status === 'loading' ? 'spin' : ''}/>{manualCheck.status === 'loading' ? 'Loading…' : 'Latest observation'}</button>{selected?.url && <a className="liveTeslaButton" href={selected.url}><ExternalLink size={16}/>Get live Tesla price</a>}{selected && <a className="reportPriceButton" href={reportUrl(selected.id)} target="_blank" rel="noreferrer"><Users size={16}/>Report this price</a>}<span className={pricingFresh ? 'badge fresh' : 'badge'}>{state.title}</span></div>
          <PriceMatrix memberOff={rateMemberOff} memberPeak={rateMemberPeak} nonOff={rateNonOff} nonPeak={rateNonPeak} congestion={rateCongestion} fresh={pricingFresh} benchmarkCents={benchmarkCents} observedAt={prediction?.latestObservedAt || latestHistory?.capturedAt} />
          <div className="priceStrip"><div><span>Last observed</span><strong>{prediction?.latestObservedAt ? freshnessLabel(prediction.latestObservedAt) : 'Never'}</strong><small>{prediction?.latestObservedAt ? `${shortDate(prediction.latestObservedAt)} · ${publicCheckResult}` : 'No public price yet'}</small></div><div><span>Best charging window</span><strong>{bestWindowLabel}</strong><small>{prediction ? 'cheapest expected time' : 'needs more data'}</small></div><div><span>How much to trust it</span><strong>{prediction?.confidenceLabel || 'Low'}</strong><small>{prediction?.confidenceScore != null ? `${prediction.confidenceScore}/100 · ${prediction.sampleCount} samples` : 'Needs more samples'}{prediction?.neuralModel?.status ? ` · NN ${prediction.neuralModel.status}${prediction.neuralModel.holdoutMae != null ? `, ${(prediction.neuralModel.holdoutMae * 100).toFixed(1)}¢ MAE` : ''}${prediction.neuralModel.historicalCapturesFlagged ? ` · ${prediction.neuralModel.historicalCapturesFlagged} capture flagged` : ''}` : ''}</small></div><div><span>Stalls and speed</span><strong>{selected?.stalls || '—'} stalls</strong><small>{selected?.maxKw ? `Up to ${selected.maxKw} kW` : selected?.capacityConfidence || 'capacity unknown'}</small></div></div>
          {manualCheck.status !== 'idle' && <div className={manualCheck.status === 'loading' ? 'manualCheck loading' : 'manualCheck'}>
            {manualCheck.status === 'loading'
              ? <><RefreshCw size={18} className="spin"/><div><strong>Loading the newest CaughtaKWH observation...</strong><p>This is not a live Tesla price check. Tesla is still the live source before you charge.</p></div></>
              : <><ShieldCheck size={18}/><div><strong>{manualData?.latestObservedAt ? `Newest CaughtaKWH observation loaded ${shortDate(manualCheck.checkedAt)}` : 'No CaughtaKWH price observation yet'}</strong><p>{manualData?.latestObservedAt ? `Tesla/member ${money(manualData.memberPricePerKwh)}${manualData.memberPeakPricePerKwh != null ? `–${money(manualData.memberPeakPricePerKwh)} peak` : ''}${manualData.nonMemberPricePerKwh != null ? ` · Non-Tesla ${money(manualData.nonMemberPricePerKwh)}${manualData.nonMemberPeakPricePerKwh != null ? `–${money(manualData.nonMemberPeakPricePerKwh)} peak` : ''}` : ''} · observed ${shortDate(manualData.latestObservedAt)}.` : 'CaughtaKWH has not captured a public price for this station yet.'} {manualCheck.note ? `${manualCheck.note} ` : ''}This is saved observation data, not a live Tesla quote. Check Tesla for the live in-car/app price.</p></div></>}
          </div>}
        </Card>

        <Card>
          <div className="sectionTitle"><div><p>Charger details</p><h2>{siteDetails.pageTitle || selected?.name || 'Supercharger details'}</h2></div><span className="badge">{selected?.lastScrapeResult ? scrapeResultLabel(selected.lastScrapeResult) : 'Found in directory'}</span></div>
          <div className="metaGrid siteMeta">
            <span>Location<strong>{selected?.address || [selected?.city, selected?.state].filter(Boolean).join(', ') || '—'}</strong></span>
            <span>Coordinates<strong>{coords(selected)}</strong></span>
            <span>Power class<strong>{chargerGeneration}</strong></span>
            <span>Estimated capacity<strong>{selected?.estimatedSiteKw ? `${selected.estimatedSiteKw.toLocaleString()} kW` : selected?.stalls && selected?.maxKw ? `${(selected.stalls * selected.maxKw).toLocaleString()} kW` : '—'}</strong></span>
            <span>Availability<strong>{availabilitySummary}</strong></span>
            <span>Utilization<strong>{percent(latestHistory?.utilizationPct)}</strong></span>
            <span>Last successful page<strong>{selected?.lastSuccessfulScrapeAt || (!selected?.lastScrapeBlocked && selected?.lastScrapedAt) ? shortDate(selected.lastSuccessfulScrapeAt || selected.lastScrapedAt) : 'None recorded'}</strong></span>
            <span>Last attempt<strong>{selected?.lastAttemptedAt || selected?.lastBlockedAt || selected?.lastScrapedAt ? `${shortDate(selected.lastAttemptedAt || selected.lastBlockedAt || selected.lastScrapedAt)}${selected?.lastScrapeResult ? ` · ${scrapeResultLabel(selected.lastScrapeResult).toLowerCase()}` : ''}` : 'Not checked'}</strong></span>
            <span>Page we tried<strong>{lastCandidate ? `${candidateLabel(lastCandidate.reason)} · ${lastCandidate.status || '—'}` : '—'}</strong></span>
            {selected?.dateOpened && <span>Opened<strong>{selected.dateOpened}</strong></span>}
            {selected?.facilityName && <span>At / near<strong>{selected.facilityName}</strong></span>}
            {selected?.superchargeInfoStatus && selected.superchargeInfoStatus !== 'OPEN' && <span>Network status<strong className="statusWarning">{selected.superchargeInfoStatus.replace(/_/g, ' ')}</strong></span>}
          </div>
          {(() => {
            const tags = [];
            if (selected?.otherEVs) tags.push('Open to non-Tesla EVs');
            if (selected?.solarCanopy) tags.push('Solar canopy');
            if (selected?.battery) tags.push('On-site battery');
            if (selected?.stallTypes) {
              const types = Object.entries(selected.stallTypes).filter(([k]) => k !== 'accessible').map(([k, v]) => `${v} ${k.toUpperCase()}`);
              if (types.length) tags.push(types.join(' + '));
            }
            if (selected?.plugTypes?.nacs && !selected?.plugTypes?.tpc) tags.push('NACS only');
            else if (selected?.plugTypes?.tpc && selected?.plugTypes?.nacs) tags.push('NACS + TPC');
            return tags.length ? <div className="amenityRow">{tags.map(t => <span key={t}>{t}</span>)}</div> : null;
          })()}
          {amenityList.length ? <div className="amenityRow">{amenityList.map(item => <span key={item}>{item}</span>)}</div> : null}
          <div className="scrapeDetail"><span>Page looked like: <strong>{lastCandidate ? signalLabel(lastCandidate.contentSignal) : '—'}</strong></span><span>Tries this round: <strong>{selected?.lastScrapeAttemptCount ?? selected?.lastScrapeCandidates?.length ?? '—'}</strong></span><span>Price-like numbers: <strong>{selected?.lastPriceCandidateCount ?? '—'}</strong></span><span>Hours hint: <strong>{siteDetails.accessHint || '—'}</strong></span></div>
        </Card>

        <Card>
          <div className="sectionTitle"><div><p>Pricing context</p><h2>What we can learn from this station</h2></div><span className="badge">US pilot</span></div>
          <p className="muted">CaughtaKWH can track price changes, member versus non-Tesla spread, congestion fees, volatility, and time-of-day movement once a Supercharger has repeated public observations. It cannot prove true supply-and-demand elasticity yet because Tesla does not expose session volume, queue length, or consistent stall occupancy history on the public page.</p>
          <div className="metaGrid siteMeta">
            <span>Tesla/member price<strong>{cents(memberCents)}/kWh</strong></span>
            <span>Non-Tesla price<strong>{cents(nonTeslaCents)}/kWh</strong></span>
            <span>Non-Tesla premium<strong>{priceSpreadCents != null ? `${signedCents(priceSpreadCents)}/kWh` : '—'}</strong></span>
            <span>Saved observations<strong>{historyRows.length}</strong></span>
            <span>Commercial benchmark<strong>{commercialBenchmark ? `${cents(benchmarkCents)}/kWh` : 'Add local benchmark'}</strong></span>
            <span>Benchmark period<strong>{commercialBenchmark ? commercialBenchmark.period : 'Coming state by state'}</strong></span>
            <span>Member vs benchmark<strong>{memberVsBenchmark ? `${memberVsBenchmark.toFixed(2)}x · ${signedCents(memberSpreadCents)}` : '—'}</strong></span>
            <span>Non-Tesla vs benchmark<strong>{nonTeslaVsBenchmark ? `${nonTeslaVsBenchmark.toFixed(2)}x · ${signedCents(nonTeslaSpreadCents)}` : '—'}</strong></span>
          </div>
          <p className="muted compactNote">{commercialBenchmark ? `${commercialBenchmark.label} is used as context only. It is not Tesla's site cost, and it does not include demand charges, rent, charger hardware, maintenance, taxes, or Tesla's pricing policy. ${commercialBenchmark.secondary}.` : 'Local utility context will be added state by state as we verify public commercial electricity benchmarks.'}</p>
          <div className="sourceLinks">
            {commercialBenchmark?.sourceUrl && <a href={commercialBenchmark.sourceUrl} target="_blank" rel="noreferrer">EIA benchmark</a>}
            {commercialBenchmark?.secondaryUrl && <a href={commercialBenchmark.secondaryUrl} target="_blank" rel="noreferrer">NYSERDA context</a>}
          </div>
          <div className="manualRefreshNote">
            <strong>Why some stations have better history</strong>
            <p>Stations become more useful after CaughtaKWH sees public prices a few different times. Until then, treat the trend as early context and check Tesla for the live price before charging.</p>
          </div>
        </Card>

        <Card>
          <div className="sectionTitle"><div><p>Usable price history</p><h2>{historyReadiness.label}</h2></div><span className={historyReadiness.tone === 'ok' ? 'badge fresh' : 'badge'}>{prediction?.sampleCount || 0} samples</span></div>
          <p className="muted">{historyReadiness.next}</p>
          <div className="historyReadiness">
            <span>Minimum usable<strong>{Math.min(Number(prediction?.sampleCount || 0), 3)}/3 observations</strong></span>
            <span>Stronger model<strong>{Math.min(Number(prediction?.sampleCount || 0), 10)}/10 observations</strong></span>
            <span>Freshness<strong>{prediction?.latestObservedAt ? freshnessLabel(prediction.latestObservedAt) : 'No public price yet'}</strong></span>
            <span>Current station<strong>{selected?.name || 'Pick a station'}</strong></span>
          </div>
          <p className="muted compactNote">CaughtaKWH keeps checking stations over time. A station needs at least three recent public price observations before its history becomes useful for trend watching.</p>
        </Card>

        <Card>{(() => {
          const priceVals = modelRows.map(r => r.expectedPrice).filter(v => v != null);
          const minPrice = priceVals.length ? Math.min(...priceVals) : 0;
          const maxPrice = priceVals.length ? Math.max(...priceVals) : 1;
          const getBarColor = v => {
            if (v == null) return 'rgba(255,255,255,.12)';
            const ratio = maxPrice === minPrice ? 0.5 : (v - minPrice) / (maxPrice - minPrice);
            if (ratio <= 0.33) return '#53e0a3';
            if (ratio <= 0.66) return '#ffd166';
            return '#ff8fa3';
          };
          const bestSlot = prediction?.bestHour != null ? prediction.bestHour * 2 + (prediction.bestMinute >= 30 ? 1 : 0) : null;
          return <>
            <div className="sectionTitle"><div><p>Cheaper times</p><h2>{prediction ? `Best window: ${slotLabel(bestSlot ?? 0)}` : 'Not enough prices yet'}</h2></div><span className="badge">Estimate range</span></div>
            <p className="muted">Green = cheaper, yellow = mid, red = pricier. Use this for planning, then check Tesla before you charge.</p>
            <ResponsiveContainer width="100%" height={260}><BarChart data={modelRows} barCategoryGap="10%"><CartesianGrid strokeDasharray="3 3" vertical={false}/><XAxis dataKey="slotLabel" interval={5} tick={{ fill: 'var(--muted)', fontSize: 12 }}/><YAxis tickFormatter={money} tick={{ fill: 'var(--muted)', fontSize: 12 }} width={48}/><Tooltip content={<ChartTooltip formatter={money}/>}/>{bestSlot != null && <ReferenceLine x={slotLabel(bestSlot)} stroke="#53e0a3" strokeDasharray="4 3" label={{ value: 'Best', fill: '#53e0a3', fontSize: 11 }}/>}<Bar dataKey="expectedPrice" name="Expected $/kWh" radius={[4,4,0,0]}>{modelRows.map((row, i) => <Cell key={i} fill={getBarColor(row.expectedPrice)}/>)}</Bar></BarChart></ResponsiveContainer>
          </>;
        })()}</Card>

        <ChargeCostCalculator
          currentPrice={calcCurrentRate}
          cheapestPrice={calcCheapestRate}
          cheapestLabel={bestWindowSlot != null ? bestWindowLabel : null}
          rateLabel={calcRateLabel}
          fresh={pricingFresh}
          congestion={rateCongestion}
        />

        <Card><div className="sectionTitle"><div><p>Price history</p><h2>{historyRows.length ? `${historyRows.length} recent checks` : 'No prices saved yet'}</h2></div><span className="badge">{historyRows.length ? shortDate(latestHistory?.capturedAt) : 'Waiting'}</span></div>{historyRows.length ? <ResponsiveContainer width="100%" height={260}><LineChart data={historyRows}><CartesianGrid strokeDasharray="3 3" vertical={false}/><XAxis dataKey="capturedLabel" hide/><YAxis tickFormatter={money} tick={{ fill: 'var(--muted)', fontSize: 12 }} width={48}/><Tooltip content={<ChartTooltip formatter={money}/>}/><Legend wrapperStyle={{ fontSize: 13, paddingTop: 8 }}/><Line type="monotone" dataKey="member" name="Tesla / member" dot={false} stroke="#53e0a3" strokeWidth={2}/><Line type="monotone" dataKey="nonMember" name="Non-Tesla" dot={false} stroke="#65a9ff" strokeWidth={2}/></LineChart></ResponsiveContainer> : <EmptyState title="No saved prices yet">We either have not checked this charger, or Tesla did not show a public price when we looked.</EmptyState>}</Card>
      </div>
    </section>

    {!isTesla && <section className="statsGrid bottomStats">
      <Stat icon={<ShieldCheck/>} label="Average recent price" value={currentPriceSummary.avg ? money(currentPriceSummary.avg) : '—'} note={`${currentPriceSummary.count} current rates · ${priceSummary.count} historical`} />
      <Stat icon={<BatteryCharging/>} label="Fresh public prices" value={currentStations} note={`observed within ${CURRENT_PRICE_MAX_HOURS} hr`} />
      <Stat icon={<Clock3/>} label="Data loaded" value={shortDate(stationsFetchedAt || predictionsFetchedAt)} note="browser refreshes periodically" />
      <Stat icon={<Zap/>} label="This charger" value={publicCheckResult} note="latest page check" />
    </section>}
    </>}

    {activeView === 'transparency' && <section className="transparencyView">
      <Card>
        <div className="sectionTitle"><div><p>Pricing transparency</p><h2>How much of the network is publicly priced?</h2></div><span className="badge">US Superchargers</span></div>
        <p className="muted">Regulated utilities are required to publish tariff schedules. Gas stations post pump prices by law in most states. There is currently no federal requirement for EV charging networks to disclose pricing before a session begins.</p>
        <div className="transparencyScorecard">
          <div className="scorecardStat dark"><EyeOff size={22}/><strong>{darkPct}%</strong><span>Stations with no public price on record</span></div>
          <div className="scorecardStat"><Eye size={22}/><strong>{100 - darkPct}%</strong><span>Stations where a public price has been observed</span></div>
          <div className="scorecardStat"><MapPin size={22}/><strong>{stations.length.toLocaleString()}</strong><span>Total US Supercharger stations tracked</span></div>
          <div className="scorecardStat"><Zap size={22}/><strong>{pricedStations}</strong><span>Stations with at least one captured price</span></div>
        </div>
        <div className="transparencyNote">
          <strong>What "hidden" means here</strong>
          <p>A station is dark if CaughtaKWH has never observed a $/kWh rate on its public Tesla page — either because Tesla does not display one, the page requires app login, or the automated check was blocked. It does not mean the station is closed or non-functional.</p>
        </div>
      </Card>

      <Card>
        <div className="sectionTitle"><div><p>What we know about pricing</p><h2>Tesla vs. commercial electricity rates by state</h2></div><a href="https://www.eia.gov/electricity/monthly/epm_table_grapher.php?lv=true&t=epmt_5_6_b" target="_blank" rel="noreferrer" className="badge">EIA source</a></div>
        <p className="muted">Where CaughtaKWH has observed prices, we compare them to the EIA commercial electricity rate for that state. Commercial rates are the closest public benchmark — they do not include Tesla's site costs, hardware, or margin, so they set a floor, not an equivalence.</p>
        <div className="benchmarkGrid">
          {Object.entries(commercialBenchmarks).map(([state, bm]) => {
            const stateStations = stations.filter(s => s.state === state).length;
            const statePriced = predictions.filter(p => { const s = stations.find(x => x.id === p.stationId); return s?.state === state && p.membershipType === 'member'; }).length;
            const statePred = predictions.find(p => { const s = stations.find(x => x.id === p.stationId); return s?.state === state && p.membershipType === 'member' && typeof p.latestObservedPrice === 'number'; });
            const observedCents = statePred ? statePred.latestObservedPrice * 100 : null;
            const multiple = observedCents ? (observedCents / bm.centsPerKwh).toFixed(1) : null;
            return <div key={state} className="benchmarkRow">
              <span className="benchmarkState">{state}</span>
              <span className="benchmarkUtil"><a href={bm.sourceUrl} target="_blank" rel="noreferrer">{cents(bm.centsPerKwh)}/kWh</a><small>{bm.period}</small></span>
              <span className="benchmarkObserved">{observedCents != null ? <>{cents(observedCents)}/kWh <em>{multiple}× utility</em></> : <span className="benchmarkDark"><EyeOff size={12}/> No public price</span>}</span>
              <span className="benchmarkCoverage">{stateStations} stations · {statePriced} priced</span>
            </div>;
          })}
        </div>
      </Card>

      <Card>
        <div className="sectionTitle"><div><p>Help grow the record</p><h2>Saw a price? Report it.</h2></div><span className="badge">Crowdsource</span></div>
        <p className="muted">Tesla shows live prices inside the car and app before you plug in. If you see a $/kWh rate at a Supercharger — on-screen, in the app, or on a posted sign — submit it here. Every report adds to the public record and helps hold pricing accountable.</p>
        <div className="crowdsourceActions">
          <a href={CROWDSOURCE_URL} target="_blank" rel="noreferrer" className="crowdsourceButton"><Users size={18}/><div><strong>Submit a price observation</strong><small>Opens a GitHub form — a bot validates it and adds it to the station's history within minutes</small></div></a>
          <div className="crowdsourceContext">
            <strong>What to include</strong>
            <ul>
              <li>Station name or city/state</li>
              <li>Tesla/member price ($/kWh)</li>
              <li>Non-Tesla price if shown</li>
              <li>Date and approximate time</li>
              <li>Where you saw it (app, screen, posted sign)</li>
            </ul>
          </div>
        </div>
        <p className="muted compactNote">Submitted prices are reviewed before being added to the dataset. CaughtaKWH does not collect personal information from reports.</p>
      </Card>

      <Card>
        <div className="sectionTitle"><div><p>The case for disclosure</p><h2>Why EV charging should post prices</h2></div></div>
        <div className="policyPoints">
          <div><strong>Drivers cannot budget without it</strong><p>A road trip cost estimate requires knowing the rate at each stop. Hidden pricing forces guesswork or app dependency before every charge.</p></div>
          <div><strong>Competition requires transparency</strong><p>Multiple charging networks now compete for EV drivers. Comparison shopping is only possible when prices are posted — the same standard applied to gas, parking, and tolls.</p></div>
          <div><strong>Regulators are catching up</strong><p>The 2021 Bipartisan Infrastructure Law required NEVI-funded stations to display pricing on-screen. Tesla accepted NEVI funding for select corridors, creating a partial but uneven disclosure obligation.</p></div>
          <div><strong>Utilities must disclose; chargers should too</strong><p>Your home electricity rate is a published tariff. Commercial and industrial rates are filed with state regulators. The energy sold at a Supercharger is the same commodity — the disclosure standard should match.</p></div>
        </div>
      </Card>

      <Card>
        <div className="sectionTitle"><div><p>State &amp; federal law</p><h2>Where EV price disclosure is legally required</h2></div><a href="https://afdc.energy.gov/laws/12511" target="_blank" rel="noreferrer" className="badge">AFDC source</a></div>
        <p className="muted">A growing number of states require EV charging stations to display prices before a session starts — similar to how gas pumps are required to post pump prices. Federal NEVI rules set a baseline for federally funded stations; some states go further.</p>
        <div className="lawGrid">
          {EV_PRICE_LAWS.map(law => <div key={law.state} className={`lawCard ${law.status}`}>
            <div className="lawCardHead">
              <span className="lawState">{law.state}</span>
              <span className={`lawStatus ${law.status}`}>{law.status === 'enacted' ? 'Enacted' : law.status === 'pending' ? 'Pending regs' : 'No law yet'}</span>
            </div>
            <p className="lawReq">{law.requirement}</p>
            {law.status !== 'none' && <div className="lawMeta">
              {law.scope && <span><strong>Scope</strong> {law.scope}</span>}
              {law.authority && <span><strong>Authority</strong> {law.authority}</span>}
              {law.effectiveDate && <span><strong>Effective</strong> {law.effectiveDate}</span>}
              {law.citation && <span><strong>Citation</strong> <em>{law.citation}</em></span>}
            </div>}
          </div>)}
        </div>
        <p className="muted compactNote">States not listed have no confirmed EV-charging-specific price disclosure mandate. General consumer protection laws may apply but are not included here. Data reflects laws as of June 2026 — check your state legislature for updates.</p>
      </Card>
    </section>}

    {activeView === 'health' && <section className="healthView">
      <Card className="dashboardPulse">
        <div className="sectionTitle"><div><p>Dashboard pulse</p><h2>The system is learning in public</h2></div><span className="badge">{dashboardHealth?.generatedAt ? `Updated ${shortDate(dashboardHealth.generatedAt)}` : 'Building feed'}</span></div>
        <div className="pulseGrid">
          <div><Activity size={20}/><span>Coverage</span><strong>{dashboardSummary.checkedPct}% checked</strong><small>{dashboardSummary.checkedStations?.toLocaleString?.() || dashboardSummary.checkedStations || 0} of {stations.length.toLocaleString()} US stations have had a page pass.</small></div>
          <div><Target size={20}/><span>Usable history</span><strong>{dashboardSummary.usableHistoryPct ?? dashboardSummary.pricedPct}% usable</strong><small>{stationCountText(dashboardSummary.usableHistoryStations ?? dashboardSummary.pricedStations ?? pricedStations)} usable price history. Repeated observations make the cheaper-window view better.</small></div>
          <div><RefreshCw size={20}/><span>Automation</span><strong>Daily improvement loop</strong><small>Scraper runs stay staggered, while the dashboard bot refreshes this health feed and the public copy from real data.</small></div>
        </div>
      </Card>

      <section className="dashboardOps">
        <Card>
          <div className="sectionTitle"><div><p>Improvement loop</p><h2>What gets better next</h2></div><span className="badge">{dashboardSummary.priceChangeEvents || 0} price changes tracked</span></div>
          <div className="improvementList">{(dashboardQueue.length ? dashboardQueue : [
            { title: 'Grow repeated observations', status: 'needs_data', detail: 'Keep the pilot lane focused on stations where Tesla exposes public pricing.' },
            { title: 'Keep fresh data visible', status: 'active', detail: 'Show freshness loudly so the dashboard never pretends old public data is live pricing.' },
            { title: 'Add local power context state by state', status: 'next', detail: 'Only add a benchmark when the source and period are clear.' }
          ]).map(item => <div key={item.title}><span>{statusText(item.status)}</span><strong>{item.title}</strong><p>{item.detail}</p></div>)}</div>
        </Card>
        <Card>
          <div className="sectionTitle"><div><p>Refresh priorities</p><h2>Where the automation points next</h2></div><span className="badge">{dashboardSummary.staleOrUncheckedStations || 0} stale or unchecked</span></div>
          <p className="muted">Tesla pages can be slow because each candidate gets a render and wait pass. The scheduled jobs keep the work spread out and favor stations that can improve pricing confidence.</p>
          <div className="priorityColumns">
            <div><strong>Station targets</strong>{dashboardTargets.slice(0, 6).map(station => <span key={station.id}>{station.name}<small>{station.state || 'US'} · {scrapeResultLabel(station.lastScrapeResult)}</small></span>)}</div>
            <div><strong>State queue</strong>{dashboardStates.slice(0, 6).map(stateRow => <span key={stateRow.state}>{stateRow.state}<small>{stateRow.stale} stale/unchecked · {stateRow.pricedPct}% priced</small></span>)}{!dashboardStates.length && <span>US pilot<small>State priorities appear after the dashboard bot runs.</small></span>}</div>
          </div>
        </Card>
      </section>
    </section>}
  </main>;
}

// Reuse a single root across HMR reloads so the dev server doesn't warn about
// calling createRoot() twice on the same container.
const container = document.getElementById('root');
const root = (window.__caughtaRoot ??= createRoot(container));
root.render(<App />);
