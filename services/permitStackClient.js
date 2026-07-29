/**
 * Permit Stack — building permit search for lead discovery and enrichment.
 * @see https://api.permit-stack.com/docs
 */

const BASE_URL = 'https://api.permit-stack.com/v1';
const { normalizePermitCategory } = require('./permitStackCategories');

const SEARCH_TIMEOUT_MS = 120000;
const SEARCH_MAX_ATTEMPTS = 2;

function apiKeyFromEnv(integrationEnv) {
  const fromWs = integrationEnv && integrationEnv.PERMITSTACK_API_KEY;
  if (typeof fromWs === 'string' && fromWs.trim()) return fromWs.trim();
  return String(process.env.PERMITSTACK_API_KEY || '').trim();
}

function isConfigured(integrationEnv) {
  return Boolean(apiKeyFromEnv(integrationEnv));
}

function hasOptionalPermitFilters(params) {
  const p = params && typeof params === 'object' ? params : {};
  return Boolean(
    String(p.keyword || '').trim() ||
      String(p.contractor_name || p.contractorName || p.contractor || '').trim() ||
      String(p.zip_code || p.zipCode || p.zip || '').trim() ||
      String(p.filed_after || p.filedAfter || '').trim() ||
      String(p.filed_before || p.filedBefore || '').trim() ||
      (p.min_value != null && p.min_value !== '')
  );
}

function corePermitSearchParams(params) {
  const p = params && typeof params === 'object' ? params : {};
  return {
    city: String(p.city || '').trim(),
    state: String(p.state || '').trim(),
    category: normalizePermitCategory(p.category),
    page: p.page,
    per_page: p.per_page ?? p.perPage ?? p.maxResults,
    maxResults: p.maxResults,
  };
}

function buildSearchParams(params) {
  const p = params && typeof params === 'object' ? params : {};
  const q = new URLSearchParams();
  const city = String(p.city || '').trim();
  if (city) q.set('city', city);
  const state = String(p.state || '').trim();
  if (state) q.set('state', state.toUpperCase());
  const category = normalizePermitCategory(p.category);
  if (category) q.set('category', category);
  const keyword = String(p.keyword || '').trim();
  if (keyword) q.set('keyword', keyword);
  const contractorName = String(p.contractor_name || p.contractorName || p.contractor || '').trim();
  if (contractorName) q.set('contractor_name', contractorName);
  const zip = String(p.zip_code || p.zipCode || p.zip || '').trim();
  if (zip) q.set('zip_code', zip);
  const filedAfter = String(p.filed_after || p.filedAfter || '').trim();
  if (filedAfter) q.set('filed_after', filedAfter);
  const filedBefore = String(p.filed_before || p.filedBefore || '').trim();
  if (filedBefore) q.set('filed_before', filedBefore);
  if (p.min_value != null && p.min_value !== '') q.set('min_value', String(p.min_value));
  const page = Math.max(1, parseInt(p.page, 10) || 1);
  const perPage = Math.min(100, Math.max(1, parseInt(p.per_page ?? p.perPage ?? p.maxResults, 10) || 25));
  q.set('page', String(page));
  q.set('per_page', String(perPage));
  return q;
}

function parsePermitSearchResponse(body, q) {
  const payload = body && typeof body === 'object' ? body : {};
  return {
    total: Number(payload.total) || 0,
    page: Number(payload.page) || 1,
    perPage: Number(payload.per_page) || Number(q.get('per_page')) || 25,
    totalCapped: Boolean(payload.total_capped),
    results: Array.isArray(payload.results) ? payload.results : [],
  };
}

async function fetchPermitSearch(url, apiKey, attempt = 1) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'X-API-Key': apiKey,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
    const body = await res.json().catch(() => ({}));

    if (res.status === 401) {
      throw new Error(
        (body && (body.detail || body.error || body.message)) ||
          'Permit Stack API key is invalid or unauthorized.'
      );
    }
    if (!res.ok) {
      throw new Error(
        (body && (body.detail || body.error || body.message)) ||
          `Permit Stack search failed (HTTP ${res.status})`
      );
    }
    return body;
  } catch (err) {
    const timedOut = err && err.name === 'AbortError';
    const retriable = timedOut || (err && /fetch failed|network|ECONNRESET|ETIMEDOUT/i.test(String(err.message || '')));
    if (retriable && attempt < SEARCH_MAX_ATTEMPTS) {
      console.warn(`[PERMITSTACK] Search attempt ${attempt} failed, retrying…`, err.message || err);
      await new Promise((r) => setTimeout(r, 1500 * attempt));
      return fetchPermitSearch(url, apiKey, attempt + 1);
    }
    if (timedOut) {
      throw new Error('Permit Stack search timed out. The API can take up to 2 minutes — try again with fewer filters.');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function searchPermits(params, integrationEnv) {
  const apiKey = apiKeyFromEnv(integrationEnv);
  if (!apiKey) {
    throw new Error('Permit Stack is not configured. Add PERMITSTACK_API_KEY in Workspace → Integrations.');
  }
  const q = buildSearchParams(params);
  if (!q.get('city') && !q.get('zip_code')) {
    throw new Error('City or ZIP is required for permit search.');
  }

  const url = `${BASE_URL}/permits/search?${q.toString()}`;
  console.log('[PERMITSTACK] search', url.replace(apiKey, '***'));
  const body = await fetchPermitSearch(url, apiKey);
  const parsed = parsePermitSearchResponse(body, q);
  console.log(
    `[PERMITSTACK] total=${parsed.total} returned=${parsed.results.length} page=${parsed.page}`
  );
  return parsed;
}

/**
 * If optional filters yield zero matches, retry with city/state/category only.
 */
async function searchPermitsWithFallback(params, integrationEnv) {
  const first = await searchPermits(params, integrationEnv);
  if (first.total > 0 || first.results.length > 0 || !hasOptionalPermitFilters(params)) {
    return { ...first, relaxedFilters: false };
  }

  const relaxedParams = corePermitSearchParams(params);
  console.warn('[PERMITSTACK] Zero results with optional filters; retrying core search only.');
  const second = await searchPermits(relaxedParams, integrationEnv);
  return {
    ...second,
    relaxedFilters: true,
    zeroWithOptionalFilters: true,
  };
}

async function checkApiConnection(integrationEnv) {
  const data = await searchPermits({ city: 'Austin', state: 'TX', category: 'roofing', per_page: 1 }, integrationEnv);
  const total = data.total != null ? data.total.toLocaleString() : '0';
  return { total, sampleCount: data.results.length };
}

module.exports = {
  BASE_URL,
  SEARCH_TIMEOUT_MS,
  apiKeyFromEnv,
  isConfigured,
  hasOptionalPermitFilters,
  corePermitSearchParams,
  buildSearchParams,
  searchPermits,
  searchPermitsWithFallback,
  checkApiConnection,
};
