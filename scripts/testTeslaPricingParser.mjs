import { classifySiteContent, inferAvailability, inferPrices, inferSiteDetails, stationCandidates } from './teslaSiteParser.mjs';

const fixture = `
  <section>
    <h3>Pricing for Tesla &amp; Members</h3>
    <p>$0.29 / kWh</p>
    <h3>Pricing for Non-Tesla</h3>
    <p>$0.39 / kWh</p>
    <h3>Congestion fee</h3>
    <p>$1.00 / min</p>
    <p>2 of 8 stalls available</p>
    <p>Open 24/7. Restrooms, Wi-Fi, restaurants and shopping nearby. Trailer friendly.</p>
  </section>
`;

const prices = inferPrices(fixture);
if (prices.memberPricePerKwh !== 0.29) throw new Error(`Member parser failed, expected 0.29 got ${prices.memberPricePerKwh}`);
if (prices.nonMemberPricePerKwh !== 0.39) throw new Error(`Non-member parser failed, expected 0.39 got ${prices.nonMemberPricePerKwh}`);
if (prices.congestionFeePerMinuteMax !== 1) throw new Error(`Congestion parser failed, expected 1 got ${prices.congestionFeePerMinuteMax}`);
if (prices.lowPriceId !== 'low_under_030_kwh') throw new Error(`Low-price flag failed, got ${prices.lowPriceId}`);

const availability = inferAvailability(fixture, { stalls: 8 });
if (availability.availableStalls !== 2) throw new Error(`Availability parser failed, expected 2 got ${availability.availableStalls}`);
if (availability.totalStalls !== 8) throw new Error(`Total stalls parser failed, expected 8 got ${availability.totalStalls}`);
if (availability.utilizationPct !== 0.75) throw new Error(`Utilization parser failed, expected 0.75 got ${availability.utilizationPct}`);

const details = inferSiteDetails({
  bodyText: fixture,
  html: '<title>Lake Grove Supercharger | Tesla</title>',
  station: { address: '313 Smith Haven Mall', city: 'Lake Grove', state: 'NY', stalls: 8, maxKw: 250, lat: 40.86, lng: -73.13 },
  url: 'https://www.tesla.com/findus/location/supercharger/404914',
  candidateReason: 'station_id'
});
if (details.pageTitle !== 'Lake Grove Supercharger | Tesla') throw new Error(`Title parser failed, got ${details.pageTitle}`);
if (!details.amenities.includes('Restrooms')) throw new Error('Amenity parser missed restrooms');
if (!details.amenities.includes('Trailer friendly')) throw new Error('Amenity parser missed trailer-friendly hint');
if (details.chargerGeneration !== 'V3 high-power') throw new Error(`Charger generation failed, got ${details.chargerGeneration}`);

const blocked = classifySiteContent({ bodyText: 'Access Denied You do not have permission to access this page', status: 403, finalUrl: 'https://www.tesla.com/findus/location/supercharger/LakeGroveNYsupercharger' });
if (!blocked.blocked) throw new Error('Blocked Tesla page was not classified as blocked');
if (blocked.validTeslaLocation) throw new Error('Blocked Tesla page should not be treated as a valid station page');

const rateLimited = classifySiteContent({ bodyText: 'Too many requests', status: 429, finalUrl: 'https://www.tesla.com/findus/location/supercharger/LakeGroveNYsupercharger' });
if (!rateLimited.rateLimited || rateLimited.contentSignal !== 'rate_limited') throw new Error('Rate-limited Tesla page was not classified correctly');

const redirectedHome = classifySiteContent({ bodyText: 'Tesla electric vehicles and energy', status: 200, finalUrl: 'https://www.tesla.com/' });
if (redirectedHome.validTeslaLocation) throw new Error('Tesla homepage redirect should not be accepted as a Supercharger page');

const validLocation = classifySiteContent({ bodyText: 'Tesla Supercharger charging stalls and pricing per kWh', status: 200, finalUrl: 'https://www.tesla.com/findus/location/supercharger/LakeGroveNYsupercharger' });
if (!validLocation.validTeslaLocation) throw new Error('Valid Tesla Supercharger page was not recognized');

const numericLocation = classifySiteContent({ bodyText: 'Tesla Supercharger 404914 charging stalls', status: 200, finalUrl: 'https://www.tesla.com/findus/location/supercharger/404914' });
if (numericLocation.pageNotFound || !numericLocation.validTeslaLocation) throw new Error('Numeric location ID containing 404 was mistaken for a missing page');

const candidates = stationCandidates({
  id: '404914',
  name: 'Lake Grove, NY Supercharger',
  city: 'Lake Grove',
  state: 'NY'
});
if (!candidates.some(candidate => candidate.url.endsWith('/404914'))) throw new Error('Numeric Tesla location ID candidate was not generated');
if (!candidates.some(candidate => candidate.reason === 'city_state_slug')) throw new Error('City/state fallback candidate was not generated');

console.log('Tesla pricing parser regression passed.');
