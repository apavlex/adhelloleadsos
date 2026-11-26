/**
 * One door to treg.to. Borrowed from treg's product integration contract
 * (https://treg.to/integrate.md): every call goes through this function, the
 * workspace is tagged on X-Treg-Meta, and team-level billing errors stay here.
 *
 * Treg holds the provider keys. This app sends the real request and stores the
 * call id. The top-bar search setting decides whether searches use this door
 * or the built-in providers.
 */

const crypto = require('crypto');

const DEFAULT_BASE = 'https://treg.to';
const USAGE_CAP = 40;

function baseUrl() {
  return String(process.env.TREG_BASE_URL || DEFAULT_BASE).replace(/\/$/, '');
}

function token() {
  return String(process.env.TREG_TOKEN || '').trim();
}

function isConfigured() {
  return Boolean(token());
}

/** Tag values may be letters, digits, and . _ - : — never an email. */
function customerTag(workspaceId) {
  const raw = String(workspaceId || 'workspace').trim();
  let v = raw.replace(/[^A-Za-z0-9._:-]/g, '_').replace(/^_+/, '').slice(0, 128);
  if (!v) v = 'workspace';
  if (v.includes('@') || /^[^@\s]+@[^@\s]+$/.test(raw)) v = 'workspace';
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(v)) v = 'workspace';
  return v;
}

function featureTag(feature) {
  const v = String(feature || 'search').replace(/[^A-Za-z0-9._:-]/g, '').slice(0, 64);
  return v || 'search';
}

function workspaceIdFrom(opts) {
  if (opts && opts.workspaceId) return opts.workspaceId;
  const env = opts && opts.integrationEnv;
  if (env && env.ADHELLO_WORKSPACE_ID) return env.ADHELLO_WORKSPACE_ID;
  return 'workspace';
}

function recordUsage(customer, row) {
  try {
    const db = require('./database');
    const key = `treg:usage:${customer}`;
    let list = [];
    const raw = db.getKvSync(key);
    if (raw) {
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (Array.isArray(parsed)) list = parsed;
    }
    list.unshift(row);
    db.setKvSync(key, JSON.stringify(list.slice(0, USAGE_CAP)));
  } catch (err) {
    console.warn('[treg] usage log failed:', err && err.message ? err.message : err);
  }
}

function lastUsage(workspaceId) {
  try {
    const db = require('./database');
    const raw = db.getKvSync(`treg:usage:${customerTag(workspaceId)}`);
    if (!raw) return null;
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) && parsed.length ? parsed[0] : null;
  } catch {
    return null;
  }
}

/**
 * Team-level refusals include the operator's balance. Never pass those through.
 * A provider error (no X-Treg-Error) is the upstream's own message.
 */
function safeUserMessage(status, tregError, body) {
  if (tregError) {
    if (status === 402) {
      return 'Treg search is paused until the Treg balance is topped up. Switch the top bar back to Default, or add credit at treg.to.';
    }
    if (status === 429) {
      return 'Treg search hit its spend limit for now. Try again later, or switch the top bar back to Default.';
    }
    if (status === 403) return 'Treg refused this search for this workspace.';
    if (status === 401) return 'Treg rejected the API token. Check TREG_TOKEN on the server.';
    return 'Treg could not run this search.';
  }
  const msg = body && (body.message || body.error || body.status_message);
  if (typeof msg === 'string' && msg.trim() && !/balance_micro|topup_url|insufficient_balance/i.test(msg)) {
    return msg.trim().slice(0, 240);
  }
  return `Search provider returned HTTP ${status}.`;
}

/**
 * @param {string} endpointId catalog id, e.g. treg.google.serp.maps
 * @param {{ method?: string, query?: object, body?: object, feature?: string, workspaceId?: string, integrationEnv?: object, maxCostUsd?: number, idempotencyKey?: string, timeoutMs?: number, fetchImpl?: typeof fetch }} [opts]
 */
async function tregCall(endpointId, opts = {}) {
  if (!isConfigured()) {
    const err = new Error('Treg is turned on, but TREG_TOKEN is not set on the server.');
    err.code = 'TREG_NOT_CONFIGURED';
    err.status = 409;
    throw err;
  }
  const id = String(endpointId || '').trim();
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,180}$/.test(id) ||
    id.includes('..') ||
    id.includes('//') ||
    id.includes('://')
  ) {
    throw new Error('Invalid Treg endpoint.');
  }

  const method = String(opts.method || 'POST').toUpperCase();
  const feature = featureTag(opts.feature);
  const customer = customerTag(workspaceIdFrom(opts));
  const headers = {
    'X-Treg-Token': token(),
    'X-Treg-Meta': `customer=${customer}, feature=${feature}`,
    Accept: 'application/json',
    'Idempotency-Key':
      opts.idempotencyKey ||
      `adhello-${feature}-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`,
  };
  if (opts.maxCostUsd != null && opts.maxCostUsd !== '') {
    headers['X-Treg-Route-Max-Cost'] = String(opts.maxCostUsd);
  }

  let url = `${baseUrl()}/call/${id}`;
  if (opts.query && typeof opts.query === 'object') {
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(opts.query)) {
      if (value == null || value === '') continue;
      qs.set(key, String(value));
    }
    const serialized = qs.toString();
    if (serialized) url += `?${serialized}`;
  }
  if (opts.body != null) headers['Content-Type'] = 'application/json';

  const fetchImpl = opts.fetchImpl || fetch;
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeoutMs = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : 70000;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

  let res;
  try {
    res = await fetchImpl(url, {
      method,
      headers,
      body: opts.body != null ? JSON.stringify(opts.body) : undefined,
      signal: controller ? controller.signal : undefined,
    });
  } catch (err) {
    if (err && (err.name === 'AbortError' || err.code === 'ABORT_ERR')) {
      const timeout = new Error('Treg search timed out.');
      timeout.code = 'TREG_TIMEOUT';
      throw timeout;
    }
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }

  const tregError = String(res.headers.get('x-treg-error') || '') === '1';
  const callId = res.headers.get('x-treg-call-id') || '';
  const costHeader = res.headers.get('x-treg-cost-micro');
  const costMicro = costHeader == null || costHeader === '' ? 0 : Number(costHeader) || 0;
  const servedBy = res.headers.get('x-treg-served-by') || '';
  const text = await res.text();
  let body = {};
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { message: text.slice(0, 240) };
    }
  }

  recordUsage(customer, {
    at: new Date().toISOString(),
    endpoint: id,
    feature,
    callId,
    costMicro,
    status: res.status,
    servedBy,
  });

  if (!res.ok) {
    const err = new Error(safeUserMessage(res.status, tregError, body));
    err.code = tregError ? 'TREG_ERROR' : 'TREG_UPSTREAM';
    err.status = res.status;
    err.callId = callId;
    throw err;
  }

  return { body, callId, costMicro, servedBy, status: res.status };
}

/**
 * Authenticated GET under treg.to, for catalog search and catalog get.
 * Path must start with /catalog/.
 */
async function tregGet(pathname, opts = {}) {
  const path = String(pathname || '');
  if (!path.startsWith('/catalog/')) {
    throw new Error('Invalid Treg catalog path.');
  }
  if (!isConfigured()) {
    const err = new Error('Treg is turned on, but TREG_TOKEN is not set on the server.');
    err.code = 'TREG_NOT_CONFIGURED';
    err.status = 409;
    throw err;
  }
  const feature = featureTag(opts.feature || 'catalog');
  const customer = customerTag(workspaceIdFrom(opts));
  const fetchImpl = opts.fetchImpl || fetch;
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), 30000) : null;
  let res;
  try {
    res = await fetchImpl(`${baseUrl()}${path}`, {
      method: 'GET',
      headers: {
        'X-Treg-Token': token(),
        'X-Treg-Meta': `customer=${customer}, feature=${feature}`,
        Accept: 'application/json',
      },
      signal: controller ? controller.signal : undefined,
    });
  } catch (err) {
    if (err && (err.name === 'AbortError' || err.code === 'ABORT_ERR')) {
      const timeout = new Error('Treg catalog timed out.');
      timeout.code = 'TREG_TIMEOUT';
      throw timeout;
    }
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
  const text = await res.text();
  let body = {};
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { message: text.slice(0, 240) };
    }
  }
  if (!res.ok) {
    const err = new Error(safeUserMessage(res.status, res.headers.get('x-treg-error') === '1', body));
    err.code = 'TREG_ERROR';
    err.status = res.status;
    throw err;
  }
  return body;
}

module.exports = {
  baseUrl,
  isConfigured,
  customerTag,
  featureTag,
  tregCall,
  tregGet,
  lastUsage,
  safeUserMessage,
};
