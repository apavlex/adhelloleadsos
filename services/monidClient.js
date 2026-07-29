/**
 * Monid — unified gateway for enrichment APIs (Apollo, PDL, etc.).
 * Docs: https://docs.monid.ai/api/overview.html
 */

const MONID_API_BASE = 'https://api.monid.ai';

function resolveConfig(integrationEnv) {
  const env = integrationEnv || {};
  const apiKey = String(env.MONID_API_KEY || process.env.MONID_API_KEY || '').trim();
  const apiBase = String(env.MONID_API_BASE || process.env.MONID_API_BASE || MONID_API_BASE).trim();
  return {
    apiKey,
    apiBase: apiBase.replace(/\/$/, '') || MONID_API_BASE,
  };
}

function isConfigured(integrationEnv) {
  return Boolean(resolveConfig(integrationEnv).apiKey);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatApiError(status, data) {
  if (data && data.error && typeof data.error.message === 'string') {
    return data.error.message;
  }
  if (data && typeof data.message === 'string') return data.message;
  return `Monid API error (${status})`;
}

async function monidFetch(path, { integrationEnv, method = 'GET', body } = {}) {
  const { apiKey, apiBase } = resolveConfig(integrationEnv);
  if (!apiKey) throw new Error('Monid API key is not configured.');

  const url = `${apiBase}${path.startsWith('/') ? path : `/${path}`}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (res.status === 401) {
    throw new Error('Monid API key is invalid or unauthorized.');
  }
  if (!res.ok && res.status !== 202) {
    const err = new Error(formatApiError(res.status, data));
    err.status = res.status;
    err.body = data;
    throw err;
  }

  return { res, data };
}

/**
 * Poll GET /v1/runs/:runId until terminal status.
 */
async function pollRun(runId, integrationEnv, maxWaitMs = 90_000) {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const { data } = await monidFetch(`/v1/runs/${encodeURIComponent(runId)}`, { integrationEnv });
    const status = String(data.status || '').toUpperCase();
    if (status === 'COMPLETED' || status === 'FAILED' || status === 'STOPPED' || status === 'TIME_OUT') {
      return data;
    }
    await sleep(2000);
  }
  throw new Error('Monid run timed out.');
}

/**
 * Execute a Monid data endpoint (sync or async with polling).
 * @param {{ provider: string, endpoint: string, input?: object, query?: object, path?: object, integrationEnv?: object, maxWaitMs?: number }} opts
 */
async function runEndpoint(opts = {}) {
  const { provider, endpoint, input, query, path, integrationEnv, maxWaitMs } = opts;
  if (!provider || !endpoint) {
    throw new Error('Monid run requires provider and endpoint.');
  }

  const payload = {
    provider: String(provider),
    endpoint: String(endpoint),
    input: input && typeof input === 'object' ? input : {},
  };
  if (query && typeof query === 'object' && Object.keys(query).length) payload.query = query;
  if (path && typeof path === 'object' && Object.keys(path).length) payload.path = path;

  const { res, data } = await monidFetch('/v1/run', {
    integrationEnv,
    method: 'POST',
    body: payload,
  });

  let run = data;
  if (res.status === 202 && data.runId) {
    run = await pollRun(data.runId, integrationEnv, maxWaitMs);
  }

  if (String(run.status || '').toUpperCase() === 'FAILED') {
    throw new Error((run.error && run.error.message) || 'Monid run failed.');
  }

  const httpStatus = run.providerResponse && run.providerResponse.httpStatus;
  if (httpStatus === 404) {
    return { ...run, noMatch: true };
  }

  return run;
}

async function testConnection(integrationEnv) {
  const { data } = await monidFetch('/v1/wallet/balance', { integrationEnv });
  const raw = data.balance && data.balance.value != null ? data.balance.value : data.balance;
  const bal = Number(raw);
  const label = Number.isFinite(bal) ? `$${bal.toFixed(2)}` : 'unknown';
  return { message: `Connected · balance ${label}`, balance: bal };
}

module.exports = {
  MONID_API_BASE,
  resolveConfig,
  isConfigured,
  runEndpoint,
  pollRun,
  testConnection,
};
