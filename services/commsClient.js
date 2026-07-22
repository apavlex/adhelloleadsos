/**
 * Comms by Osis — iMessage & SMS Messages API.
 * Docs: https://docs.osis.co/messages-api/overview
 */

const COMMS_API_BASE = 'https://osis.co';

function resolveConfig(integrationEnv) {
  const env = integrationEnv || {};
  const apiKey = String(env.COMMS_API_KEY || process.env.COMMS_API_KEY || '').trim();
  const webhookSecret = String(
    env.COMMS_WEBHOOK_SECRET || process.env.COMMS_WEBHOOK_SECRET || '',
  ).trim();
  const defaultChannel = String(
    env.COMMS_DEFAULT_CHANNEL || process.env.COMMS_DEFAULT_CHANNEL || '',
  )
    .trim()
    .toLowerCase();
  return {
    apiKey,
    webhookSecret,
    defaultChannel: defaultChannel === 'sms' || defaultChannel === 'imessage' ? defaultChannel : '',
  };
}

function isConfigured(integrationEnv) {
  return Boolean(resolveConfig(integrationEnv).apiKey);
}

function authHeaders(apiKey) {
  return {
    Authorization: `Bearer ${apiKey}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
}

async function commsRequest(method, path, { integrationEnv, body, query } = {}) {
  const { apiKey } = resolveConfig(integrationEnv);
  if (!apiKey) throw new Error('Comms API key is not configured.');

  let url = path.startsWith('http') ? path : `${COMMS_API_BASE}${path.startsWith('/') ? path : `/${path}`}`;
  if (query && typeof query === 'object') {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v != null && String(v).trim() !== '') params.set(k, String(v));
    }
    const qs = params.toString();
    if (qs) url += (url.includes('?') ? '&' : '?') + qs;
  }

  const res = await fetch(url, {
    method: method || 'GET',
    headers: authHeaders(apiKey),
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
    const msg =
      (data && data.error && typeof data.error === 'string' && data.error) ||
      (data && data.message) ||
      `Comms API error (${res.status})`;
    const err = new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
    err.status = res.status;
    err.body = data;
    throw err;
  }

  return data;
}

/**
 * Verify inbound webhook (?token= or x-comms-webhook-token).
 * @param {import('express').Request} req
 * @param {Record<string, string>} [integrationEnv]
 */
function webhookAuthorized(req, integrationEnv) {
  const { webhookSecret } = resolveConfig(integrationEnv);
  const envToken = String(process.env.COMMS_WEBHOOK_SECRET || '').trim();
  const expected = webhookSecret || envToken;
  if (!expected) return false;

  const q = String(req.query && req.query.token ? req.query.token : '').trim();
  const h =
    String(req.headers['x-comms-webhook-token'] || req.headers['x-api-key'] || '').trim();
  return q === expected || h === expected;
}

async function testConnection(integrationEnv) {
  const data = await commsRequest('GET', '/api/v1/comms/messages', {
    integrationEnv,
    query: { limit: 1 },
  });
  const count = Array.isArray(data.messages) ? data.messages.length : 0;
  return {
    ok: true,
    message:
      count > 0
        ? `Connected — Messages API read OK (${count} recent message on line).`
        : 'Connected — Messages API authenticated (no messages yet on this line).',
  };
}

/**
 * Send SMS or iMessage via Comms.
 * @param {{ to: string, body: string, channel?: 'sms'|'imessage', conversationId?: string, idempotencyKey?: string }} opts
 */
async function sendMessage(opts, integrationEnv) {
  const to = String(opts.to || '').trim();
  const body = String(opts.body || '').trim();
  const conversationId = String(opts.conversationId || '').trim();
  if (!body) throw new Error('Message body is required.');
  if (!to && !conversationId) {
    throw new Error('Destination phone (E.164) or conversation_id is required.');
  }

  const { defaultChannel } = resolveConfig(integrationEnv);
  const channel = opts.channel || defaultChannel || undefined;

  const payload = { body };
  if (to) payload.to = to;
  if (conversationId) payload.conversation_id = conversationId;
  if (channel) payload.channel = channel;
  if (opts.idempotencyKey) payload.idempotency_key = String(opts.idempotencyKey);

  const headers = authHeaders(resolveConfig(integrationEnv).apiKey);
  if (opts.idempotencyKey) {
    headers['Idempotency-Key'] = String(opts.idempotencyKey);
  }

  const { apiKey } = resolveConfig(integrationEnv);
  const res = await fetch(`${COMMS_API_BASE}/api/v1/comms/messages`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    const msg =
      (data && data.error && typeof data.error === 'string' && data.error) ||
      `Comms send failed (${res.status})`;
    const err = new Error(msg);
    err.status = res.status;
    err.body = data;
    throw err;
  }

  return data;
}

module.exports = {
  COMMS_API_BASE,
  resolveConfig,
  isConfigured,
  webhookAuthorized,
  testConnection,
  sendMessage,
  commsRequest,
};
