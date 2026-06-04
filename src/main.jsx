import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AlertTriangle, BatteryCharging, Clock3, Compass, MapPin, Navigation, Search, ShieldCheck, TrendingDown, Zap } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { geocodeZip, nearestStations } from './zipSearch.js';
import { coverageKpis, pricingStats, refreshQueueStates, scrapeOutcome } from './kpis.js';
import './styles.css';

const money = value => typeof value === 'number' ? `$${value.toFixed(2)}` : '—';
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
  if (prediction?.latestObservedAt && prediction.latestObservationAgeHours > 48) return { title: 'Only old price history so far', tone: 'warn', detail: `Last saved price was ${money(prediction.latestObservedPrice)} on ${shortDate(prediction.latestObservedAt)}. Tesla did not show a fresh public price in the latest checks, so treat this as historical context only.` };
  if (prediction?.latestObservedAt) return { title: 'We have a recent price trail', tone: 'ok', detail: `Last seen at ${money(prediction.latestObservedPrice)} on ${shortDate(prediction.latestObservedAt)}. ${freshnessLabel(prediction.latestObservedAt)}. Treat the cheaper-time chart as a heads-up, not a promise; Tesla can change live prices anytime.` };
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
  const priceHistoryPct = stations.length ? `${(pricedStations / stations.length * 100).toFixed(2)}%` : '0.00%';
  const coverage = coverageKpis(stations, predictions);
  const priceSummary = pricingStats(predictions);
  const refreshQueueChart = refreshQueueStates(stations, 12);
  const priceCheckChart = scrapeOutcome(stations);
  const state = priceState(selected, prediction);
  const pricingFresh = prediction?.latestObservationAgeHours <= 24;
  const latestHistory = historyRows.at(-1);
  const publicCheckResult = selected?.lastScrapeHadPrice ? 'Price found' : selected?.lastScrapeHadAvailability ? 'Availability only' : selected?.lastScrapedAt ? 'No price shown' : 'Not checked yet';
  const siteDetails = selected?.lastSiteDetails || {};
  const lastCandidate = selected?.lastScrapeCandidates?.find(candidate => candidate.hasPrice || candidate.hasAvailability) || selected?.lastScrapeCandidates?.[0];
  const amenityList = Array.isArray(siteDetails.amenities) ? siteDetails.amenities : [];
  const chargerGeneration = siteDetails.chargerGeneration || (selected?.maxKw >= 320 ? 'V4 / high-power capable' : selected?.maxKw >= 250 ? 'V3 high-power' : selected?.maxKw ? `${selected.maxKw} kW class` : 'Power unknown');
  const availabilitySummary = latestHistory?.availabilityLabel
    ? `${titleCase(latestHistory.availabilityLabel)}${latestHistory.availableStalls != null ? ` · ${latestHistory.availableStalls}/${latestHistory.totalStalls || selected?.stalls || '—'} open` : ''}`
    : selected?.lastScrapeHadAvailability ? 'Availability showed up' : 'No availability shown';

  return <main>
    <header className="hero">
      <div><div className="eyebrow"><Zap size={16}/> CaughtaKWH</div><h1>Check the charger before you roll up.</h1><p>Starting with United States Superchargers while we harden the scraper. Find nearby sites, see what Tesla’s public pages are willing to show, and spot cheaper windows from prices we have seen before.</p></div>
      <div className="heroPanel"><strong>Use this as your early look</strong><p>Tesla’s app or your car is still the live price. CaughtaKWH is US-first for now; Canada and Mexico come next once the scraper is fully steady.</p></div>
    </header>

    <section className="statsGrid">
      <Stat icon={<MapPin/>} label="US stations found" value={stations.length} note={`${coverage.coordsPct}% with coordinates`} />
      <Stat icon={<Navigation/>} label={originMode === 'near-me' ? 'Closest near you' : originMode === 'zip' ? 'Closest near ZIP' : 'Nearby mode'} value={origin ? nearbyList.length : '—'} note={origin ? `${origin.city}${origin.state ? ', ' + origin.state : ''}` : 'off'} />
      <Stat icon={<Clock3/>} label="Stations with price history" value={pricedStations} note={`${priceHistoryPct} of US stations`} />
      <Stat icon={<TrendingDown/>} label="Lowest typical price" value={cheapest ? money(cheapest.expectedPrice) : '—'} note={cheapest?.stationId} />
    </section>

    <section className="layout">
      <Card className="sidebar">
        <div className="nearbyBox betterNearby"><div><strong>Find chargers nearby</strong><small>Use a ZIP for a wider search, or your location for the closest handful. Your location only sorts the list.</small></div><form onSubmit={findZip}><div className="zipRow"><input placeholder="ZIP code" value={zip} onChange={event => setZip(event.target.value)} inputMode="numeric" maxLength={5}/><button disabled={geoLoading}>Find 25</button></div></form><button className="nearMeButton" onClick={useMyLocation} disabled={geoLoading}><Compass size={18}/><span>{geoLoading ? 'Finding…' : 'Use my location'}</span><small>Closest 5</small></button>{origin && <small>{originMode === 'near-me' ? 'Showing the closest 5 chargers to you. This same area can be used for a focused refresh run.' : `Showing 25 chargers near ${origin.zip} — ${origin.city}, ${origin.state}. This ZIP can be used for a focused refresh run.`}</small>}{geoError && <small className="errorText"><AlertTriangle size={12}/> {geoError}</small>}{origin && <button className="linkButton" onClick={() => { setOrigin(null); setOriginMode('browse'); }}>Clear nearby mode</button>}</div>
        <label className="search"><Search size={16}/><input placeholder="Search station, city, state..." value={query} onChange={event => setQuery(event.target.value)} /></label>
        <select className="filter" value={stateFilter} onChange={event => setStateFilter(event.target.value)}>{states.map(state => <option key={state}>{state}</option>)}</select>
        <div className="stationList">{list.map(station => <button key={station.id} className={station.id === selected?.id ? 'active' : ''} onClick={() => setSelectedId(station.id)}><strong>{station.name}</strong><span>{station.distanceMiles !== undefined ? `${distance(station.distanceMiles)} • ` : ''}{station.address || [station.city, station.state].filter(Boolean).join(', ') || station.id}</span></button>)}</div>
      </Card>

      <div className="content">
        <PriceTruthNotice selected={selected} prediction={prediction} />
        <Card>
          <div className="sectionTitle"><div><p>Selected charger</p><h2>{selected?.name || 'Pick a charger'}</h2></div>{selected?.url && <a href={selected.url} target="_blank" rel="noreferrer">Open Tesla page</a>}</div>
          <p className="muted">{selected?.address || 'We do not have the street address for this one yet.'}</p>
          <div className="toolbar"><button className={rateType === 'member' ? 'active' : ''} onClick={() => setRateType('member')}>Tesla / member</button><button className={rateType === 'non_member' ? 'active' : ''} onClick={() => setRateType('non_member')}>Non-Tesla</button><span className={pricingFresh ? 'badge fresh' : 'badge'}>{state.title}</span></div>
          <div className="priceStrip"><div><span>What Tesla showed us</span><strong>{selected?.lastScrapeHadPrice ? money(prediction?.latestObservedPrice) : 'Hidden'}</strong><small>{prediction?.latestObservedAt ? `${shortDate(prediction.latestObservedAt)} · ${ageText(prediction.latestObservationAgeHours)}` : publicCheckResult}</small></div><div><span>Last price we saw</span><strong>{money(prediction?.latestObservedPrice)}</strong><small>{prediction?.latestObservedAt ? freshnessLabel(prediction.latestObservedAt) : 'No price history yet'}</small></div><div><span>How much to trust it</span><strong>{prediction?.confidenceLabel ? `${prediction.confidenceLabel}` : 'Low'}</strong><small>{prediction?.confidenceScore != null ? `${prediction.confidenceScore}/100 · ${prediction.sampleCount} samples` : 'Needs more samples'}</small></div><div><span>Stalls and speed</span><strong>{selected?.stalls || '—'} stalls</strong><small>{selected?.maxKw ? `Up to ${selected.maxKw} kW` : selected?.capacityConfidence || 'capacity unknown'}</small></div></div>
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

        <Card><div className="sectionTitle"><div><p>Cheaper times</p><h2>{prediction ? `Best time we have seen: ${prediction.bestHour}:${String(prediction.bestMinute).padStart(2, '0')}` : 'Not enough prices yet'}</h2></div><span className="badge">Estimate range</span></div><p className="muted">Use this for planning, then check Tesla before you charge. Live prices can move faster than this chart.</p><ResponsiveContainer width="100%" height={240}><BarChart data={modelRows}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="slotLabel" interval={5}/><YAxis tickFormatter={money}/><Tooltip formatter={value => money(value)} /><Bar dataKey="expectedPrice" name="Expected $/kWh" /></BarChart></ResponsiveContainer></Card>

        <Card><div className="sectionTitle"><div><p>Price history</p><h2>{historyRows.length ? `${historyRows.length} recent checks` : 'No prices saved yet'}</h2></div><span className="badge">{historyRows.length ? shortDate(latestHistory?.capturedAt) : 'Waiting'}</span></div>{historyRows.length ? <ResponsiveContainer width="100%" height={240}><LineChart data={historyRows}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="capturedLabel" hide/><YAxis tickFormatter={money}/><Tooltip formatter={value => money(value)} /><Line type="monotone" dataKey="member" name="Tesla/member" dot={false}/><Line type="monotone" dataKey="nonMember" name="Non-Tesla" dot={false}/></LineChart></ResponsiveContainer> : <EmptyState title="No saved prices yet">We either have not checked this charger, or Tesla did not show a public price when we looked.</EmptyState>}</Card>
      </div>
    </section>

    <section className="statsGrid bottomStats">
      <Stat icon={<ShieldCheck/>} label="Average saved price" value={priceSummary.avg ? money(priceSummary.avg) : '—'} note={`${priceSummary.count} rates in the model`} />
      <Stat icon={<BatteryCharging/>} label="Fresh public prices" value={coverage.withPrice} note="from the latest page checks" />
      <Stat icon={<Clock3/>} label="Data loaded" value={shortDate(stationsFetchedAt || predictionsFetchedAt)} note="browser refreshes periodically" />
      <Stat icon={<Zap/>} label="This charger" value={publicCheckResult} note="latest page check" />
    </section>

    <section className="chartsGrid"><Card><div className="sectionTitle"><div><p>Refresh queue</p><h2>States that need another look</h2></div></div><p className="muted">Prioritizes states with unchecked or stale charger pages, so slow Tesla renders get spread out instead of piling into one run.</p><ResponsiveContainer width="100%" height={220}><BarChart data={refreshQueueChart}><XAxis dataKey="state"/><YAxis/><Tooltip/><Bar dataKey="needsRefresh" name="Needs refresh" /><Bar dataKey="priceHidden" name="Price hidden last check" /></BarChart></ResponsiveContainer></Card><Card><div className="sectionTitle"><div><p>What Tesla pages showed</p><h2>Latest checks</h2></div></div><ResponsiveContainer width="100%" height={220}><BarChart data={priceCheckChart}><XAxis dataKey="label"/><YAxis/><Tooltip/><Bar dataKey="count" /></BarChart></ResponsiveContainer></Card></section>
  </main>;
}

createRoot(document.getElementById('root')).render(<App />);
