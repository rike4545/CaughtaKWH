import React, { useMemo, useState } from 'react';
import { MapPin, Scale, Trash2, Zap } from 'lucide-react';
import { Card, EmptyState } from './ui.jsx';
import { distance, freshnessLabel, money } from '../utils/formatters.js';
import { isCurrentPrediction } from '../kpis.js';
import { milesBetween } from '../zipSearch.js';

function comparisonPrice(predictions) {
  const member = predictions?.member || predictions?.any;
  if (!member) return { price: null, label: 'No price data', fresh: false };
  const fresh = isCurrentPrediction(member);
  const price = fresh
    ? member.latestObservedPrice ?? member.expectedPrice ?? null
    : member.expectedPrice ?? member.averageObservedPrice ?? member.latestObservedPrice ?? null;
  return {
    price,
    fresh,
    label: fresh ? 'recent observed rate' : member.expectedPrice != null ? 'modeled / historical rate' : 'historical rate'
  };
}

export function StationComparison({ stationIds, stationById, predictionsByStation, origin, onRemove, onOpen }) {
  const [energyKwh, setEnergyKwh] = useState(45);
  const rows = useMemo(() => stationIds
    .map(id => {
      const station = stationById.get(id);
      if (!station) return null;
      const pricing = comparisonPrice(predictionsByStation.get(id));
      const sessionCost = typeof pricing.price === 'number' ? pricing.price * Number(energyKwh || 0) : null;
      const distanceMiles = origin && typeof station.lat === 'number' && typeof station.lng === 'number'
        ? milesBetween(origin.lat, origin.lng, station.lat, station.lng)
        : typeof station.distanceMiles === 'number' ? station.distanceMiles : null;
      return { station: { ...station, distanceMiles }, pricing, sessionCost };
    })
    .filter(Boolean), [stationIds, stationById, predictionsByStation, origin, energyKwh]);

  const cheapest = rows.filter(row => row.sessionCost != null).sort((a, b) => a.sessionCost - b.sessionCost)[0]?.station.id;
  const nearest = rows.filter(row => typeof row.station.distanceMiles === 'number').sort((a, b) => a.station.distanceMiles - b.station.distanceMiles)[0]?.station.id;
  const fastest = [...rows].sort((a, b) => Number(b.station.maxKw || 0) - Number(a.station.maxKw || 0))[0]?.station.id;

  return <section className="comparisonView">
    <Card className="comparisonIntro">
      <div className="sectionTitle"><div><p>Charger comparison</p><h2>Compare the stops that actually fit your session</h2></div><span className="badge">{rows.length}/4 selected</span></div>
      <p className="muted">Compare up to four chargers using the newest usable member rate, distance, charging power, stall count, and data freshness. Price estimates are planning aids — verify Tesla before plugging in.</p>
      <label className="comparisonEnergy">Energy needed this session
        <span><input aria-label="Energy needed this session" type="number" min="1" max="150" step="1" value={energyKwh} onChange={event => setEnergyKwh(event.target.value)} /> kWh</span>
      </label>
    </Card>

    {!rows.length ? <Card><EmptyState title="No chargers selected for comparison">Open a charger and choose “Compare,” or add chargers from Favorites and Recently Viewed.</EmptyState></Card> :
    <div className="comparisonGrid">
      {rows.map(({ station, pricing, sessionCost }) => <Card className="comparisonCard" key={station.id}>
        <div className="comparisonHead">
          <div><p>{[station.city, station.state].filter(Boolean).join(', ')}</p><h3>{station.name || station.id}</h3></div>
          <button type="button" className="iconButton" aria-label={`Remove ${station.name || station.id} from comparison`} onClick={() => onRemove(station.id)}><Trash2 size={16}/></button>
        </div>
        <div className="comparisonBadges">
          {station.id === cheapest && <span className="compareWinner">Lowest estimated cost</span>}
          {station.id === nearest && <span>Nearest</span>}
          {station.id === fastest && <span>Highest power</span>}
        </div>
        <div className="comparisonMetric primary"><span>Estimated session</span><strong>{sessionCost != null ? money(sessionCost) : '—'}</strong><small>{pricing.price != null ? `${money(pricing.price)}/kWh · ${pricing.label}` : 'No usable public price'}</small></div>
        <div className="comparisonMetric"><span><MapPin size={14}/> Distance</span><strong>{distance(station.distanceMiles) || '—'}</strong></div>
        <div className="comparisonMetric"><span><Zap size={14}/> Max power</span><strong>{station.maxKw ? `${station.maxKw} kW` : '—'}</strong></div>
        <div className="comparisonMetric"><span><Scale size={14}/> Stalls</span><strong>{station.stalls || '—'}</strong></div>
        <div className="comparisonMetric"><span>Price freshness</span><strong>{predictionsByStation.get(station.id)?.member?.latestObservedAt ? freshnessLabel(predictionsByStation.get(station.id).member.latestObservedAt) : 'No observation'}</strong></div>
        <button type="button" className="compareOpenButton" onClick={() => onOpen(station.id)}>Open charger</button>
      </Card>)}
    </div>}
  </section>;
}
