import React from 'react';
import { AlertTriangle } from 'lucide-react';

export function Card({ children, className = '' }) {
  return <section className={`card ${className}`}>{children}</section>;
}

export function Stat({ icon, label, value, note }) {
  return <Card className="stat"><div className="statIcon">{icon}</div><div><p>{label}</p><strong>{value}</strong>{note && <small>{note}</small>}</div></Card>;
}

export function EmptyState({ title, children }) {
  return <div className="empty"><AlertTriangle size={18}/><div><strong>{title}</strong><p>{children}</p></div></div>;
}

export function ChartTooltip({ active, payload, label, formatter }) {
  if (!active || !payload?.length) return null;
  return <div className="chartTooltip">
    {label && <p className="chartTooltipLabel">{label}</p>}
    {payload.map((entry, i) => <p key={i} style={{ color: entry.color || entry.stroke || 'inherit' }}>{entry.name}: <strong>{formatter ? formatter(entry.value) : entry.value}</strong></p>)}
  </div>;
}
