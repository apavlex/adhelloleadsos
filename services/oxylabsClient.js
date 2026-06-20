/**
 * Oxylabs Web Scraper API — Realtime integration.
 * https://developers.oxylabs.io/get-started/quick-start-web-scraper-api
 *
 * Uses API User credentials (Basic auth), not dashboard login.
 */

const DEFAULT_ENDPOINT = 'https://realtime.oxylabs.io/v1/queries';

function endpoint(integrationEnv) {
  const fromWs = integrationEnv && integrationEnv.OXYLABS_REALTIME_URL;
  const fromEnv = process.env.OXYLABS_REALTIME_URL;
  const raw = (typeof fromWs === 'string' && fromWs.trim()) || String(fromEnv || '').trim();
  return raw || DEFAULT_ENDPOINT;
}

function username(integrationEnv) {
  const fromWs = integrationEnv && integrationEnv.OXYLABS_USERNAME;
  if (typeof fromWs === 'string' && fromWs.trim()) return fromWs.trim();
  return String(process.env.OXYLABS_USERNAME || '').trim();
}

function password(integrationEnv) {
  const fromWs = integrationEnv && integrationEnv.OXYLABS_PASSWORD;
  if (typeof fromWs === 'string' && fromWs.trim()) return fromWs.trim();
  return String(process.env.OXYLABS_PASSWORD || '').trim();
}

function isConfigured(integrationEnv) {
  return Boolean(username(integrationEnv) && password(integrationEnv));
}

function basicAuthHeader(integrationEnv) {
  const user = username(integrationEnv);
  const pass = password(integrationEnv);
  if (!user || !pass) {
    throw new Error('OXYLABS_USERNAME and OXYLABS_PASSWORD are not set (workspace integrations or environment).');
  }
  return `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
}

/**
 * @param {object} payload — Oxylabs query body (source, query, url, parse, etc.)
 * @param {Record<string,string>} [integrationEnv]
 * @param {{ timeoutMs?: number }} [options]
 */
async function postQuery(payload, integrationEnv, options = {}) {
  if (!isConfigured(integrationEnv)) {
    throw new Error('Oxylabs is not configured. Add OXYLABS_USERNAME and OXYLABS_PASSWORD under Workspace → Integrations.');
  }

  const timeoutMs = Math.max(15000, parseInt(options.timeoutMs, 10) || 120000);
  const res = await fetch(endpoint(integrationEnv), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: basicAuthHeader(integrationEnv),
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  });

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Oxylabs returned non-JSON (${res.status})`);
  }

  if (!res.ok) {
    const msg =
      (data && data.message) ||
      (data && data.error) ||
      (Array.isArray(data.errors) && data.errors[0] && data.errors[0].message) ||
      text.slice(0, 240);
    throw new Error(`Oxylabs HTTP ${res.status}: ${msg}`);
  }

  return data;
}

function resultRows(data) {
  return data && Array.isArray(data.results) ? data.results : [];
}

/**
 * Normalize Oxylabs content field (object or JSON string) into a plain object.
 */
function extractContent(row) {
  if (!row || row.content == null) return null;
  let content = row.content;
  if (typeof content === 'string') {
    const trimmed = content.trim();
    if (!trimmed) return null;
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        content = JSON.parse(trimmed);
      } catch {
        return { html: trimmed };
      }
    } else {
      return { html: trimmed };
    }
  }
  return content && typeof content === 'object' ? content : null;
}

/**
 * Parsed google_search content lives under content.results or results.
 */
function parsedGoogleResults(content) {
  if (!content || typeof content !== 'object') return null;
  if (content.results && typeof content.results === 'object') return content.results;
  if (content.content && content.content.results) return content.content.results;
  return null;
}

function geoLocationForCityState(city, state) {
  const c = String(city || '').trim();
  const st = String(state || '').trim();
  if (!c && !st) return 'United States';
  const { countryForState } = require('./geocodeLocation');
  const country = st ? countryForState(st) : 'United States';
  if (country === 'Canada') return [c, st, 'Canada'].filter(Boolean).join(',');
  return [c, st, 'United States'].filter(Boolean).join(',');
}

module.exports = {
  isConfigured,
  postQuery,
  resultRows,
  extractContent,
  parsedGoogleResults,
  geoLocationForCityState,
  username,
  password,
};
