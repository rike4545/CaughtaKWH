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

function freshnessLabel(iso) {
  if (!iso) return 'No recent observation';

  const ageHours = (Date.now() - new Date(iso).getTime()) / 36e5;

  if (ageHours < 0.5) return 'Fresh (<30 min)';
  if (ageHours < 2) return 'Recent (<2 hr)';
  if (ageHours < 24) return 'Stale (>2 hr)';
  return 'Very stale (>24 hr)';
}

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
  if (prediction?.latestObservedAt) {
    return {
      title: 'Historical pricing guidance available',
      tone: 'ok',
      detail: `${money(prediction.latestObservedPrice)} last observed ${shortDate(prediction.latestObservedAt)} · ${freshnessLabel(prediction.latestObservedAt)} · Historical/model windows are guidance only because Tesla pricing may change faster than the refresh cycle. Verify the live Tesla price before charging.`
    };
  }

  if (selected?.lastScrapeHadAvailability) {
    return {
      title: 'Tesla public price not visible',
      tone: 'warn',
      detail: 'The station page exposed availability details, but did not expose a public $/kWh price during the latest check.'
    };
  }

  if (selected?.lastScrapedAt) {
    return {
      title: 'No public Tesla price found',
      tone: 'warn',
      detail: `Checked ${shortDate(selected.lastScrapedAt)}. Tesla may only show the live price in the Tesla app or vehicle.`
    };
  }

  return {
    title: 'Tesla price check pending',
    tone: 'warn',
    detail: 'CaughtaKWH has not checked this station page yet. Until then, use Tesla’s app or vehicle as the source of truth.'
  };
}
