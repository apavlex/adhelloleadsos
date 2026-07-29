/**
 * Per-provider integration connection tests (Find Leads, enrich, audits).
 */

const { ApifyClient } = require('apify-client');
const rapidapiClient = require('./rapidapiLocalBusiness');
const searchapiGoogleLocal = require('./searchapiGoogleLocal');
const serpapiGoogleLocal = require('./serpapiGoogleLocal');
const outscraperClient = require('./outscraperClient');
const oxylabsGoogleLocal = require('./oxylabsGoogleLocal');
const crawl4aiClient = require('./crawl4aiClient');
const firecrawl = require('./firecrawl');
const betterContactClient = require('./betterContactClient');
const permitStackClient = require('./permitStackClient');
const { resolvePageSpeedApiKey, PAGESPEED_ENDPOINT } = require('./pageSpeedInsights');
const { FIELD_TO_ENV, INTEGRATION_FIELDS } = require('./workspaceIntegrations');
const ghlClient = require('./ghlClient');
const lobClient = require('./lobClient');
const commsClient = require('./commsClient');
const saperlyClient = require('./saperlyClient');
const tikHubClient = require('./tikHubClient');
const monidClient = require('./monidClient');

const SAMPLE_SEARCH = {
  keyword: 'coffee shop',
  city: 'Austin',
  state: 'TX',
  maxResults: 1,
};

/** @type {Record<string, { label: string, fields: string[] }>} */
const PROVIDERS = {
  rapidapi: {
    label: 'RapidAPI',
    fields: [
      'rapidapiKey',
      'rapidapiHost',
      'rapidapiLocalBusinessEndpoint',
      'rapidapiSearchQueryParam',
      'rapidapiSearchLimitParam',
    ],
  },
  searchapi: { label: 'SearchAPI.io', fields: ['searchapiApiKey'] },
  serpapi: { label: 'SerpAPI', fields: ['serpapiApiKey'] },
  outscraper: { label: 'Outscraper', fields: ['outscraperApiKey', 'outscraperApiBase'] },
  apify: { label: 'Apify', fields: ['apifyApiToken'] },
  oxylabs: { label: 'Oxylabs', fields: ['oxylabsUsername', 'oxylabsPassword'] },
  bettercontact: { label: 'BetterContact', fields: ['bettercontactApiKey'] },
  permitstack: { label: 'Permit Stack', fields: ['permitStackApiKey'] },
  firecrawl: { label: 'Firecrawl', fields: ['firecrawlApiKey'] },
  crawl4ai: { label: 'Crawl4AI', fields: ['crawl4aiBaseUrl', 'crawl4aiApiToken'] },
  pagespeed: { label: 'PageSpeed Insights', fields: ['pagespeedApiKey'] },
  ghl: { label: 'Go High Level', fields: ['ghlApiKey', 'ghlLocationId'] },
  lob: {
    label: 'Lob Direct Mail',
    fields: ['lobApiKey', 'lobFromAddressLine1', 'lobFromCity', 'lobFromState', 'lobFromZip'],
  },
  comms: {
    label: 'Comms by Osis (iMessage / SMS)',
    fields: ['commsApiKey'],
  },
  saperly: {
    label: 'Saperly (SMS / voice)',
    fields: ['saperlyApiKey', 'saperlyFromNumberId'],
  },
  tikhub: {
    label: 'TikHub (social profile search)',
    fields: ['tikhubApiKey'],
  },
  monid: {
    label: 'Monid (company enrichment)',
    fields: ['monidApiKey'],
  },
};

function listProviderIds() {
  return Object.keys(PROVIDERS);
}

function providerLabel(id) {
  const p = PROVIDERS[String(id || '').toLowerCase()];
  return (p && p.label) || String(id || '');
}

/**
 * Overlay non-empty integration form fields onto resolved env (draft test before save).
 * @param {Record<string, string>} baseEnv
 * @param {object} [body]
 */
function mergeBodyIntoIntegrationEnv(baseEnv, body) {
  const out = { ...(baseEnv || {}) };
  if (!body || typeof body !== 'object') return out;
  for (const field of INTEGRATION_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(body, field)) continue;
    const envName = FIELD_TO_ENV[field];
    const s = String(body[field] ?? '').trim();
    if (s) out[envName] = s;
  }
  return out;
}

async function runWithTimeout(label, fn, ms = 12000) {
  const started = Date.now();
  const timeout = new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`${label} test timed out`)), ms);
  });
  try {
    const result = await Promise.race([fn(), timeout]);
    return {
      id: label,
      ok: true,
      message: (result && result.message) || 'Connected',
      elapsedMs: Date.now() - started,
    };
  } catch (e) {
    return {
      id: label,
      ok: false,
      message: e && e.message ? String(e.message) : 'Failed',
      elapsedMs: Date.now() - started,
    };
  }
}

async function testRapidapi(integrationEnv) {
  if (!rapidapiClient.isConfigured(integrationEnv)) {
    throw new Error('Missing RAPIDAPI_KEY — paste your key above or save first.');
  }
  const rows = await rapidapiClient.searchGoogleMaps({
    ...SAMPLE_SEARCH,
    integrationEnv,
  });
  const n = Array.isArray(rows) ? rows.length : 0;
  if (n === 0) {
    return {
      message:
        'API responded but returned 0 places for the sample search. Check host, endpoint URL, and query/limit param names on your RapidAPI subscription.',
    };
  }
  const sample = rows[0];
  const name = sample && (sample.title || sample.name) ? String(sample.title || sample.name) : 'place';
  return { message: `Connected — sample search returned ${n} place(s), e.g. "${name.slice(0, 48)}"` };
}

async function testSearchapi(integrationEnv) {
  if (!searchapiGoogleLocal.isConfigured(integrationEnv)) {
    throw new Error('Missing SEARCHAPI_API_KEY');
  }
  const rows = await searchapiGoogleLocal.searchGoogleMaps({
    ...SAMPLE_SEARCH,
    integrationEnv,
  });
  const n = Array.isArray(rows) ? rows.length : 0;
  return {
    message:
      n > 0
        ? `Connected — Google Local sample returned ${n} result(s)`
        : 'API responded but returned 0 Google Local results for the sample search.',
  };
}

async function testSerpapi(integrationEnv) {
  if (!serpapiGoogleLocal.isConfigured(integrationEnv)) {
    throw new Error('Missing SERPAPI_API_KEY');
  }
  const rows = await serpapiGoogleLocal.searchGoogleMaps({
    ...SAMPLE_SEARCH,
    integrationEnv,
  });
  const n = Array.isArray(rows) ? rows.length : 0;
  return {
    message:
      n > 0
        ? `Connected — Google Local sample returned ${n} result(s)`
        : 'API responded but returned 0 Google Local results for the sample search.',
  };
}

async function testOutscraper(integrationEnv) {
  const health = await outscraperClient.pingHealth(integrationEnv);
  if (!health || !health.ok) throw new Error((health && health.message) || 'Outscraper unavailable');
  return { message: health.message || 'Connected' };
}

async function testOxylabs(integrationEnv) {
  if (!oxylabsGoogleLocal.isConfigured(integrationEnv)) {
    throw new Error('Missing OXYLABS_USERNAME or OXYLABS_PASSWORD');
  }
  const rows = await oxylabsGoogleLocal.searchGoogleMaps({
    ...SAMPLE_SEARCH,
    integrationEnv,
  });
  const n = Array.isArray(rows) ? rows.length : 0;
  return {
    message:
      n > 0
        ? `Connected — Google Local sample returned ${n} result(s)`
        : 'API responded but returned 0 local results for the sample search.',
  };
}

async function testApify(integrationEnv) {
  const token = String((integrationEnv && integrationEnv.APIFY_API_TOKEN) || '').trim();
  if (!token) throw new Error('Missing APIFY_API_TOKEN');
  const client = new ApifyClient({ token });
  const user = await client.user().get();
  return { message: `Connected as ${user && user.username ? user.username : 'account'}` };
}

async function testFirecrawl(integrationEnv) {
  const key = String((integrationEnv && integrationEnv.FIRECRAWL_API_KEY) || '').trim();
  if (!key) throw new Error('Missing FIRECRAWL_API_KEY');
  await firecrawl.searchBusiness('plumber dallas tx', integrationEnv);
  return { message: 'Connected (search ok)' };
}

async function testCrawl4ai(integrationEnv) {
  const health = await crawl4aiClient.pingHealth(integrationEnv);
  if (!health || !health.ok) throw new Error((health && health.message) || 'Crawl4AI unavailable');
  return { message: health.message || 'Connected' };
}

async function testBetterContact(integrationEnv) {
  if (!betterContactClient.isConfigured(integrationEnv)) {
    throw new Error('Missing BETTERCONTACT_API_KEY — paste your key and save, or type it before testing.');
  }
  const { creditsLeft, email } = await betterContactClient.checkApiConnection(integrationEnv);
  if (creditsLeft != null) {
    const who = email ? ` for ${email}` : '';
    return { message: `Connected${who} — ${creditsLeft} credits remaining` };
  }
  return { message: 'Connected (API key accepted)' };
}

async function testPermitStack(integrationEnv) {
  if (!permitStackClient.isConfigured(integrationEnv)) {
    throw new Error('Missing PERMITSTACK_API_KEY — paste your Permit Stack key and save, or type it before testing.');
  }
  const { total } = await permitStackClient.checkApiConnection(integrationEnv);
  return { message: `Connected — ${total}+ permits in sample Austin roofing search` };
}

async function testPageSpeed(integrationEnv) {
  const apiKey = resolvePageSpeedApiKey(integrationEnv);
  if (!apiKey) throw new Error('Missing PAGESPEED_API_KEY');
  const params = new URLSearchParams({
    url: 'https://example.com',
    key: apiKey,
    strategy: 'mobile',
    category: 'performance',
  });
  const res = await fetch(`${PAGESPEED_ENDPOINT}?${params.toString()}`, {
    headers: { Accept: 'application/json' },
  });
  const body = await res.json().catch(() => ({}));
  if (res.status === 403 || res.status === 401) {
    throw new Error(
      (body && body.error && body.error.message) ||
        'PageSpeed API key rejected — enable PageSpeed Insights API and billing in Google Cloud.'
    );
  }
  if (!res.ok) {
    throw new Error(
      (body && body.error && body.error.message) ||
        `PageSpeed API error (${res.status})`
    );
  }
  return { message: 'Connected (PageSpeed API accepted key)' };
}

async function testGhl(integrationEnv) {
  if (!ghlClient.isConfigured(integrationEnv)) {
    throw new Error('Missing GHL_API_KEY or GHL_LOCATION_ID — paste both and save, or type them before testing.');
  }
  const result = await ghlClient.testConnection(integrationEnv);
  return { message: result.message || 'Connected' };
}

async function testLob(integrationEnv) {
  if (!lobClient.isConfigured(integrationEnv)) {
    throw new Error('Missing Lob API key or return address — paste all fields and save, or type them before testing.');
  }
  const result = await lobClient.testConnection(integrationEnv);
  return { message: result.message || 'Connected' };
}

async function testComms(integrationEnv) {
  if (!commsClient.isConfigured(integrationEnv)) {
    throw new Error('Missing Comms API key — paste your Messages API key from comms.osis.co and save.');
  }
  const result = await commsClient.testConnection(integrationEnv);
  return { message: result.message || 'Connected' };
}

async function testSaperly(integrationEnv) {
  if (!String(integrationEnv.SAPERLY_API_KEY || '').trim()) {
    throw new Error('Missing Saperly API key — paste your key from app.saperly.ai and save.');
  }
  const result = await saperlyClient.testConnection(integrationEnv);
  return { message: result.message || 'Connected' };
}

async function testTikHub(integrationEnv) {
  if (!tikHubClient.isConfigured(integrationEnv)) {
    throw new Error('Missing TikHub API key — paste your key from user.tikhub.io and save.');
  }
  const result = await tikHubClient.testConnection(integrationEnv);
  return { message: result.message || 'Connected' };
}

async function testMonid(integrationEnv) {
  if (!monidClient.isConfigured(integrationEnv)) {
    throw new Error('Missing Monid API key — paste your key from app.monid.ai and save.');
  }
  const result = await monidClient.testConnection(integrationEnv);
  return { message: result.message || 'Connected' };
}

const RUNNERS = {
  rapidapi: () => testRapidapi,
  searchapi: () => testSearchapi,
  serpapi: () => testSerpapi,
  outscraper: () => testOutscraper,
  apify: () => testApify,
  oxylabs: () => testOxylabs,
  firecrawl: () => testFirecrawl,
  crawl4ai: () => testCrawl4ai,
  bettercontact: () => testBetterContact,
  permitstack: () => testPermitStack,
  pagespeed: () => testPageSpeed,
  ghl: () => testGhl,
  lob: () => testLob,
  comms: () => testComms,
  saperly: () => testSaperly,
  tikhub: () => testTikHub,
  monid: () => testMonid,
};

/**
 * @param {string} providerId
 * @param {Record<string, string>} integrationEnv
 */
async function runProviderTest(providerId, integrationEnv) {
  const id = String(providerId || '').toLowerCase();
  const runnerFactory = RUNNERS[id];
  if (!runnerFactory) {
    throw new Error(`Unknown provider: ${providerId}`);
  }
  const label = providerLabel(id);
  const timeoutMs =
    id === 'rapidapi' || id === 'searchapi' || id === 'serpapi' || id === 'oxylabs' ? 90000 : 12000;
  const result = await runWithTimeout(label, () => runnerFactory()(integrationEnv), timeoutMs);
  return { ...result, provider: id };
}

/**
 * @param {Record<string, string>} integrationEnv
 */
async function runAllProviderTests(integrationEnv) {
  const ids = listProviderIds();
  return Promise.all(ids.map((id) => runProviderTest(id, integrationEnv)));
}

module.exports = {
  PROVIDERS,
  listProviderIds,
  providerLabel,
  mergeBodyIntoIntegrationEnv,
  runProviderTest,
  runAllProviderTests,
};
