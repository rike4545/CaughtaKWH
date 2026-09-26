import React, { useState } from 'react';
import { Clock3, TrendingDown, Users, Zap } from 'lucide-react';
import { TESLA_BATTERY_PRESETS, estimateChargeCost } from '../chargeCost.js';
import { cents, money, signedCents } from '../utils/formatters.js';
import { Card, EmptyState } from './ui.jsx';

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

export function PriceMatrix({ memberOff, memberPeak, nonOff, nonPeak, congestion, fresh, benchmarkCents, observedAt }) {
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

export function ChargeCostCalculator({ currentPrice, cheapestPrice, cheapestLabel, rateLabel, fresh, congestion }) {
  const [presetId, setPresetId] = useState('m3-lr');
  const [manualKwh, setManualKwh] = useState('');
  const [arrival, setArrival] = useState(40);
  const [target, setTarget] = useState(80);
  const preset = TESLA_BATTERY_PRESETS.find(p => p.id === presetId) || TESLA_BATTERY_PRESETS[0];
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
