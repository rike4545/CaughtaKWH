export const money = value => typeof value === 'number' ? `$${value.toFixed(2)}` : '—';
export const cents = value => typeof value === 'number' ? `${value.toFixed(value % 1 ? 2 : 0)}¢` : '—';
export const signedCents = value => typeof value === 'number' ? `${value >= 0 ? '+' : '-'}${cents(Math.abs(value))}` : '—';
export const shortDate = iso => iso ? new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
export const distance = miles => typeof miles === 'number' ? `${miles.toFixed(miles < 10 ? 1 : 0)} mi` : '';
export const slotLabel = slot => `${String(Math.floor(slot / 2)).padStart(2, '0')}:${slot % 2 === 0 ? '00' : '30'}`;
export const ageText = hours => typeof hours === 'number' ? hours < 1 ? `${Math.round(hours * 60)} min old` : `${hours.toFixed(hours < 10 ? 1 : 0)} hr old` : 'No public price yet';
export const percent = value => typeof value === 'number' ? `${Math.round(value * 100)}%` : '—';
export const coords = station => typeof station?.lat === 'number' && typeof station?.lng === 'number' ? `${station.lat.toFixed(4)}, ${station.lng.toFixed(4)}` : '—';
export const titleCase = value => String(value || '—').replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase());

export const freshnessLabel = iso => {
  if (!iso) return 'No recent observation';
  const ageHours = (Date.now() - new Date(iso).getTime()) / 36e5;
  if (ageHours < 0.5) return 'Fresh, under 30 min';
  if (ageHours < 2) return 'Recent, under 2 hr';
  if (ageHours < 24) return 'Getting old, over 2 hr';
  return 'Old, over 24 hr';
};
