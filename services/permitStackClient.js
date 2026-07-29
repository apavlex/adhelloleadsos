/**
 * Permit Stack — building permit search for lead discovery and enrichment.
 * @see https://api.permit-stack.com/docs
 */

const BASE_URL = 'https://api.permit-stack.com/v1';
const { normalizePermitCategory } = require('./permitStackCategories');

function apiKeyFromEnv(integrationEnv) {
  const fromWs = integrationEnv && integrationEnv.PERMITSTACK_API_KEY;
  if (typeof fromWs === 'string' && fromWs.trim()) return fromWs.trim();
  return String(process.env.PERMITSTACK_API_KEY || '').trim();
}

function isConfigured(integrationEnv) {
  return Boolean(apiKeyFromEnv(integrationEnv));
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
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'X-API-Key': apiKey,
      Accept: 'application/json',
    },
  });
  const body = await res.json().catch(() => ({}));

  if (res.status === 401) {
    throw new Error(
      (body && (body.error || body.message)) || 'Permit Stack API key is invalid or unauthorized.'
    );
  }
  if (!res.ok) {
    throw new Error(
      (body && (body.error || body.message)) || `Permit Stack search failed (HTTP ${res.status})`
    );
  }

  return {
    total: Number(body.total) || 0,
    page: Number(body.page) || 1,
    perPage: Number(body.per_page) || Number(q.get('per_page')) || 25,
    totalCapped: Boolean(body.total_capped),
    results: Array.isArray(body.results) ? body.results : [],
  };
}

async function checkApiConnection(integrationEnv) {
  const data = await searchPermits({ city: 'Austin', state: 'TX', category: 'roofing', per_page: 1 }, integrationEnv);
  const total = data.total != null ? data.total.toLocaleString() : '0';
  return { total, sampleCount: data.results.length };
}

module.exports = {
  BASE_URL,
  apiKeyFromEnv,
  isConfigured,
  buildSearchParams,
  searchPermits,
  checkApiConnection,
};
