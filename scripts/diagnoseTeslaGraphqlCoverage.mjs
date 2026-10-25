import fs from 'node:fs/promises';

const token = String(process.env.TESLA_GRAPHQL_TOKEN || '').trim();
if (!token) {
  console.error('Missing TESLA_GRAPHQL_TOKEN. Add it as a repository Actions secret before running this diagnostic.');
  process.exit(2);
}

const endpoint = 'https://akamai-apigateway-charging-ownership.tesla.com/graphql';
const nearbyQuery = `query GetNearbyChargingSites($args: GetNearbyChargingSitesRequestType!) {
  charging { nearbySites(args: $args) {
    sitesAndDistances {
      centroid { latitude longitude }
      id { text }
      localizedSiteName { value }
      maxPowerKw { value }
      totalStalls { value }
      siteType
      accessType
    }
  } }
}`;
const pricingQuery = `query GetChargingSitePricing($siteId: String!, $deviceCountry: String!, $deviceLanguage: String!, $upselling: Boolean) {
  charging { sitePricing(siteId: $siteId deviceCountry: $deviceCountry deviceLanguage: $deviceLanguage upselling: $upselling) {
    userRates { charging { uom rates currencyCode programType } parking { uom rates currencyCode programType } }
    memberRates { charging { uom rates currencyCode programType } parking { uom rates currencyCode programType } }
  } }
}`;

const regions = [
  { name: 'Lake Grove / Long Island, NY', latitude: 40.8529, longitude: -73.1151 },
  { name: 'Newark, NJ', latitude: 40.7357, longitude: -74.1724 },
  { name: 'New Haven, CT', latitude: 41.3083, longitude: -72.9279 }
];

async function graphql(operationName, query, variables) {
  const response = await fetch(`${endpoint}?operationName=${encodeURIComponent(operationName)}`, {
    method: 'POST',
    headers: {
      'User-Agent': 'CaughtaKWH-US-coverage-diagnostic/1.0',
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ operationName, query, variables }),
    signal: AbortSignal.timeout(25000)
  });
  let body;
  try { body = await response.json(); } catch { body = null; }
  if (!response.ok || !body || body.errors?.length) {
    // Do not log response bodies: they may contain account or session details.
    throw new Error(`${operationName} failed (HTTP ${response.status}; GraphQL errors: ${body?.errors?.length || 0})`);
  }
  return body;
}

const report = {
  schemaVersion: 1,
  diagnostic: 'Tesla GraphQL U.S. Supercharger coverage; non-production, read-only',
  generatedAt: new Date().toISOString(),
  endpoint,
  note: 'No production pricing files are read or modified. Results are a point-in-time diagnostic, not a guarantee of full regional coverage.',
  regions: []
};

for (const region of regions) {
  const { latitude, longitude } = region;
  const result = await graphql('GetNearbyChargingSites', nearbyQuery, {
    args: {
      userLocation: { latitude, longitude },
      northwestCorner: { latitude: latitude + 0.35, longitude: longitude - 0.35 },
      southeastCorner: { latitude: latitude - 0.35, longitude: longitude + 0.35 },
      openToNonTeslasFilter: { value: false },
      languageCode: 'en',
      countryCode: 'US'
    }
  });
  const sites = result.data?.charging?.nearbySites?.sitesAndDistances || [];
  const unique = new Map();
  for (const site of sites) {
    const id = site?.id?.text;
    if (id && !unique.has(id)) unique.set(id, site);
  }
  const candidates = [...unique.values()].slice(0, 4);
  const regionReport = {
    region: region.name,
    returnedSites: unique.size,
    pricingTested: 0,
    sites: []
  };
  for (const site of candidates) {
    const entry = {
      id: site.id?.text || null,
      name: site.localizedSiteName?.value || 'Unnamed Tesla site',
      latitude: site.centroid?.latitude ?? null,
      longitude: site.centroid?.longitude ?? null,
      powerKw: site.maxPowerKw?.value ?? null,
      stalls: site.totalStalls?.value ?? null,
      siteType: site.siteType ?? null,
      accessType: site.accessType ?? null,
      pricingQuerySucceeded: false,
      pricing: null
    };
    try {
      const pricingResult = await graphql('GetChargingSitePricing', pricingQuery, {
        siteId: entry.id,
        deviceLanguage: 'en',
        deviceCountry: 'US'
      });
      const pricing = pricingResult.data?.charging?.sitePricing;
      if (pricing) {
        entry.pricingQuerySucceeded = true;
        entry.pricing = {
          user: pricing.userRates ? {
            charging: pricing.userRates.charging ? {
              rates: pricing.userRates.charging.rates ?? [],
              currency: pricing.userRates.charging.currencyCode ?? null,
              unit: pricing.userRates.charging.uom ?? null,
              programType: pricing.userRates.charging.programType ?? null
            } : null,
            parking: pricing.userRates.parking ? {
              rates: pricing.userRates.parking.rates ?? [],
              currency: pricing.userRates.parking.currencyCode ?? null,
              unit: pricing.userRates.parking.uom ?? null,
              programType: pricing.userRates.parking.programType ?? null
            } : null
          } : null,
          member: pricing.memberRates ? {
            charging: pricing.memberRates.charging ? {
              rates: pricing.memberRates.charging.rates ?? [],
              currency: pricing.memberRates.charging.currencyCode ?? null,
              unit: pricing.memberRates.charging.uom ?? null,
              programType: pricing.memberRates.charging.programType ?? null
            } : null,
            parking: pricing.memberRates.parking ? {
              rates: pricing.memberRates.parking.rates ?? [],
              currency: pricing.memberRates.parking.currencyCode ?? null,
              unit: pricing.memberRates.parking.uom ?? null,
              programType: pricing.memberRates.parking.programType ?? null
            } : null
          } : null
        };
      }
    } catch (error) {
      entry.pricingError = error.message;
    }
    regionReport.pricingTested++;
    regionReport.sites.push(entry);
  }
  report.regions.push(regionReport);
}

report.summary = {
  regionsTested: report.regions.length,
  sitesReturned: report.regions.reduce((sum, region) => sum + region.returnedSites, 0),
  sitesPriceTested: report.regions.reduce((sum, region) => sum + region.pricingTested, 0),
  sitesWithPricing: report.regions.reduce((sum, region) => sum + region.sites.filter(site =>
    site.pricingQuerySucceeded && (
      (site.pricing?.user?.charging?.rates?.length || 0) > 0 ||
      (site.pricing?.member?.charging?.rates?.length || 0) > 0
    )).length, 0)
};
await fs.mkdir('artifacts', { recursive: true });
await fs.writeFile('artifacts/tesla-graphql-us-coverage.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({
  generatedAt: report.generatedAt,
  summary: report.summary,
  regions: report.regions.map(region => ({
    region: region.region,
    returnedSites: region.returnedSites,
    pricingTested: region.pricingTested,
    sitesWithPricing: region.sites.filter(site => site.pricingQuerySucceeded &&
      ((site.pricing?.user?.charging?.rates?.length || 0) > 0 ||
       (site.pricing?.member?.charging?.rates?.length || 0) > 0)).length
  }))
}, null, 2));
