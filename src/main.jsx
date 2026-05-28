import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AlertTriangle, BatteryCharging, Clock3, Compass, MapPin, Navigation, Search, TrendingDown, Zap } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { geocodeZip, nearestStations } from './zipSearch.js';
import { coverageKpis, pricingStats, scrapeOutcome, topStates } from './kpis.js';
import './styles.css';

const money = value => typeof value === 'number' ? `$${value.toFixed(2)}` : '—';
const percent = value => typeof value === 'number' ? `${Math.round(value)}%` : '—';
const slotLabel = slot => `${String(Math.floor(slot / 2)).padStart(2, '0')}:${slot % 2 === 0 ? '00' : '30'}`;
const wrapSlot = slot => (slot + 48) % 48;
const shortDate = iso => iso ? new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
const distance = miles => typeof miles === 'number' ? `${miles.toFixed(miles < 10 ? 1 : 0)} mi` : '';

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
    return () => {
      live = false;
      if (timer) window.clearInterval(timer);
    };
  }, [url, refreshMs]);

  return { data, error, fetchedAt };
}

function Card({ children, className = '' }) {
  return <section className={`card ${className}`}>{children}</section>;
}

function Stat({ icon, label, value, note }) {
  return <Card className="stat"><div className="statIcon">{icon}</div><div><p>{label}</p><strong>{value}</strong>{note && <small>{note}</small>}</div></Card>;
}

function EmptyState({ title, children }) {
  return <div className="empty"><AlertTriangle size={18}/><div><strong>{title}</strong><p>{children}</p></div></div>;
}

function PriceTruthNotice({ selected, prediction }) {
  const hasObservation = Boolean(prediction?.latestObservedAt || selected?.lastScrapeHadPrice);
  return <div className={hasObservation ? 'truthNotice ok' : 'truthNotice'}>
    <strong>{hasObservation ? 'Last observed pricing' : 'Current Tesla price not visible yet'}</strong>
    <p>{hasObservation
      ? 'CaughtaKWH stores the last observed public price and refreshes it on a schedule. Tesla can still change prices at any time, so verify in Tesla before charging.'
      : 'Tesla does not always expose current $/kWh pricing in public page text. The scraper now records diagnostics instead of pretending missing data is live pricing.'}</p>
  </div>;
}

function App() {
  const { data: stations, fetchedAt: stationsFetchedAt } = useJson('./data/stations.json', []);
  const { data: predictions, fetchedAt: predictionsFetchedAt } = useJson('./data/predictions.json', []);
  const [query, setQuery] = useState('');
  const [stateFilter, setStateFilter] = useState('All');
  const [rateType, setRateType] = useState('member');
  const [selectedId, setSelectedId] = useState('LakeGroveNYsupercharger');
  const [zip, setZip] = useState('');
  const [origin, setOrigin] = useState(null);
  const [originMode, setOriginMode] = useState('browse');
  const [geoError, setGeoError] = useState('');
  const [geoLoading, setGeoLoading] = useState(false);

  const selected = stations.find(station => station.id === selectedId) || stations[0];
  const { data: history, error: historyError } = useJson(selected?.id ? `./data/history/${selected.id}.json` : './data/history/none.json', []);
  const prediction = predictions.find(item => item.stationId === selected?.id && item.membershipType === rateType) || predictions.find(item => item.stationId === selected?.id);

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
    } catch (error) {
      setGeoError(error.message || 'ZIP lookup failed.');
    } finally {
      setGeoLoading(false);
    }
  }

  function useMyLocation() {
    setGeoLoading(true);
    setGeoError('');
    if (!navigator.geolocation) {
      setGeoError('Location is not available in this browser.');
      setGeoLoading(false);
      return;
    }

    navigator.geolocation.getCurrentPosition(position => {
      const found = {
        zip: 'current location',
        city: 'Your location',
        state: '',
        lat: position.coords.latitude,
        lng: position.coords.longitude
      };
      setOrigin(found);
      setOriginMode('near-me');
      setQuery('');
      setStateFilter('All');
      const closest = nearestStations(stations, found, 1)[0];
      if (closest) setSelectedId(closest.id);
      setGeoLoading(false);
    }, error => {
      setGeoError(error.message || 'Location permission denied.');
      setGeoLoading(false);
    }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 });
  }

  const historyRows = useMemo(() => (Array.isArray(history) ? history : []).map(row => ({
    ...row,
    capturedLabel: shortDate(row.capturedAt),
    member: row.memberPricePerKwh ?? null,
    nonMember: row.nonMemberPricePerKwh ?? null
  })).slice(-120), [history]);

  const slotRows = useMemo(() => {
    const rows = prediction?.slots || prediction?.hourly || [];
    const bySlot = new Map(rows.map(row => [Number(row.slot ?? (Number(row.hour) * 2 + (Number(row.minute || 0) >= 30 ? 1 : 0))), row]));
    const anchor = Number.isFinite(prediction?.bestSlot) ? Number(prediction.bestSlot) : new Date().getHours() * 2 + (new Date().getMinutes() >= 30 ? 1 : 0);
    const start = wrapSlot(anchor - 11);
    return Array.from({ length: 24 }, (_, index) => {
      const slot = wrapSlot(start + index);
      const row = bySlot.get(slot);
      return { slot, slotLabel: slotLabel(slot), expectedPrice: row?.expectedPrice ?? null, hasObservation: Boolean(row), sampleCount: row?.sampleCount ?? 0 };
    });
  }, [prediction]);

  const modelRows = useMemo(() => Array.from({ length: 48 }, (_, slot) => {
    const rows = prediction?.slots || prediction?.hourly || [];
    const row = rows.find(item => Number(item.slot ?? (Number(item.hour) * 2 + (Number(item.minute || 0) >= 30 ? 1 : 0))) === slot);
    return { slot, slotLabel: slotLabel(slot), expectedPrice: row?.expectedPrice ?? null, ci95High: row?.ci95High ?? null, ci95Low: row?.ci95Low ?? null, sampleCount: row?.sampleCount ?? 0 };
  }), [prediction]);

  const memberPreds = predictions.filter(item => item.membershipType === 'member');
  const cheapest = [...memberPreds].sort((a, b) => a.expectedPrice - b.expectedPrice)[0];
  const pricedStations = new Set(predictions.map(item => item.stationId)).size;
  const coverage = coverageKpis(stations, predictions);
  const priceSummary = pricingStats(predictions);
  const stateChart = topStates(stations, 12);
  const scrapeChart = scrapeOutcome(stations);
  const latestHistory = historyRows.at(-1);
  const pricingFresh = latestHistory?.capturedAt ? ((Date.now() - new Date(latestHistory.capturedAt).getTime()) / 36e5) < 24 : false;
  const scrapeStatus = selected?.lastScrapeError
    ? selected.lastScrapeError
    : selected?.lastScrapedAt
      ? selected.lastScrapeHadPrice
        ? 'Latest scrape found public pricing text.'
        : selected.lastScrapeHadAvailability
          ? 'Latest scrape found availability, but no public price.'
          : 'Latest scrape did not find public pricing or availability text.'
      : 'Not scraped yet.';

  return <main>
    <header className="hero">
      <div><div className="eyebrow"><Zap size={16}/> CaughtaKWH</div><h1>Know before you plug in.</h1><p>Find nearby Superchargers, track last observed public pricing, and watch how coverage improves as the refresh bots collect more observations.</p></div>
      <div className="heroPanel"><strong>Dynamic pricing disclaimer</strong><p>Tesla prices can change dynamically. CaughtaKWH shows last observed public pricing and confidence from observations; always verify in Tesla before relying on a price.</p></div>
    </header>

    <section className="statsGrid">
      <Stat icon={<MapPin/>} label="Stations discovered" value={stations.length} note={`${coverage.coordsPct}% with coordinates`} />
      <Stat icon={<Navigation/>} label={originMode === 'near-me' ? 'Closest near you' : originMode === 'zip' ? 'Closest near ZIP' : 'Nearby mode'} value={origin ? nearbyList.length : '—'} note={origin ? `${origin.city}${origin.state ? ', ' + origin.state : ''}` : 'off'} />
      <Stat icon={<Clock3/>} label="Pricing coverage" value={`${coverage.pricedPct}%`} note={`${pricedStations} stations modeled`} />
      <Stat icon={<TrendingDown/>} label="Lowest known estimate" value={cheapest ? money(cheapest.expectedPrice) : '—'} note={cheapest?.stationId} />
    </section>

    <section className="layout">
      <Card className="sidebar">
        <div className="nearbyBox betterNearby">
          <div><strong>Nearby Superchargers</strong><small>Use location for closest 5, or ZIP for closest 25.</small></div>
          <button className="nearMeButton" onClick={useMyLocation} disabled={geoLoading}><Compass size={18}/><span>{geoLoading ? 'Finding…' : 'Use my location'}</span><small>Closest 5</small></button>
          <form onSubmit={findZip}><div className="zipRow"><input placeholder="ZIP code" value={zip} onChange={event => setZip(event.target.value)} inputMode="numeric" maxLength={5}/><button disabled={geoLoading}>Find 25</button></div></form>
          {origin && <small>{originMode === 'near-me' ? 'Showing closest 5 near your current location.' : `Showing closest 25 near ${origin.zip} — ${origin.city}, ${origin.state}`}</small>}
          {geoError && <small className="errorText"><AlertTriangle size={12}/> {geoError}</small>}
          {origin && <button className="linkButton" onClick={() => { setOrigin(null); setOriginMode('browse'); }}>Clear nearby mode</button>}
        </div>

        <label className="search"><Search size={16}/><input placeholder="Search station, city, state..." value={query} onChange={event => setQuery(event.target.value)} /></label>
        <select className="filter" value={stateFilter} onChange={event => setStateFilter(event.target.value)}>{states.map(state => <option key={state}>{state}</option>)}</select>
        <div className="stationList">{list.map(station => <button key={station.id} className={station.id === selected?.id ? 'active' : ''} onClick={() => setSelectedId(station.id)}><strong>{station.name}</strong><span>{station.distanceMiles !== undefined ? `${distance(station.distanceMiles)} • ` : ''}{station.address || [station.city, station.state].filter(Boolean).join(', ') || station.id}</span></button>)}</div>
      </Card>

      <div className="content">
        <PriceTruthNotice selected={selected} prediction={prediction} />

        <Card>
          <div className="sectionTitle"><div><p>Selected station</p><h2>{selected?.name || 'No station selected'}</h2></div>{selected?.url && <a href={selected.url} target="_blank" rel="noreferrer">Station page</a>}</div>
          <p className="muted">{selected?.address || 'Address will populate after discovery enrichment.'}</p>
          <div className="toolbar"><button className={rateType === 'member' ? 'active' : ''} onClick={() => setRateType('member')}>Tesla / member</button><button className={rateType === 'non_member' ? 'active' : ''} onClick={() => setRateType('non_member')}>Non-Tesla</button><span className={pricingFresh ? 'badge fresh' : 'badge'}>{latestHistory ? `Last observation: ${shortDate(latestHistory.capturedAt)}` : 'No price observation yet'}</span></div>
          <div className="priceStrip"><div><span>Last observed public price</span><strong>{money(prediction?.latestObservedPrice)}</strong><small>{prediction?.latestObservedAt ? shortDate(prediction.latestObservedAt) : 'not visible yet'}</small></div><div><span>Lowest observed/model slot</span><strong>{prediction ? slotLabel(prediction.bestSlot ?? prediction.bestHour * 2) : '—'}</strong><small>observation-based, not guaranteed</small></div><div><span>Estimated 95% range</span><strong>{prediction ? `${money(prediction.ci95Low)}–${money(prediction.ci95High)}` : '—'}</strong><small>from collected observations</small></div><div><span>Observation samples</span><strong>{prediction?.sampleCount ?? historyRows.length}</strong><small>pricing or availability rows</small></div></div>
          <div className="metaGrid"><span>Stalls <strong>{selected?.stalls || '—'}</strong></span><span>Max power <strong>{selected?.maxKw ? `${selected.maxKw} kW` : '—'}</strong></span><span>Scrape status <strong>{scrapeStatus}</strong></span><span>Source <strong>{selected?.source?.replaceAll('_', ' ') || 'unknown'}</strong></span></div>
        </Card>

        {origin && <Card><div className="sectionTitle"><div><p>{originMode === 'near-me' ? 'Near me' : 'ZIP search'}</p><h2>{originMode === 'near-me' ? 'Closest 5 Superchargers' : '25 closest Superchargers'}</h2></div></div><div className="nearbyGrid">{nearbyList.map((station, index) => <button key={station.id} className={station.id === selected?.id ? 'nearby active' : 'nearby'} onClick={() => setSelectedId(station.id)}><strong>{index + 1}. {station.name}</strong><span>{distance(station.distanceMiles)} away</span><small>{station.address || [station.city, station.state].filter(Boolean).join(', ')}</small></button>)}</div></Card>}

        <section className="statsGrid kpiGrid">
          <Stat icon={<BatteryCharging/>} label="Tesla URL coverage" value={`${coverage.teslaUrlPct}%`} note={`${coverage.teslaUrls} stations`} />
          <Stat icon={<Clock3/>} label="Scraped coverage" value={`${coverage.scrapedPct}%`} note={`${coverage.scraped} attempted`} />
          <Stat icon={<TrendingDown/>} label="Median model price" value={money(priceSummary.median)} note={`${priceSummary.count} model rows`} />
          <Stat icon={<MapPin/>} label="Average model price" value={money(priceSummary.avg)} note={`range ${money(priceSummary.low)}–${money(priceSummary.high)}`} />
        </section>

        <Card>
          <div className="sectionTitle"><div><p>Historical observations</p><h2>Observed public pricing over time</h2></div></div>
          {historyRows.length ? <div className="chartWrap"><ResponsiveContainer width="100%" height={300}><LineChart data={historyRows}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="capturedLabel" minTickGap={28} /><YAxis domain={['auto','auto']} tickFormatter={money} /><Tooltip formatter={value => money(value)} labelFormatter={value => `Captured ${value}`} /><Line type="monotone" dataKey="member" name="Tesla/member $/kWh" strokeWidth={3} dot /><Line type="monotone" dataKey="nonMember" name="Non-Tesla $/kWh" strokeWidth={3} dot /></LineChart></ResponsiveContainer></div> : <EmptyState title="No historical prices yet">{historyError ? 'No history file has been generated for this station yet.' : 'The station is in the directory, but CaughtaKWH has not collected a public price observation yet.'}</EmptyState>}
        </Card>

        <Card>
          <div className="sectionTitle"><div><p>Observation coverage</p><h2>Observed/model windows by time of day</h2></div></div>
          <div className="chartWrap"><ResponsiveContainer width="100%" height={270}><BarChart data={slotRows}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="slotLabel" minTickGap={18} /><YAxis domain={['auto','auto']} tickFormatter={money} /><Tooltip formatter={value => money(value)} labelFormatter={value => `${value} local`} /><Bar dataKey="expectedPrice" name="Observed/model $/kWh" /></BarChart></ResponsiveContainer></div>
          <div className="hourGrid">{slotRows.map(row => <span key={row.slot} className={row.hasObservation ? 'known' : ''}><small>{row.slotLabel}</small><strong>{money(row.expectedPrice)}</strong></span>)}</div>
          <p className="muted">This is not a Tesla price-frequency schedule. It only shows where CaughtaKWH has observations or model estimates. Tesla pricing can change dynamically at any time.</p>
        </Card>

        <Card>
          <div className="sectionTitle"><div><p>48-slot model</p><h2>Observation-based price estimate</h2></div></div>
          <div className="chartWrap"><ResponsiveContainer width="100%" height={310}><LineChart data={modelRows}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="slotLabel" interval={3} angle={-35} textAnchor="end" height={58} /><YAxis domain={['auto','auto']} tickFormatter={money} /><Tooltip formatter={value => money(value)} labelFormatter={value => `30-min period: ${value}`} /><Line connectNulls type="monotone" dataKey="expectedPrice" name="Estimated $/kWh" strokeWidth={3} dot /><Line connectNulls type="monotone" dataKey="ci95High" name="Likely high" strokeWidth={2} dot={false} /><Line connectNulls type="monotone" dataKey="ci95Low" name="Likely low" strokeWidth={2} dot={false} /></LineChart></ResponsiveContainer></div>
          <p className="muted">Use this as an observation-based guide only. It is not a live Tesla quote and not a guarantee of the price shown in your vehicle or app.</p>
        </Card>

        <div className="chartGrid">
          <Card><div className="sectionTitle"><div><p>Coverage</p><h2>Top states by stations</h2></div></div><div className="chartWrap"><ResponsiveContainer width="100%" height={280}><BarChart data={stateChart}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="state" /><YAxis allowDecimals={false} /><Tooltip /><Bar dataKey="count" name="Stations" /></BarChart></ResponsiveContainer></div></Card>
          <Card><div className="sectionTitle"><div><p>Scraper funnel</p><h2>Pricing visibility status</h2></div></div><div className="chartWrap"><ResponsiveContainer width="100%" height={280}><BarChart data={scrapeChart}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="name" hide /><YAxis allowDecimals={false} /><Tooltip /><Bar dataKey="count" name="Stations" /></BarChart></ResponsiveContainer></div></Card>
        </div>
      </div>
    </section>
    <footer><p>Data refreshed {predictionsFetchedAt ? shortDate(predictionsFetchedAt) : 'recently'}. Station directory refreshed {stationsFetchedAt ? shortDate(stationsFetchedAt) : 'recently'}. Not affiliated with Tesla.</p></footer>
  </main>;
}

createRoot(document.getElementById('root')).render(<App />);
