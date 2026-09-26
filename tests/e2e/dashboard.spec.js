import { expect, test } from '@playwright/test';

const stations = [
  {
    id: 'lakegrovenysupercharger',
    name: 'Lake Grove Supercharger',
    city: 'Lake Grove',
    state: 'NY',
    address: 'Smith Haven Mall, Lake Grove, NY',
    lat: 40.8584,
    lng: -73.1162,
    stalls: 12,
    maxKw: 250,
    lastScrapedAt: '2026-09-25T20:00:00Z',
    lastSuccessfulScrapeAt: '2026-09-25T20:00:00Z',
    lastScrapeHadPrice: true
  },
  {
    id: 'smithtown',
    name: 'Smithtown Supercharger',
    city: 'Smithtown',
    state: 'NY',
    address: 'Main Street, Smithtown, NY',
    lat: 40.8559,
    lng: -73.2007
  },
  {
    id: 'lakewoodco',
    name: 'Lakewood Supercharger',
    city: 'Lakewood',
    state: 'CO',
    address: 'Denver West, Lakewood, CO',
    lat: 39.7047,
    lng: -105.0814
  }
];

const predictions = [
  {
    stationId: 'lakegrovenysupercharger',
    membershipType: 'member',
    latestObservedPrice: 0.30,
    latestObservedAt: new Date().toISOString(),
    latestObservationAgeHours: 0.2,
    isCurrentPrice: true,
    expectedPrice: 0.27,
    averageObservedPrice: 0.30,
    bestHour: 2,
    bestMinute: 0,
    sampleCount: 10,
    slots: []
  }
];

const history = [
  {
    capturedAt: new Date().toISOString(),
    memberPricePerKwh: 0.30,
    nonMemberPricePerKwh: 0.42,
    congestionFeePerMinuteMax: 0.50
  }
];

async function mockData(page) {
  await page.route('**/data/stations.json*', route => route.fulfill({ json: stations }));
  await page.route('**/data/predictions.json*', route => route.fulfill({ json: predictions }));
  await page.route('**/data/dashboard-health.json*', route => route.fulfill({ json: { summary: {}, improvementQueue: [], refreshTargets: [], statePriorities: [] } }));
  await page.route('**/data/history/lakegrovenysupercharger.json*', route => route.fulfill({ json: history }));
  await page.route('**/data/history/none.json*', route => route.fulfill({ json: [] }));
}

test.beforeEach(async ({ page }) => {
  await mockData(page);
  await page.goto('/');
});

test('search ranks the strongest charger match first', async ({ page }) => {
  const search = page.getByLabel('Search station, city, state, address, or station ID');
  await search.fill('Lake Grove');

  const results = page.locator('#charger-results button');
  await expect(results).toHaveCount(1);
  await expect(results.first()).toContainText('Lake Grove Supercharger');
  await expect(page.getByRole('status')).toContainText('1 matching chargers');
});

test('dashboard navigation switches between major views', async ({ page }) => {
  await page.getByRole('button', { name: 'Transparency' }).click();
  await expect(page.getByRole('heading', { name: 'How much of the network is publicly priced?' })).toBeVisible();

  await page.getByRole('button', { name: 'System health' }).click();
  await expect(page.getByRole('heading', { name: 'The system is learning in public' })).toBeVisible();

  await page.getByRole('button', { name: 'Find chargers', exact: true }).click();
  await expect(page.getByText('Find chargers nearby')).toBeVisible();
});

test('selected charger exposes pricing and charge-cost estimate', async ({ page }) => {
  const search = page.getByLabel('Search station, city, state, address, or station ID');
  await search.fill('Lake Grove');
  await page.getByRole('button', { name: /Lake Grove Supercharger/ }).click();

  await expect(page.locator('.content').getByRole('heading', { name: 'Lake Grove Supercharger' }).first()).toBeVisible();
  await expect(page.locator('.priceMatrix').getByText('$0.30/kWh')).toBeVisible();
  await expect(page.getByRole('heading', { name: /to 80%/ })).toContainText('$9.00');

  await page.getByLabel('Arrive at (%)').fill('20');
  await page.getByLabel('Charge to (%)').fill('80');
  await expect(page.getByRole('heading', { name: /to 80%/ })).toContainText('$13.50');
});
