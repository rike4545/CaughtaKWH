import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BatteryCharging, Clock3, MapPin, Search, TrendingDown, Zap } from 'lucide-react';
import { LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts';
import './styles.css';

const money = value => typeof value === 'number' ? `$${value.toFixed(2)}` : '—';
const hourLabel = h => `${String(h).padStart(2, '0')}:00`;

function useJson(url, fallback) {
  const [data, setData] = useState(fallback);
  const [error, setError] = useState(null);
  useEffect(() => {
    fetch(url).then(r => {
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      return r.json();
    }).then(setData).catch(e => setError(e.message));
  }, [url]);
  return { data, error };
}

function Card({ children, className = '' }) {
  return <section className={`card ${className}`}>{children}</section>;
}

function Stat({ icon, label, value, note }) {
  return <Card className="stat"><div className="statIcon">{icon}</div><div><p>{label}</p><strong>{value}</strong>{note && <small>{note}</small>}</div></Card>;
}

function App() {
  const { data: stations } = useJson('./data/stations.json', []);
  const { data: predictions } = useJson('./data/predictions.json', []);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState('LakeGroveNYsupercharger');
  const selected = stations.find(s => s.id === selectedId) || stations[0];
  const prediction = predictions.find(p => p.stationId === selected?.id && p.membershipType === 'member') || predictions.find(p => p.stationId === selected?.id);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return stations;
    return stations.filter(s => [s.name, s.city, s.state, s.address, s.id].filter(Boolean).join(' ').toLowerCase().includes(q));
  }, [stations, query]);

  const nationalStats = useMemo(() => {
    const memberPreds = predictions.filter(p => p.membershipType === 'member');
    const cheapest = [...memberPreds].sort((a, b) => a.expectedPrice - b.expectedPrice)[0];
    return { stationCount: stations.length, predictionCount: predictions.length, cheapest };
  }, [stations, predictions]);

  return <main>
    <header className="hero">
      <div>
        <div className="eyebrow"><Zap size={16}/> CaughtaKWH</div>
        <h1>Know before you plug in.</h1>
        <p>Station-specific Tesla Supercharger $/kWh tracking, pricing history, and 95% confidence best-time charging recommendations.</p>
      </div>
      <div className="heroPanel">
        <strong>Data principle</strong>
        <p>Every Supercharger can have its own kWh price curve. CaughtaKWH stores observations by station, timestamp, membership type, and congestion fee.</p>
      </div>
    </header>

    <section className="statsGrid">
      <Stat icon={<MapPin/>} label="Stations discovered" value={nationalStats.stationCount} note="from Tesla public Find Us list" />
      <Stat icon={<Clock3/>} label="Price models built" value={nationalStats.predictionCount} note="Tesla/member and non-Tesla estimates" />
      <Stat icon={<TrendingDown/>} label="Lowest known estimate" value={nationalStats.cheapest ? money(nationalStats.cheapest.expectedPrice) : '—'} note={nationalStats.cheapest?.stationId} />
      <Stat icon={<BatteryCharging/>} label="Confidence method" value="95% CI" note="estimated range, not a guarantee" />
    </section>

    <section className="layout">
      <Card className="sidebar">
        <label className="search"><Search size={16}/><input placeholder="Search station, city, state..." value={query} onChange={e => setQuery(e.target.value)} /></label>
        <div className="stationList">
          {filtered.map(s => <button key={s.id} className={s.id === selected?.id ? 'active' : ''} onClick={() => setSelectedId(s.id)}>
            <strong>{s.name}</strong><span>{s.address || [s.city, s.state].filter(Boolean).join(', ') || s.id}</span>
          </button>)}
        </div>
      </Card>

      <div className="content">
        <Card>
          <div className="sectionTitle"><div><p>Selected station</p><h2>{selected?.name || 'No station selected'}</h2></div><a href={selected?.url} target="_blank" rel="noreferrer">Tesla page</a></div>
          <p className="muted">{selected?.address || 'Address will populate after the scraper reads the station page.'}</p>
          <div className="priceStrip">
            <div><span>Cheapest time to charge</span><strong>{prediction ? hourLabel(prediction.bestHour) : '—'}</strong><small>Tesla/member rate</small></div>
            <div><span>Estimated price</span><strong>{money(prediction?.expectedPrice)}</strong><small>per kWh</small></div>
            <div><span>Estimated 95% range</span><strong>{prediction ? `${money(prediction.ci95Low)}–${money(prediction.ci95High)}` : '—'}</strong><small>lower to upper</small></div>
            <div><span>Price samples</span><strong>{prediction?.sampleCount ?? '—'}</strong><small>observations used</small></div>
          </div>
        </Card>

        <Card>
          <div className="sectionTitle"><div><p>Best time model</p><h2>Hourly price estimate</h2></div></div>
          <div className="chartWrap">
            <ResponsiveContainer width="100%" height={310}>
              <LineChart data={(prediction?.hourly || []).map(x => ({ ...x, hourLabel: hourLabel(x.hour) }))}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="hourLabel" />
                <YAxis domain={['auto', 'auto']} tickFormatter={money} />
                <Tooltip formatter={(v) => money(v)} />
                <Line type="monotone" dataKey="expectedPrice" name="Estimated $/kWh" strokeWidth={3} dot />
                <Line type="monotone" dataKey="ci95High" name="Likely high" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="ci95Low" name="Likely low" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="muted">The recommended hour is the time with the lowest likely price for Tesla owners and Supercharger members. Always confirm the final price in the Tesla app before charging.</p>
        </Card>

        <Card>
          <div className="sectionTitle"><div><p>National comparison</p><h2>Known Tesla/member price estimates</h2></div></div>
          <div className="chartWrap">
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={predictions.filter(p => p.membershipType === 'member').slice(0, 25)}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="stationId" hide />
                <YAxis tickFormatter={money} />
                <Tooltip formatter={(v) => money(v)} />
                <Bar dataKey="expectedPrice" name="Estimated $/kWh" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>
    </section>

    <footer>
      <p>CaughtaKWH uses public Tesla Find Us pages and user-verified observations. It is not affiliated with Tesla. Pricing can change at any time; verify in the Tesla app before relying on a price.</p>
    </footer>
  </main>;
}

createRoot(document.getElementById('root')).render(<App />);
