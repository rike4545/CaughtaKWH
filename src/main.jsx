import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Activity, AlertTriangle, BatteryCharging, Clock3, Compass, ExternalLink, MapPin, Navigation, RefreshCw, Search, ShieldCheck, Target, TrendingDown, Zap } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { geocodeZip, nearestStations } from './zipSearch.js';
import { coverageKpis, currentPricingStats, isCurrentPrediction, pricingStats } from './kpis.js';
import './styles.css';

const CURRENT_PRICE_MAX_HOURS = 2;
const money = value => typeof value === 'number' ? `$${value.toFixed(2)}` : '—';
const cents = value => typeof value === 'number' ? `${value.toFixed(value % 1 ? 2 : 0)}¢` : '—';
const signedCents = value => typeof value === 'number' ? `${value >= 0 ? '+' : '-'}${cents(Math.abs(value))}` : '—';
const shortDate = iso => iso ? new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
const distance = miles => typeof miles === 'number' ? `${miles.toFixed(miles < 10 ? 1 : 0)} mi` : '';
const slotLabel = slot => `${String(Math.floor(slot / 2)).padStart(2, '0')}:${slot % 2 === 0 ? '00' : '30'}`;
const wrapSlot = slot => (slot + 48) % 48;
const ageText = hours => typeof hours === 'number' ? hours < 1 ? `${Math.round(hours * 60)} min old` : `${hours.toFixed(hours < 10 ? 1 : 0)} hr old` : 'No public price yet';
const percent = value => typeof value === 'number' ? `${Math.round(value * 100)}%` : '—';
const coords = station => typeof station?.lat === 'number' && typeof station?.lng === 'number' ? `${station.lat.toFixed(4)}, ${station.lng.toFixed(4)}` : '—';
const titleCase = value => String(value || '—').replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
const scrapeResultLabel = value => ({
  price_found: 'Price found',
  availability_found: 'Availability found',
  valid_page_no_public_data: 'Page loaded, price hidden',
  no_usable_candidate: 'Page check needs another pass'
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
const commercialBenchmarks = {
  NY: {
    centsPerKwh: 22.21,
    label: 'NY commercial average',
    period: 'EIA March 2026',
    secondary: 'NYSERDA February 2026: 23.5¢/kWh',
    sourceUrl: 'https://www.eia.gov/electricity/monthly/epm_table_grapher.php?lv=true&t=epmt_5_6_a',
    secondaryUrl: 'https://www.nyserda.ny.gov/Energy-Prices/Electricity/Monthly-Avg-Electricity-Commercial'
  }
};

function useJson(url, fallback, refreshMs = 300000) {
  const [data, setData] = useState(fallback);
  const [error, setError] = useState(null);
  const [fetchedAt, setFetchedAt] = useState(null);
  useEffect(() => {
    let live = true;
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
        .catch(error => live && setError(error.message));
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
    nonMemberPricePerKwh: latest?.nonMemberPricePerKwh ?? null,
    confidence: prediction?.confidenceLabel || 'last saved',
    historyCount: rows.length,
    currentTeslaPriceGuaranteed: false
  };
}

function priceState(selected, prediction) {
  if (prediction?.latestObservedAt) {
    const current = isCurrentPrediction(prediction);
    return {
      title: current ? 'Recent Tesla public price observed' : 'Stale historical price only',
      tone: current ? 'ok' : 'warn',
      detail: `${money(prediction.latestObservedPrice)} last observed ${shortDate(prediction.latestObservedAt)} · ${ageText(prediction.latestObservationAgeHours)}. ${current ? 'Treat this as recently observed, but still verify in Tesla before charging.' : `Older than ${CURRENT_PRICE_MAX_HOURS} hours, so CaughtaKWH keeps it as history instead of showing it as the current Tesla price.`}`
    };
  }
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

function App() {
  const { data: stations, fetchedAt: stationsFetchedAt } = useJson('./data/stations.json', []);
  const { data: predictions, fetchedAt: predictionsFetchedAt } = useJson('./data/predictions.json', []);
  const { data: dashboardHealth } = useJson('./data/dashboard-health.json', null);
  const [query, setQuery] = useState('');
  const [stateFilter, setStateFilter] = useState('All');
  const [rateType, setRateType] = useState('member');
  const [selectedId, setSelectedId] = useState('LakeGroveNYsupercharger');
  const [zip, setZip] = useState('');
  const [origin, setOrigin] = useState(null);
  const [originMode, setOriginMode] = useState('browse');
  const [geoError, setGeoError] = useState('');
  const [geoLoading, setGeoLoading] = useState(false);
  const [activeView, setActiveView] = useState('chargers');
  const [manualCheck, setManualCheck] = useState({ status: 'idle' });

  const selected = stations.find(station => station.id === selectedId) || stations[0];
  const { data: history } = useJson(selected?.id ? `./data/history/${selected.id}.json` : './data/history/none.json', []);
  const prediction = predictions.find(item => item.stationId === selected?.id && item.membershipType === rateType) || predictions.find(item => item.stationId === selected?.id);

  useEffect(() => {
    setManualCheck({ status: 'idle' });
  }, [selected?.id]);

  const states = useMemo(() => ['All', ...Array.from(new Set(stations.map(station => station.state).filter(Boolean))).sort()], [stations]);
  const nearbyLimit = originMode === 'near-me' ? 5 : originMode === 'zip' ? 25 : 0;
  const nearbyList = useMemo(() => origin ? nearestStations(stations, origin, nearbyLimit || 25) : [], [stations, origin, nearbyLimit]);
  const filtered = useMemo(() => {
    const normalized = query.toLowerCase().trim();
    return stations.filter(station => {
      const matchesState = stateFilter === 'All' || station.state === stateFilter;
      const text = [station.name, station.city, station.state, station.address, station.id].filter(Boolean).join(' ').toLowerCase();
      return matchesState && (!normalized || text.includes(normalized));
    });
  }, [stations, query, stateFilter]);
  const list = origin ? nearbyList : filtered;

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
  const publicCheckResult = pricingFresh ? 'Recent price found' : prediction?.latestObservedAt ? 'Stale history only' : selected?.lastScrapeHadAvailability ? 'Availability only' : selected?.lastScrapedAt ? 'No price shown' : 'Not checked yet';
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

  return <main>
    <header className="hero">
      <div><div className="eyebrow"><Zap size={16}/> CaughtaKWH</div><h1>Check the charger before you roll up.</h1><p>Starting with United States Superchargers while we harden the scraper. Find nearby sites, see what Tesla’s public pages are willing to show, and spot cheaper windows from prices we have seen before.</p></div>
      <div className="heroPanel"><strong>Use this as your early look</strong><p>Tesla’s app or your car is still the live price. CaughtaKWH is US-first for now; Canada and Mexico come next once the scraper is fully steady.</p></div>
    </header>

    <nav className="viewTabs" aria-label="Dashboard views">
      <button className={activeView === 'chargers' ? 'active' : ''} onClick={() => setActiveView('chargers')}><Search size={17}/><span>Find chargers</span></button>
      <button className={activeView === 'health' ? 'active' : ''} onClick={() => setActiveView('health')}><Activity size={17}/><span>System health</span></button>
    </nav>

    {activeView === 'chargers' && <>
      <section className="statsGrid">
        <Stat icon={<MapPin/>} label="US stations found" value={stations.length} note={`${coverage.coordsPct}% with coordinates`} />
        <Stat icon={<Navigation/>} label={originMode === 'near-me' ? 'Closest near you' : originMode === 'zip' ? 'Closest near ZIP' : 'Nearby mode'} value={origin ? nearbyList.length : '—'} note={origin ? `${origin.city}${origin.state ? ', ' + origin.state : ''}` : 'off'} />
        <Stat icon={<Clock3/>} label="Fresh price coverage" value={currentStations} note={`${pricedStations} have price history`} />
        <Stat icon={<TrendingDown/>} label="Lowest recent price" value={cheapest ? money(cheapest.expectedPrice) : '—'} note={cheapest?.stationId || 'no prices under 2 hr old'} />
      </section>

      <section className="layout">
      <Card className="sidebar">
        <div className="nearbyBox betterNearby"><div><strong>Find chargers nearby</strong><small>Use a ZIP for a wider search, or your location for the closest handful. Your location only sorts the list.</small></div><form onSubmit={findZip}><div className="zipRow"><input placeholder="ZIP code" value={zip} onChange={event => setZip(event.target.value)} inputMode="numeric" maxLength={5}/><button disabled={geoLoading}>Find 25</button></div></form><button className="nearMeButton" onClick={useMyLocation} disabled={geoLoading}><Compass size={18}/><span>{geoLoading ? 'Finding…' : 'Use my location'}</span><small>Closest 5</small></button>{origin && <small>{originMode === 'near-me' ? 'Showing the closest 5 chargers to you. This same area can be used for a focused refresh run.' : `Showing 25 chargers near ${origin.zip} — ${origin.city}, ${origin.state}. This ZIP can be used for a focused refresh run.`}</small>}{geoError && <small className="errorText"><AlertTriangle size={12}/> {geoError}</small>}{origin && <button className="linkButton" onClick={() => { setOrigin(null); setOriginMode('browse'); }}>Clear nearby mode</button>}</div>
        <label className="search"><Search size={16}/><input placeholder="Search station, city, state..." value={query} onChange={event => setQuery(event.target.value)} /></label>
        <select className="filter" value={stateFilter} onChange={event => setStateFilter(event.target.value)}>{states.map(state => <option key={state}>{state}</option>)}</select>
        <div className="stationList">{list.map(station => {
          const pred = predictions.find(p => p.stationId === station.id && p.membershipType === 'member');
          const hasFresh = pred && isCurrentPrediction(pred);
          return <button key={station.id} className={station.id === selected?.id ? 'active' : ''} onClick={() => setSelectedId(station.id)}>
            <div className="stationRow"><strong>{station.name}</strong>{hasFresh && pred.latestObservedPrice != null && <em className="stationPrice">{money(pred.latestObservedPrice)}</em>}</div>
            <span>{station.distanceMiles !== undefined ? `${distance(station.distanceMiles)} • ` : ''}{station.address || [station.city, station.state].filter(Boolean).join(', ') || station.id}</span>
          </button>;
        })}</div>
      </Card>

      <div className="content">
        <PriceTruthNotice selected={selected} prediction={prediction} />
        <Card>
          <div className="sectionTitle"><div><p>Selected charger</p><h2>{selected?.name || 'Pick a charger'}</h2></div>{selected?.url && <a href={selected.url} target="_blank" rel="noreferrer">Open Tesla page</a>}</div>
          <p className="muted">{selected?.address || 'We do not have the street address for this one yet.'}</p>
          <div className="toolbar"><button className={rateType === 'member' ? 'active' : ''} onClick={() => setRateType('member')}>Tesla / member</button><button className={rateType === 'non_member' ? 'active' : ''} onClick={() => setRateType('non_member')}>Non-Tesla</button><button className="refreshButton" onClick={checkSelectedNow} disabled={manualCheck.status === 'loading'}><RefreshCw size={16} className={manualCheck.status === 'loading' ? 'spin' : ''}/>{manualCheck.status === 'loading' ? 'Loading…' : 'Latest observation'}</button>{selected?.url && <a className="liveTeslaButton" href={selected.url} target="_blank" rel="noreferrer"><ExternalLink size={16}/>Get live Tesla price</a>}<span className={pricingFresh ? 'badge fresh' : 'badge'}>{state.title}</span></div>
          <div className="priceStrip"><div className={pricingFresh ? 'fresh' : ''}><span>What Tesla showed us</span><strong>{pricingFresh ? money(prediction?.latestObservedPrice) : prediction?.latestObservedAt ? 'Stale' : 'Hidden'}</strong><small>{pricingFresh ? `${shortDate(prediction.latestObservedAt)} · ${ageText(prediction.latestObservationAgeHours)}` : publicCheckResult}</small></div><div><span>Last price we saw</span><strong>{money(prediction?.latestObservedPrice)}</strong><small>{prediction?.latestObservedAt ? `${freshnessLabel(prediction.latestObservedAt)} · historical only` : 'No price history yet'}</small></div><div><span>How much to trust it</span><strong>{prediction?.confidenceLabel ? `${prediction.confidenceLabel}` : 'Low'}</strong><small>{prediction?.confidenceScore != null ? `${prediction.confidenceScore}/100 · ${prediction.sampleCount} samples` : 'Needs more samples'}</small></div><div><span>Stalls and speed</span><strong>{selected?.stalls || '—'} stalls</strong><small>{selected?.maxKw ? `Up to ${selected.maxKw} kW` : selected?.capacityConfidence || 'capacity unknown'}</small></div></div>
          {manualCheck.status !== 'idle' && <div className={manualCheck.status === 'loading' ? 'manualCheck loading' : 'manualCheck'}>
            {manualCheck.status === 'loading'
              ? <><RefreshCw size={18} className="spin"/><div><strong>Loading the newest CaughtaKWH observation...</strong><p>This is not a live Tesla price check. Tesla is still the live source before you charge.</p></div></>
              : <><ShieldCheck size={18}/><div><strong>{manualData?.latestObservedAt ? `Newest CaughtaKWH observation loaded ${shortDate(manualCheck.checkedAt)}` : 'No CaughtaKWH price observation yet'}</strong><p>{manualData?.latestObservedAt ? `Tesla/member ${money(manualData.memberPricePerKwh)}${manualData.nonMemberPricePerKwh != null ? ` · Non-Tesla ${money(manualData.nonMemberPricePerKwh)}` : ''} · observed ${shortDate(manualData.latestObservedAt)}.` : 'CaughtaKWH has not captured a public price for this station yet.'} {manualCheck.note ? `${manualCheck.note} ` : ''}This is saved observation data, not a live Tesla quote. Check Tesla for the live in-car/app price.</p></div></>}
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
            <span>Last page check<strong>{selected?.lastScrapedAt ? shortDate(selected.lastScrapedAt) : 'Not checked'}</strong></span>
            <span>Page we tried<strong>{lastCandidate ? `${candidateLabel(lastCandidate.reason)} · ${lastCandidate.status || '—'}` : '—'}</strong></span>
          </div>
          {amenityList.length ? <div className="amenityRow">{amenityList.map(item => <span key={item}>{item}</span>)}</div> : <p className="muted compactNote">Tesla did not list amenities on the page we checked.</p>}
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
          <p className="muted compactNote">{commercialBenchmark ? `${commercialBenchmark.label} is used as context only. It is not Tesla’s site cost, and it does not include demand charges, rent, charger hardware, maintenance, taxes, or Tesla’s pricing policy. ${commercialBenchmark.secondary}.` : 'Local utility context will be added state by state as we verify public commercial electricity benchmarks.'}</p>
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

        <Card><div className="sectionTitle"><div><p>Price history</p><h2>{historyRows.length ? `${historyRows.length} recent checks` : 'No prices saved yet'}</h2></div><span className="badge">{historyRows.length ? shortDate(latestHistory?.capturedAt) : 'Waiting'}</span></div>{historyRows.length ? <ResponsiveContainer width="100%" height={260}><LineChart data={historyRows}><CartesianGrid strokeDasharray="3 3" vertical={false}/><XAxis dataKey="capturedLabel" hide/><YAxis tickFormatter={money} tick={{ fill: 'var(--muted)', fontSize: 12 }} width={48}/><Tooltip content={<ChartTooltip formatter={money}/>}/><Legend wrapperStyle={{ fontSize: 13, paddingTop: 8 }}/><Line type="monotone" dataKey="member" name="Tesla / member" dot={false} stroke="#53e0a3" strokeWidth={2}/><Line type="monotone" dataKey="nonMember" name="Non-Tesla" dot={false} stroke="#65a9ff" strokeWidth={2}/></LineChart></ResponsiveContainer> : <EmptyState title="No saved prices yet">We either have not checked this charger, or Tesla did not show a public price when we looked.</EmptyState>}</Card>
      </div>
    </section>

    <section className="statsGrid bottomStats">
      <Stat icon={<ShieldCheck/>} label="Average recent price" value={currentPriceSummary.avg ? money(currentPriceSummary.avg) : '—'} note={`${currentPriceSummary.count} current rates · ${priceSummary.count} historical`} />
      <Stat icon={<BatteryCharging/>} label="Fresh public prices" value={currentStations} note={`observed within ${CURRENT_PRICE_MAX_HOURS} hr`} />
      <Stat icon={<Clock3/>} label="Data loaded" value={shortDate(stationsFetchedAt || predictionsFetchedAt)} note="browser refreshes periodically" />
      <Stat icon={<Zap/>} label="This charger" value={publicCheckResult} note="latest page check" />
    </section>
    </>}

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

createRoot(document.getElementById('root')).render(<App />);
