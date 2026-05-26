import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BatteryCharging, Clock3, MapPin, Search, TrendingDown, Zap } from 'lucide-react';
import { LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts';
import './styles.css';

const money = v => typeof v === 'number' ? `$${v.toFixed(2)}` : '—';
const hourLabel = h => `${String(h).padStart(2, '0')}:00`;
const shortDate = iso => iso ? new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric' }) : '—';

function useJson(url, fallback) {
  const [data, setData] = useState(fallback);
  const [error, setError] = useState(null);
  useEffect(() => {
    let live = true;
    setError(null);
    fetch(url).then(r => {
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      return r.json();
    }).then(json => live && setData(json)).catch(e => live && setError(e.message));
    return () => { live = false; };
  }, [url]);
  return { data, error };
}

function Card({ children, className = '' }) { return <section className={`card ${className}`}>{children}</section>; }
function Stat({ icon, label, value, note }) { return <Card className="stat"><div className="statIcon">{icon}</div><div><p>{label}</p><strong>{value}</strong>{note && <small>{note}</small>}</div></Card>; }

function App() {
  const { data: stations } = useJson('./data/stations.json', []);
  const { data: predictions } = useJson('./data/predictions.json', []);
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

  return <main>
    <header className="hero"><div><div className="eyebrow"><Zap size={16}/> CaughtaKWH</div><h1>Know before you plug in.</h1><p>Browse U.S. Superchargers, track actual observed $/kWh history, and get conservative cheapest-time recommendations as data improves.</p></div><div className="heroPanel"><strong>Data status</strong><p>Stations can appear before pricing is collected. Pricing models improve as the bot gathers more observations across all 24 hours.</p></div></header>

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
          <div className="sectionTitle"><div><p>Selected station</p><h2>{selected?.name || 'No station selected'}</h2></div>{selected?.url && <a href={selected.url} target="_blank" rel="noreferrer">Tesla page</a>}</div>
          <p className="muted">{selected?.address || 'Address will populate after discovery enrichment.'}</p>
          <div className="toolbar"><button className={rateType === 'member' ? 'active' : ''} onClick={() => setRateType('member')}>Tesla / member</button><button className={rateType === 'non_member' ? 'active' : ''} onClick={() => setRateType('non_member')}>Non-Tesla</button><span className={pricingFresh ? 'badge fresh' : 'badge'}>{latestHistory ? `Last price: ${shortDate(latestHistory.capturedAt)}` : 'Pricing not collected yet'}</span></div>
          <div className="priceStrip"><div><span>Cheapest time to charge</span><strong>{prediction ? hourLabel(prediction.bestHour) : '—'}</strong><small>{rateType === 'member' ? 'Tesla/member rate' : 'Non-Tesla rate'}</small></div><div><span>Estimated price</span><strong>{money(prediction?.expectedPrice)}</strong><small>per kWh</small></div><div><span>Estimated 95% range</span><strong>{prediction ? `${money(prediction.ci95Low)}–${money(prediction.ci95High)}` : '—'}</strong><small>lower to upper</small></div><div><span>Price samples</span><strong>{prediction?.sampleCount ?? historyRows.length}</strong><small>observations used</small></div></div>
        </Card>

        <Card>
          <div className="sectionTitle"><div><p>Historical data</p><h2>Observed station pricing over time</h2></div></div>
          {historyRows.length ? <div className="chartWrap"><ResponsiveContainer width="100%" height={300}><LineChart data={historyRows}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="capturedLabel" minTickGap={28} /><YAxis domain={['auto','auto']} tickFormatter={money} /><Tooltip formatter={v => money(v)} labelFormatter={v => `Captured ${v}`} /><Line type="monotone" dataKey="member" name="Tesla/member $/kWh" strokeWidth={3} dot /><Line type="monotone" dataKey="nonMember" name="Non-Tesla $/kWh" strokeWidth={3} dot /></LineChart></ResponsiveContainer></div> : <div className="empty"><strong>No historical prices yet.</strong><p>{historyError ? 'No history file has been generated for this station yet.' : 'The station is in the directory, but the pricing bot has not collected observations for it yet.'}</p></div>}
        </Card>

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
