import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AlertTriangle, BatteryCharging, Clock3, Compass, MapPin, Navigation, Search, ShieldCheck, TrendingDown, Zap } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { geocodeZip, nearestStations } from './zipSearch.js';
import { coverageKpis, pricingStats, scrapeOutcome, topStates } from './kpis.js';
import './styles.css';

const money = value => typeof value === 'number' ? `$${value.toFixed(2)}` : '—';
const shortDate = iso => iso ? new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
const distance = miles => typeof miles === 'number' ? `${miles.toFixed(miles < 10 ? 1 : 0)} mi` : '';
const slotLabel = slot => `${String(Math.floor(slot / 2)).padStart(2, '0')}:${slot % 2 === 0 ? '00' : '30'}`;
const wrapSlot = slot => (slot + 48) % 48;
const ageText = hours => typeof hours === 'number' ? hours < 1 ? `${Math.round(hours * 60)} min old` : `${hours.toFixed(hours < 10 ? 1 : 0)} hr old` : 'No public price yet';
const freshnessLabel = iso => {
  if (!iso) return 'No recent observation';
  const ageHours = (Date.now() - new Date(iso).getTime()) / 36e5;
  if (ageHours < 0.5) return 'Fresh (<30 min)';
  if (ageHours < 2) return 'Recent (<2 hr)';
  if (ageHours < 24) return 'Stale (>2 hr)';
  return 'Very stale (>24 hr)';
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

function priceState(selected, prediction) {
  if (prediction?.latestObservedAt) return { title: 'Historical pricing guidance available', tone: 'ok', detail: `${money(prediction.latestObservedPrice)} last observed ${shortDate(prediction.latestObservedAt)} · ${freshnessLabel(prediction.latestObservedAt)} · Historical/model windows are guidance only because Tesla pricing may change faster than the refresh cycle. Verify live pricing in Tesla before charging.` };
  if (selected?.lastScrapeHadAvailability) return { title: 'Tesla public price not visible', tone: 'warn', detail: 'The station page exposed availability details, but did not expose a public $/kWh price during the latest check.' };
  if (selected?.lastScrapedAt) return { title: 'No public Tesla price found', tone: 'warn', detail: `Checked ${shortDate(selected.lastScrapedAt)}. Tesla may only show the live price in the Tesla app or vehicle.` };
  return { title: 'Tesla price check pending', tone: 'warn', detail: 'CaughtaKWH has not checked this station page yet. Until then, use Tesla’s app or vehicle as the source of truth.' };
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
  const { data: history } = useJson(selected?.id ? `./data/history/${selected.id}.json` : './data/history/none.json', []);
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

  const historyRows = useMemo(() => (Array.isArray(history) ? history : []).map(row => ({ ...row, capturedLabel: shortDate(row.capturedAt), member: row.memberPricePerKwh ?? null, nonMember: row.nonMemberPricePerKwh ?? null })).slice(-120), [history]);
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
  const priceCheckChart = scrapeOutcome(stations);
  const state = priceState(selected, prediction);
  const pricingFresh = prediction?.latestObservationAgeHours <= 24;
  const latestHistory = historyRows.at(-1);
  const publicCheckResult = selected?.lastScrapeHadPrice ? 'Public price found' : selected?.lastScrapeHadAvailability ? 'Availability found; public price hidden' : selected?.lastScrapedAt ? 'No public price found' : 'Not checked yet';

  return <main>
    <header className="hero">
      <div><div className="eyebrow"><Zap size={16}/> CaughtaKWH</div><h1>Know before you plug in.</h1><p>Find nearby Superchargers, check Tesla public-price visibility, and use last observed pricing with confidence and freshness context.</p></div>
      <div className="heroPanel"><strong>Tesla remains the source of truth</strong><p>CaughtaKWH checks Tesla public station pages first. Historical/model windows are guidance only because Tesla pricing can change rapidly.</p></div>
    </header>

    <section className="statsGrid">
      <Stat icon={<MapPin/>} label="Stations discovered" value={stations.length} note={`${coverage.coordsPct}% with coordinates`} />
      <Stat icon={<Navigation/>} label={originMode === 'near-me' ? 'Closest near you' : originMode === 'zip' ? 'Closest near ZIP' : 'Nearby mode'} value={origin ? nearbyList.length : '—'} note={origin ? `${origin.city}${origin.state ? ', ' + origin.state : ''}` : 'off'} />
      <Stat icon={<Clock3/>} label="Stations with observations" value={`${coverage.pricedPct}%`} note={`${pricedStations} stations modeled`} />
      <Stat icon={<TrendingDown/>} label="Lowest observed estimate" value={cheapest ? money(cheapest.expectedPrice) : '—'} note={cheapest?.stationId} />
    </section>

    <section className="layout">
      <Card className="sidebar">
        <div className="nearbyBox betterNearby"><div><strong>Nearby Superchargers</strong><small>Enter ZIP first, or use location for closest 5. Location is only used to rank nearby chargers.</small></div><form onSubmit={findZip}><div className="zipRow"><input placeholder="ZIP code" value={zip} onChange={event => setZip(event.target.value)} inputMode="numeric" maxLength={5}/><button disabled={geoLoading}>Find 25</button></div></form><button className="nearMeButton" onClick={useMyLocation} disabled={geoLoading}><Compass size={18}/><span>{geoLoading ? 'Finding…' : 'Use my location'}</span><small>Closest 5</small></button>{origin && <small>{originMode === 'near-me' ? 'Showing closest 5 near your current location.' : `Showing closest 25 near ${origin.zip} — ${origin.city}, ${origin.state}`}</small>}{geoError && <small className="errorText"><AlertTriangle size={12}/> {geoError}</small>}{origin && <button className="linkButton" onClick={() => { setOrigin(null); setOriginMode('browse'); }}>Clear nearby mode</button>}</div>
        <label className="search"><Search size={16}/><input placeholder="Search station, city, state..." value={query} onChange={event => setQuery(event.target.value)} /></label>
        <select className="filter" value={stateFilter} onChange={event => setStateFilter(event.target.value)}>{states.map(state => <option key={state}>{state}</option>)}</select>
        <div className="stationList">{list.map(station => <button key={station.id} className={station.id === selected?.id ? 'active' : ''} onClick={() => setSelectedId(station.id)}><strong>{station.name}</strong><span>{station.distanceMiles !== undefined ? `${distance(station.distanceMiles)} • ` : ''}{station.address || [station.city, station.state].filter(Boolean).join(', ') || station.id}</span></button>)}</div>
      </Card>

      <div className="content">
        <PriceTruthNotice selected={selected} prediction={prediction} />
        <Card>
          <div className="sectionTitle"><div><p>Selected station</p><h2>{selected?.name || 'No station selected'}</h2></div>{selected?.url && <a href={selected.url} target="_blank" rel="noreferrer">Open Tesla page</a>}</div>
          <p className="muted">{selected?.address || 'Address will populate after discovery enrichment.'}</p>
          <div className="toolbar"><button className={rateType === 'member' ? 'active' : ''} onClick={() => setRateType('member')}>Tesla / member</button><button className={rateType === 'non_member' ? 'active' : ''} onClick={() => setRateType('non_member')}>Non-Tesla</button><span className={pricingFresh ? 'badge fresh' : 'badge'}>{state.title}</span></div>
          <div className="priceStrip"><div><span>Tesla public price</span><strong>{selected?.lastScrapeHadPrice ? money(prediction?.latestObservedPrice) : 'Not visible'}</strong><small>{prediction?.latestObservedAt ? `${shortDate(prediction.latestObservedAt)} · ${ageText(prediction.latestObservationAgeHours)}` : publicCheckResult}</small></div><div><span>Last observed price</span><strong>{money(prediction?.latestObservedPrice)}</strong><small>{prediction?.latestObservedAt ? freshnessLabel(prediction.latestObservedAt) : 'No historical price yet'}</small></div><div><span>Confidence</span><strong>{prediction?.confidenceLabel ? `${prediction.confidenceLabel}` : 'Low'}</strong><small>{prediction?.confidenceScore != null ? `${prediction.confidenceScore}/100 · ${prediction.sampleCount} samples` : 'Needs observations'}</small></div><div><span>Stalls / max power</span><strong>{selected?.stalls || '—'} stalls</strong><small>{selected?.maxKw ? `${selected.maxKw} kW max` : selected?.capacityConfidence || 'capacity unknown'}</small></div></div>
        </Card>

        <Card><div className="sectionTitle"><div><p>Observed/model windows by time of day</p><h2>{prediction ? `Historical best: ${prediction.bestHour}:${String(prediction.bestMinute).padStart(2, '0')}` : 'Not enough observations yet'}</h2></div><span className="badge">95% CI</span></div><p className="muted">These are historical guidance windows, not live-price guarantees. Tesla prices may change faster than the refresh cycle.</p><ResponsiveContainer width="100%" height={240}><BarChart data={modelRows}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="slotLabel" interval={5}/><YAxis tickFormatter={money}/><Tooltip formatter={value => money(value)} /><Bar dataKey="expectedPrice" name="Expected $/kWh" /></BarChart></ResponsiveContainer></Card>

        <Card><div className="sectionTitle"><div><p>Observation history</p><h2>{historyRows.length ? `${historyRows.length} recent observations` : 'No observations yet'}</h2></div><span className="badge">{historyRows.length ? shortDate(latestHistory?.capturedAt) : 'Waiting'}</span></div>{historyRows.length ? <ResponsiveContainer width="100%" height={240}><LineChart data={historyRows}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="capturedLabel" hide/><YAxis tickFormatter={money}/><Tooltip formatter={value => money(value)} /><Line type="monotone" dataKey="member" name="Tesla/member" dot={false}/><Line type="monotone" dataKey="nonMember" name="Non-Tesla" dot={false}/></LineChart></ResponsiveContainer> : <EmptyState title="No public observations yet">This station either has not been checked yet or Tesla did not expose public pricing during checks.</EmptyState>}</Card>
      </div>
    </section>

    <section className="statsGrid bottomStats">
      <Stat icon={<ShieldCheck/>} label="Avg observed price" value={priceSummary.avg ? money(priceSummary.avg) : '—'} note={`${priceSummary.count} modeled rates`} />
      <Stat icon={<BatteryCharging/>} label="Price visibility" value={`${coverage.pricedPct}%`} note="stations with modeled observations" />
      <Stat icon={<Clock3/>} label="Data loaded" value={shortDate(stationsFetchedAt || predictionsFetchedAt)} note="browser refreshes periodically" />
      <Stat icon={<Zap/>} label="Check result" value={publicCheckResult} note="selected station" />
    </section>

    <section className="chartsGrid"><Card><div className="sectionTitle"><div><p>Top states by station count</p><h2>Coverage map proxy</h2></div></div><ResponsiveContainer width="100%" height={220}><BarChart data={stateChart}><XAxis dataKey="state"/><YAxis/><Tooltip/><Bar dataKey="count" /></BarChart></ResponsiveContainer></Card><Card><div className="sectionTitle"><div><p>Scrape outcomes</p><h2>Public page visibility</h2></div></div><ResponsiveContainer width="100%" height={220}><BarChart data={priceCheckChart}><XAxis dataKey="label"/><YAxis/><Tooltip/><Bar dataKey="count" /></BarChart></ResponsiveContainer></Card></section>
  </main>;
}

createRoot(document.getElementById('root')).render(<App />);
