const normalize = value => String(value || '')
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

const starts = (value, query) => normalize(value).startsWith(query);
const includes = (value, query) => normalize(value).includes(query);

export function stationSearchScore(station, rawQuery) {
  const query = normalize(rawQuery);
  if (!query) return 0;

  const name = normalize(station?.name);
  const city = normalize(station?.city);
  const state = normalize(station?.state);
  const address = normalize(station?.address);
  const id = normalize(station?.id);

  if (name === query) return 1000;
  if (city === query) return 900;
  if (id === query) return 850;

  let score = 0;
  if (starts(name, query)) score += 700;
  else if (includes(name, query)) score += 500;

  if (starts(city, query)) score += 450;
  else if (includes(city, query)) score += 300;

  if (state === query) score += 250;
  if (includes(address, query)) score += 150;
  if (includes(id, query)) score += 100;

  const tokens = query.split(' ').filter(Boolean);
  const haystack = [name, city, state, address, id].join(' ');
  if (tokens.length > 1 && tokens.every(token => haystack.includes(token))) score += 225;

  return score;
}

export function searchStations(stations, query, stateFilter = 'All', limit = Infinity) {
  const normalized = normalize(query);
  const rows = (stations || []).filter(station => stateFilter === 'All' || station.state === stateFilter);

  if (!normalized) return rows.slice(0, limit);

  return rows
    .map(station => ({ station, score: stationSearchScore(station, normalized) }))
    .filter(row => row.score > 0)
    .sort((a, b) =>
      b.score - a.score ||
      String(a.station.name || '').localeCompare(String(b.station.name || ''))
    )
    .slice(0, limit)
    .map(row => row.station);
}
