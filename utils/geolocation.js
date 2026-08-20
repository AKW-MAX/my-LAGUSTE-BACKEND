const https = require('https');

const resolveLocationFromIp = async (ip, fetchImpl = null) => {
  if (!ip || ip === '::1' || ip === '127.0.0.1' || ip === 'localhost') {
    return { country: '', region: '' };
  }

  const providerUrl = process.env.GEOLOCATION_PROVIDER_URL || 'https://ipapi.co';
  const providerPath = process.env.GEOLOCATION_PROVIDER_PATH || '/{ip}/json/';

  const fetcher = fetchImpl || ((url) => new Promise((resolve, reject) => {
    https.get(url, (response) => {
      let data = '';
      response.on('data', (chunk) => {
        data += chunk;
      });
      response.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ ok: response.statusCode >= 200 && response.statusCode < 300, json: async () => parsed });
        } catch (error) {
          resolve({ ok: false, json: async () => ({}) });
        }
      });
    }).on('error', reject);
  }));

  try {
    const resolvedUrl = providerUrl.replace('{ip}', encodeURIComponent(ip)) + providerPath.replace('{ip}', encodeURIComponent(ip));
    const response = await fetcher(resolvedUrl);
    const payload = await response.json();

    return {
      country: String(payload?.country_name || payload?.country || payload?.countryCode || '').trim(),
      region: String(payload?.region || payload?.region_name || payload?.region_code || '').trim(),
    };
  } catch (error) {
    return { country: '', region: '' };
  }
};

module.exports = {
  resolveLocationFromIp,
};
