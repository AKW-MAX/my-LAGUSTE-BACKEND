const https = require('https');

const normalizeLocationValue = (value) => {
  const text = String(value || '').trim();
  if (!text) return '';

  if (/^([A-Za-z_]+\/[A-Za-z_]+|UTC|GMT)$/u.test(text)) {
    return '';
  }

  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length > 0 ? normalized : '';
};

const normalizeIpAddress = (value) => {
  const text = String(value || '').trim();
  if (!text) return '';

  const withoutBrackets = text.replace(/^\[|\]$/g, '');
  const trimmed = withoutBrackets.trim();

  if (trimmed.startsWith('::ffff:') && /^::ffff:\d+\.\d+\.\d+\.\d+$/.test(trimmed)) {
    return trimmed.replace('::ffff:', '');
  }

  if (trimmed === '::1' || trimmed === 'localhost') {
    return '';
  }

  if (trimmed === '127.0.0.1' || trimmed === '0.0.0.0') {
    return '';
  }

  return trimmed;
};

const isPrivateIp = (ip) => {
  const normalized = normalizeIpAddress(ip);
  if (!normalized) return true;

  if (/^10\./.test(normalized) || /^192\.168\./.test(normalized) || /^172\.(1[6-9]|2\d|3[0-1])\./.test(normalized)) {
    return true;
  }

  return normalized === '127.0.0.1' || normalized === '::1' || normalized === 'localhost';
};

const extractClientIp = (headers = {}) => {
  const headerCandidates = [];
  const forwardedFor = headers['x-forwarded-for'] || headers['X-Forwarded-For'];
  if (forwardedFor) {
    headerCandidates.push(...String(forwardedFor).split(','));
  }

  const realIp = headers['x-real-ip'] || headers['X-Real-IP'];
  if (realIp) headerCandidates.push(String(realIp));

  const cfConnectingIp = headers['cf-connecting-ip'] || headers['CF-Connecting-IP'];
  if (cfConnectingIp) headerCandidates.push(String(cfConnectingIp));

  const clientIp = headers['x-client-ip'] || headers['X-Client-IP'];
  if (clientIp) headerCandidates.push(String(clientIp));

  const forwarded = headers.forwarded || headers.Forwarded;
  if (forwarded) {
    const matches = String(forwarded).match(/for=(?:"?)([^;,"]+)(?:"?)/gi) || [];
    matches.forEach((match) => {
      const value = match.replace(/^for=/i, '').replace(/^"|"$/g, '');
      headerCandidates.push(value);
    });
  }

  const normalizedCandidates = headerCandidates
    .map((value) => normalizeIpAddress(value))
    .filter(Boolean);

  const publicCandidate = normalizedCandidates.find((candidate) => !isPrivateIp(candidate));
  return publicCandidate || normalizedCandidates[0] || '';
};

const resolveLocationFromIp = async (ip, fetchImpl = null) => {
  const normalizedIp = normalizeIpAddress(ip);
  if (!normalizedIp || isPrivateIp(normalizedIp)) {
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
    const resolvedUrl = providerUrl.replace('{ip}', encodeURIComponent(normalizedIp)) + providerPath.replace('{ip}', encodeURIComponent(normalizedIp));
    const response = await fetcher(resolvedUrl);
    const payload = await response.json();

    return {
      country: normalizeLocationValue(payload?.country_name || payload?.country || payload?.countryCode || ''),
      region: normalizeLocationValue(payload?.region || payload?.region_name || payload?.region_code || ''),
    };
  } catch (error) {
    return { country: '', region: '' };
  }
};

module.exports = {
  normalizeLocationValue,
  normalizeIpAddress,
  extractClientIp,
  resolveLocationFromIp,
};
