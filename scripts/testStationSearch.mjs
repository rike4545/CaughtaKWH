import assert from 'node:assert/strict';
import { searchStations, stationSearchScore } from '../src/stationSearch.js';

const stations = [
  { id: 'lakegrovenysupercharger', name: 'Lake Grove Supercharger', city: 'Lake Grove', state: 'NY', address: 'Smith Haven Mall' },
  { id: 'smithtown', name: 'Smithtown Supercharger', city: 'Smithtown', state: 'NY', address: 'Main Street' },
  { id: 'lakewoodco', name: 'Lakewood Supercharger', city: 'Lakewood', state: 'CO', address: 'Denver West' }
];

assert.ok(stationSearchScore(stations[0], 'Lake Grove') > stationSearchScore(stations[2], 'Lake Grove'));
assert.equal(searchStations(stations, 'smithtown')[0].id, 'smithtown');
assert.equal(searchStations(stations, 'lake', 'CO')[0].id, 'lakewoodco');
assert.equal(searchStations(stations, 'Smith Haven')[0].id, 'lakegrovenysupercharger');
assert.equal(searchStations(stations, 'does not exist').length, 0);

console.log('Station search tests passed.');
