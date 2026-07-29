/**
 * Saperly — AI-agent phone carrier (SMS / voice).
 * Docs: https://saperly.com/docs/sdks/node
 * API: https://api.saperly.com
 */

const SAPERLY_API_BASE = 'https://api.saperly.com';

function resolveConfig(integrationEnv) {
  const env = integrationEnv || {};
  const apiKey = String(env.SAPERLY_API_KEY || process.env.SAPERLY_API_KEY || '').trim();
  const apiBase = String(env.SAPERLY_API_BASE || process.env.SAPERLY_API_BASE || SAPERLY_API_BASE).trim();
  const fromNumberId = String(
    env.SAPERLY_FROM_NUMBER_ID || process.env.SAPERLY_FROM_NUMBER_ID || '',
  ).trim();
  const webhookSecret = String(
    env.SAPERLY_WEBHOOK_SECRET || process.env.SAPERLY_WEBHOOK_SECRET || '',
  ).trim();
  return {
    apiKey,
    apiBase: apiBase.replace(/\/$/, '') || SAPERLY_API_BASE,
    fromNumberId,
    webhookSecret,
  };
}

function isConfigured(integrationEnv) {
  const { apiKey, fromNumberId } = resolveConfig(integrationEnv);
  return Boolean(apiKey && fromNumberId);
}

function authHeaders(apiKey, extra) {
  return {
    Authorization: `Bearer ${apiKey}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...(extra || {}),
  };
}

function formatApiError(status, data) {
  if (!data || typeof data !== 'object') {
    return `Saperly API error (${status})`;
  }
  const tag = data._tag || data.code || data.error;
  const reason = data.reason || data.message;
  if (tag === 'RecipientOptedOut') {
    return 'Recipient opted out (STOP). Record consent in Saperly before sending again.';
  }
  if (tag === 'AuthorizationDenied') {
    return reason || 'Saperly API key lacks permission for this action.';
  }
  if (tag === 'InsufficientFunds') {
    return 'Saperly workspace balance is too low to send SMS.';
  }
  if (tag === 'SpendLimitExceeded') {
    return 'Saperly API key spend limit reached.';
  }
  if (tag === 'NumberNotFound') {
    return 'Saperly from number ID not found. Check Workspace → Integrations → Saperly.';
  }
  if (typeof reason === 'string' && reason.trim()) return reason.trim();
  if (typeof tag === 'string' && tag.trim()) return tag.trim();
  return `Saperly API error (${status})`;
}

async function saperlyRequest(method, path, { integrationEnv, body, query, idempotencyKey } = {}) {
  const { apiKey, apiBase } = resolveConfig(integrationEnv);
  if (!apiKey) throw new Error('Saperly API key is not configured.');

  let url = path.startsWith('http') ? path : `${apiBase}${path.startsWith('/') ? path : `/${path}`}`;
  if (query && typeof query === 'object') {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v != null && String(v).trim() !== '') params.set(k, String(v));
    }
    const qs = params.toString();
    if (qs) url += (url.includes('?') ? '&' : '?') + qs;
  }

  const headers = authHeaders(apiKey);
  if (idempotencyKey) headers['Idempotency-Key'] = String(idempotencyKey);

  const res = await fetch(url, {
    method: method || 'GET',
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    const err = new Error(formatApiError(res.status, data));
    err.status = res.status;
    err.body = data;
    throw err;
  }

  return data;
}

async function listNumbers(integrationEnv) {
  const data = await saperlyRequest('GET', '/numbers', { integrationEnv });
  return Array.isArray(data) ? data : [];
}

async function testConnection(integrationEnv) {
  const { fromNumberId } = resolveConfig(integrationEnv);
  if (!resolveConfig(integrationEnv).apiKey) {
    throw new Error('Missing Saperly API key — paste your key from app.saperly.ai and save.');
  }
  const numbers = await listNumbers(integrationEnv);
  const active = numbers.filter((n) => n && !n.releasedAt);
  if (!active.length) {
    return {
      ok: true,
      message: 'Connected — Saperly API authenticated (no active numbers yet). Provision a number in Saperly.',
    };
  }
  if (fromNumberId) {
    const match = active.find((n) => String(n.id) === fromNumberId);
    if (!match) {
      throw new Error(
        `From number ID "${fromNumberId}" not found. Active numbers: ${active.map((n) => `${n.phoneNumber} (${n.id})`).join(', ')}`,
      );
    }
    return {
      ok: true,
      message: `Connected — Saperly OK (sending from ${match.phoneNumber}).`,
    };
  }
  const first = active[0];
  return {
    ok: true,
    message: `Connected — Saperly OK (${active.length} number${active.length === 1 ? '' : 's'}). Set "From number ID" to send SMS (e.g. ${first.phoneNumber} → ${first.id}).`,
  };
}

/**
 * Send SMS via Saperly.
 * @param {{ to: string, body: string, fromNumberId?: string, idempotencyKey?: string }} opts
 */
async function sendMessage(opts, integrationEnv) {
  const to = String(opts.to || '').trim();
  const body = String(opts.body || '').trim();
  const { fromNumberId } = resolveConfig(integrationEnv);
  const numberId = String(opts.fromNumberId || fromNumberId || '').trim();
  if (!numberId) {
    throw new Error('Saperly from number ID is not configured.');
  }
  if (!to) throw new Error('Destination phone (E.164) is required.');
  if (!body) throw new Error('Message body is required.');

  return saperlyRequest(
    'POST',
    '/messages',
    {
      integrationEnv,
      body: { fromNumberId: numberId, to, body },
      idempotencyKey: opts.idempotencyKey,
    },
  );
}

module.exports = {
  SAPERLY_API_BASE,
  resolveConfig,
  isConfigured,
  listNumbers,
  testConnection,
  sendMessage,
  saperlyRequest,
};
