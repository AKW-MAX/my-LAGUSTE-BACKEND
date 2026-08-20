const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveLocationFromIp } = require('../utils/geolocation');

test('resolves country and region from geolocation provider data', async () => {
  const location = await resolveLocationFromIp('8.8.8.8', async () => ({
    ok: true,
    json: async () => ({
      country_name: 'United States',
      region: 'California',
    }),
  }));

  assert.equal(location.country, 'United States');
  assert.equal(location.region, 'California');
});

test('returns empty values when the provider does not return location data', async () => {
  const location = await resolveLocationFromIp('127.0.0.1', async () => ({
    ok: false,
    json: async () => ({ error: true }),
  }));

  assert.equal(location.country, '');
  assert.equal(location.region, '');
});
