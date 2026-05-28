import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AlertTriangle, BatteryCharging, Clock3, MapPin, Search, TrendingDown, Zap } from 'lucide-react';
import { LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts';
import './styles.css';

const money = v => typeof v === 'number' ? `$${v.toFixed(2)}` : '—';
const percent = v => typeof v === 'number' ? `${Math.round(v * 100)}%` : '—';
const hourLabel = h => `${String(h).padStart(2, '0')}:00`;
const wrapHour = h => (h + 24) % 24;
const shortDate = iso => iso ? new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';

function useJson(url, fallback, refreshMs = 300000) {
  const [data, setData] = useState(fallback);
  const [error, setError] = useState(null);
  const [fetchedAt, setFetchedAt] = useState(null);

  useEffect(() => {
    let live = true;
    const load = () => {
      setError(null);
      fetch(`${url}?t=${Date.now()}`, { cache: 'no-store' })
        .then(r => {
          if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
          return r.json();
        })
        .then(json => {
          if (!live) return;
          setData(json);
          setFetchedAt(new Date().toISOString());
        })
        .catch(e => live && setError(e.message));
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

function Card({ children, className = '' }) { return <section className={`card ${className}`}>{children}</section>; }
function Stat({ icon, label, value, note }) { return <Card className="stat"><div className="statIcon">{icon}</div><div><p>{label}</p><strong>{value}</strong>{note && <small>{note}</small>}</div></Card>; }

function EmptyState({ title, children }) {
  return <div className="empty"><AlertTriangle size={18}/><div><strong>{title}</strong><p>{children}</p></div></div>;
}

function UtilizationImpact({ prediction }) {
  const impact = prediction?.utilizationImpact;
  const congestion = prediction?.congestion;
  const bands = impact?.bands || [
    { band: 'low', sampleCount: 0 },
    { band: 'medium', sampleCount: 0 },
    { band: 'high', sampleCount: 0 }
  ];

  return <Card>
    <div className="sectionTitle"><div><p>Utilization impact</p><h2>Surge and stall pressure</h2></div></div>
    <div className="impactGrid">
      {bands.map(band => <div key={band.band}><span>{band.band} utilization</span><strong>{money(band.expectedPrice)}</strong><small>{band.sampleCount || 0} samples · avg load {percent(band.averageUtilizationPct)}</small><em>{typeof band.deltaFromLow === 'number' ? `${money(band.deltaFromLow)} vs low` : 'needs low baseline'}</em></div>)}
    </div>
    {impact?.hasSignal ? <p className="muted">CaughtaKWH has observations in multiple utilization bands, so price changes can be compared against station load.</p> : <EmptyState title="Utilization signal not ready">The scraper records available stalls and utilization when public pages expose them, but this station needs price observations across multiple load levels before surge impact can be measured.</EmptyState>}
    <div className="metaGrid">
      <span>Utilization samples <strong>{impact?.sampleCount ?? 0}</strong></span>
      <span>Congestion samples <strong>{congestion?.sampleCount ?? 0}</strong></span>
      <span>Max congestion fee <strong>{money(congestion?.maxFeePerMinute)}/min</strong></span>
      <span>Average congestion fee <strong>{money(congestion?.averageFeePerMinute)}/min</strong></span>
    </div>
  </Card>;
}

function App() {
  const { data: stations, fetchedAt: stationsFetchedAt } = useJson('./data/stations.json', []);
  const { data: predictions, fetchedAt: predictionsFetchedAt } = useJson('./data/predictions.json', []);
  const [query, setQuery] = useState('');
  const [stateFilter, setStateFilter] = useState('All');
  const [rateType, setRateType] = useState('member');
  const [selectedId, setSelectedId] = useState('LakeGroveNYsupercharger');
  const selected = stations.find(s => s.id === selectedId) || stations[0];
  const { data: history, error: historyError } = useJson(selected?.id ? `./data/history/${selected.id}.json` : './data/history/none.json', []);
  const prediction = predictions.find(p => p.stationId === selected?.id && p.membershipType === rateType) || predictions.find(p => p.stationId === selected?.id);

  const states = useMemo(() => ['All', ...Array.from(new Set(stations.map(s => s.state).filter(Boolean))).sort()], [stations]);
  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    return stations.filter(s => {
      const matchesState = stateFilter === 'All' || s.state === stateFilter;
      const text = [s.name, s.city, s.state, s.address, s.id].filter(Boolean).join(' ').toLowerCase();
      return matchesState && (!q || text.includes(q));
    });
  }, [stations, query, stateFilter]);

  const hourly = useMemo(() => Array.from({ length: 24 }, (_, hour) => {
    const row = prediction?.hourly?.find(x => Number(x.hour) === hour);
    return { hour, hourLabel: hourLabel(hour), expectedPrice: row?.expectedPrice ?? null, ci95High: row?.ci95High ?? null, ci95Low: row?.ci95Low ?? null, sampleCount: row?.sampleCount ?? 0 };
  }), [prediction]);

  const twelveHourData = useMemo(() => {
    const modelHourly = new Map((prediction?.hourly || []).map(row => [Number(row.hour), row]));
    const anchorHour = Number.isFinite(prediction?.bestHour) ? Number(prediction.bestHour) : new Date().getHours();
    const startHour = wrapHour(anchorHour - 5);
    return Array.from({ length: 12 }, (_, index) => {
      const hour = wrapHour(startHour + index);
      const row = modelHourly.get(hour);
      return { hour, hourLabel: hourLabel(hour), expectedPrice: row?.expectedPrice ?? null, hasObservation: Boolean(row) };
    });
  }, [prediction]);

  const historyRows = useMemo(() => (Array.isArray(history) ? history : []).map(row => ({
    ...row,
    capturedLabel: shortDate(row.capturedAt),
    member: row.memberPricePerKwh ?? null,
    nonMember: row.nonMemberPricePerKwh ?? null
  })).slice(-100), [history]);

  const memberPreds = predictions.filter(p => p.membershipType === 'member');
  const cheapest = [...memberPreds].sort((a, b) => a.expectedPrice - b.expectedPrice)[0];
  const pricedStations = new Set(predictions.map(p => p.stationId)).size;
  const latestHistory = historyRows.at(-1);
  const pricingFresh = latestHistory?.capturedAt ? ((Date.now() - new Date(latestHistory.capturedAt).getTime()) / 36e5) < 24 : false;
  const scrapeStatus = selected?.lastScrapeError
    ? selected.lastScrapeError
    : selected?.lastScrapedAt
      ? selected.lastScrapeHadPrice
        ? 'Latest scrape found pricing text.'
        : selected.lastScrapeHadAvailability
          ? 'Latest scrape found availability, but no public price.'
          : 'Latest scrape did not find public pricing or availability text.'
      : 'Not scraped yet.';

  return <main>
    <header className="hero"><div><div className="eyebrow"><Zap size={16}/> CaughtaKWH</div><h1>Know before you plug in.</h1><p>Browse U.S. Superchargers, track observed $/kWh history, and compare price behavior against time, confidence, congestion fees, and station load.</p></div><div className="heroPanel"><strong>Auto-refreshing</strong><p>Dashboard data refreshes every 5 minutes. Last checked {shortDate(predictionsFetchedAt || stationsFetchedAt)}.</p></div></header>

    <section className="statsGrid">
      <Stat icon={<MapPin/>} label="Stations discovered" value={stations.length} note="metadata directory" />
      <Stat icon={<Clock3/>} label="Stations with pricing" value={pricedStations} note="history-backed models" />
      <Stat icon={<TrendingDown/>} label="Lowest known estimate" value={cheapest ? money(cheapest.expectedPrice) : '—'} note={cheapest?.stationId} />
      <Stat icon={<BatteryCharging/>} label="Confidence" value="95% range" note="improves with samples" />
    </section>

    <section className="layout">
      <Card className="sidebar">
        <label className="search"><Search size={16}/><input placeholder="Search station, city, state..." value={query} onChange={e => setQuery(e.target.value)} /></label>
        <select className="filter" value={stateFilter} onChange={e => setStateFilter(e.target.value)}>{states.map(s => <option key={s}>{s}</option>)}</select>
        <div className="stationList">{filtered.map(s => <button key={s.id} className={s.id === selected?.id ? 'active' : ''} onClick={() => setSelectedId(s.id)}><strong>{s.name}</strong><span>{s.address || [s.city, s.state].filter(Boolean).join(', ') || s.id}</span></button>)}</div>
      </Card>

      <div className="content">
        <Card>
          <div className="sectionTitle"><div><p>Selected station</p><h2>{selected?.name || 'No station selected'}</h2></div>{selected?.url && <a href={selected.url} target="_blank" rel="noreferrer">Station page</a>}</div>
          <p className="muted">{selected?.address || 'Address will populate after discovery enrichment.'}</p>
          <div className="toolbar"><button className={rateType === 'member' ? 'active' : ''} onClick={() => setRateType('member')}>Tesla / member</button><button className={rateType === 'non_member' ? 'active' : ''} onClick={() => setRateType('non_member')}>Non-Tesla</button><span className={pricingFresh ? 'badge fresh' : 'badge'}>{latestHistory ? `Last price: ${shortDate(latestHistory.capturedAt)}` : 'Pricing not collected yet'}</span></div>
          <div className="priceStrip"><div><span>Cheapest time to charge</span><strong>{prediction ? hourLabel(prediction.bestHour) : '—'}</strong><small>{rateType === 'member' ? 'Tesla/member rate' : 'Non-Tesla rate'}</small></div><div><span>Estimated price</span><strong>{money(prediction?.expectedPrice)}</strong><small>per kWh</small></div><div><span>Estimated 95% range</span><strong>{prediction ? `${money(prediction.ci95Low)}–${money(prediction.ci95High)}` : '—'}</strong><small>lower to upper</small></div><div><span>Price samples</span><strong>{prediction?.sampleCount ?? historyRows.length}</strong><small>observations used</small></div></div>
          <div className="metaGrid"><span>Stalls <strong>{selected?.stalls || '—'}</strong></span><span>Max power <strong>{selected?.maxKw ? `${selected.maxKw} kW` : '—'}</strong></span><span>Scrape status <strong>{scrapeStatus}</strong></span><span>Source <strong>{selected?.source?.replaceAll('_', ' ') || 'unknown'}</strong></span></div>
        </Card>

        <Card>
          <div className="sectionTitle"><div><p>Historical data</p><h2>Observed station pricing over time</h2></div></div>
          {historyRows.length ? <div className="chartWrap"><ResponsiveContainer width="100%" height={300}><LineChart data={historyRows}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="capturedLabel" minTickGap={28} /><YAxis domain={['auto','auto']} tickFormatter={money} /><Tooltip formatter={v => money(v)} labelFormatter={v => `Captured ${v}`} /><Line type="monotone" dataKey="member" name="Tesla/member $/kWh" strokeWidth={3} dot /><Line type="monotone" dataKey="nonMember" name="Non-Tesla $/kWh" strokeWidth={3} dot /></LineChart></ResponsiveContainer></div> : <EmptyState title="No historical prices yet">{historyError ? 'No history file has been generated for this station yet.' : 'The station is in the directory, but the pricing bot has not collected observations for it yet.'}</EmptyState>}
        </Card>

        <Card>
          <div className="sectionTitle"><div><p>12-hour location view</p><h2>Cost frequency around this station</h2></div></div>
          <div className="chartWrap"><ResponsiveContainer width="100%" height={270}><BarChart data={twelveHourData}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="hourLabel" /><YAxis domain={['auto','auto']} tickFormatter={money} /><Tooltip formatter={v => money(v)} labelFormatter={v => `${v} local`} /><Bar dataKey="expectedPrice" name="Estimated $/kWh" /></BarChart></ResponsiveContainer></div>
          <div className="hourGrid">{twelveHourData.map(row => <span key={row.hour} className={row.hasObservation ? 'known' : ''}><small>{row.hourLabel}</small><strong>{money(row.expectedPrice)}</strong></span>)}</div>
          <p className="muted">Blank buckets mean CaughtaKWH has not collected a public price observation for that local hour yet.</p>
        </Card>

        <UtilizationImpact prediction={prediction} />

        <Card>
          <div className="sectionTitle"><div><p>Best time model</p><h2>24-hour price estimate</h2></div></div>
          <div className="chartWrap"><ResponsiveContainer width="100%" height={310}><LineChart data={hourly}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="hourLabel" interval={1} angle={-35} textAnchor="end" height={58} /><YAxis domain={['auto','auto']} tickFormatter={money} /><Tooltip formatter={(v) => money(v)} labelFormatter={v => `Hour: ${v}`} /><Line connectNulls type="monotone" dataKey="expectedPrice" name="Estimated $/kWh" strokeWidth={3} dot /><Line connectNulls type="monotone" dataKey="ci95High" name="Likely high" strokeWidth={2} dot={false} /><Line connectNulls type="monotone" dataKey="ci95Low" name="Likely low" strokeWidth={2} dot={false} /></LineChart></ResponsiveContainer></div>
          <p className="muted">Blank hours mean the bot needs more observations for that time of day. The recommendation becomes stronger as all 24 hours collect samples.</p>
        </Card>

        <Card>
          <div className="sectionTitle"><div><p>National comparison</p><h2>Known Tesla/member price estimates</h2></div></div>
          <div className="chartWrap"><ResponsiveContainer width="100%" height={280}><BarChart data={memberPreds.slice(0, 25)}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="stationId" hide /><YAxis tickFormatter={money} /><Tooltip formatter={(v) => money(v)} /><Bar dataKey="expectedPrice" name="Estimated $/kWh" /></BarChart></ResponsiveContainer></div>
        </Card>
      </div>
    </section>
    <footer><p>CaughtaKWH uses public Tesla Find Us pages and user-verified observations. It is not affiliated with Tesla. Pricing can change at any time; verify in the Tesla app before relying on a price.</p></footer>
  </main>;
}

createRoot(document.getElementById('root')).render(<App />);
