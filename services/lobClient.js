/**
 * Lob.com API client — postcards and address verification.
 * Docs: https://docs.lob.com/
 */

const LOB_API_BASE = 'https://api.lob.com/v1';
const LOB_API_VERSION = '2020-02-11';

function resolveConfig(integrationEnv) {
  const env = integrationEnv || {};
  const apiKey = String(env.LOB_API_KEY || process.env.LOB_API_KEY || '').trim();
  const fromName = String(env.LOB_FROM_NAME || process.env.LOB_FROM_NAME || '').trim();
  const fromLine1 = String(env.LOB_FROM_ADDRESS_LINE1 || process.env.LOB_FROM_ADDRESS_LINE1 || '').trim();
  const fromCity = String(env.LOB_FROM_CITY || process.env.LOB_FROM_CITY || '').trim();
  const fromState = String(env.LOB_FROM_STATE || process.env.LOB_FROM_STATE || '').trim();
  const fromZip = String(env.LOB_FROM_ZIP || process.env.LOB_FROM_ZIP || '').trim();
  return { apiKey, fromName, fromLine1, fromCity, fromState, fromZip };
}

function isConfigured(integrationEnv) {
  const { apiKey, fromLine1, fromCity, fromState, fromZip } = resolveConfig(integrationEnv);
  return !!(apiKey && fromLine1 && fromCity && fromState && fromZip);
}

function isTestMode(integrationEnv) {
  const { apiKey } = resolveConfig(integrationEnv);
  return apiKey.startsWith('test_');
}

function authHeader(apiKey) {
  const token = Buffer.from(`${apiKey}:`).toString('base64');
  return `Basic ${token}`;
}

async function lobRequest(method, path, { integrationEnv, body } = {}) {
  const { apiKey } = resolveConfig(integrationEnv);
  if (!apiKey) throw new Error('Lob API key is not configured.');

  const url = path.startsWith('http') ? path : `${LOB_API_BASE}${path.startsWith('/') ? path : `/${path}`}`;
  const res = await fetch(url, {
    method: method || 'GET',
    headers: {
      Authorization: authHeader(apiKey),
      'Lob-Version': LOB_API_VERSION,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch (_) {
    data = { raw: text };
  }

  if (!res.ok) {
    const msg =
      (data && data.error && data.error.message) ||
      (data && data.message) ||
      `Lob API error (${res.status})`;
    const err = new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
    err.status = res.status;
    err.body = data;
    throw err;
  }

  return data;
}

function resolveFromAddress(integrationEnv) {
  const { fromName, fromLine1, fromCity, fromState, fromZip } = resolveConfig(integrationEnv);
  if (!fromLine1 || !fromCity || !fromState || !fromZip) {
    throw new Error('Lob return address is incomplete. Set sender address in Workspace → Integrations.');
  }
  return {
    name: fromName || 'AdHello',
    address_line1: fromLine1,
    address_city: fromCity,
    address_state: fromState,
    address_zip: fromZip,
  };
}

async function testConnection(integrationEnv) {
  if (!isConfigured(integrationEnv)) {
    throw new Error('Missing Lob API key or return address — save both in Workspace → Integrations.');
  }
  const data = await lobRequest('GET', '/addresses?limit=1', { integrationEnv });
  const count = data && data.count != null ? data.count : 0;
  const mode = isTestMode(integrationEnv) ? 'test' : 'live';
  return {
    ok: true,
    message: `Connected (${mode} mode) — ${count} saved address${count === 1 ? '' : 'es'} in Lob`,
    testMode: isTestMode(integrationEnv),
  };
}

async function uploadPdfAsset({ buffer, filename, integrationEnv }) {
  const { apiKey } = resolveConfig(integrationEnv);
  if (!apiKey) throw new Error('Lob API key is not configured.');

  const form = new FormData();
  const blob = new Blob([buffer], { type: 'application/pdf' });
  form.append('file', blob, filename || 'design.pdf');

  const res = await fetch(`${LOB_API_BASE}/uploads`, {
    method: 'POST',
    headers: {
      Authorization: authHeader(apiKey),
      'Lob-Version': LOB_API_VERSION,
    },
    body: form,
  });

  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch (_) {
    data = { raw: text };
  }

  if (!res.ok) {
    const msg =
      (data && data.error && data.error.message) ||
      (data && data.message) ||
      `Lob upload failed (${res.status})`;
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }

  const url = String(data.url || '').trim();
  if (!url) throw new Error('Lob did not return a file URL.');
  return { url, id: data.id || null };
}

function lobRecipientName(name) {
  const n = String(name || '').trim() || 'Current Resident';
  if (n.length <= 40) return n;
  return n.slice(0, 40).trim();
}

function lobPostcardDashboardUrl(postcardId) {
  const id = String(postcardId || '').trim();
  if (!id) return 'https://dashboard.lob.com/postcards';
  return `https://dashboard.lob.com/postcards/${encodeURIComponent(id)}`;
}

function assertPostcardCreateResponse(data) {
  const id = String((data && data.id) || '').trim();
  if (!id || !/^psc_[a-f0-9]+$/i.test(id)) {
    throw new Error('Lob accepted the request but did not return a postcard ID. Check your Lob API key and dashboard.');
  }
  return id;
}

async function listPostcards({ integrationEnv, limit = 10 } = {}) {
  const capped = Math.min(Math.max(Number(limit) || 10, 1), 100);
  return lobRequest('GET', `/postcards?limit=${capped}`, { integrationEnv });
}

async function getPostcard(postcardId, integrationEnv) {
  const id = String(postcardId || '').trim();
  if (!id) throw new Error('Postcard ID is required.');
  return lobRequest('GET', `/postcards/${encodeURIComponent(id)}`, { integrationEnv });
}

function buildDefaultPostcardQrCode(redirectUrl, pages = 'front') {
  const url = String(redirectUrl || '').trim();
  if (!url) return null;
  return {
    position: 'relative',
    redirect_url: url,
    width: '0.85',
    top: '0.35',
    right: '0.35',
    pages: pages || 'front',
  };
}

async function createPostcard({ to, front, back, description, integrationEnv, qrCodeRedirectUrl, qrCodePages }) {
  const from = resolveFromAddress(integrationEnv);
  if (!to || !to.address_line1 || !to.address_city || !to.address_state || !to.address_zip) {
    throw new Error('Recipient address is incomplete.');
  }
  const payload = {
    description: description || 'AdHello direct mail',
    to: {
      name: lobRecipientName(to.name),
      address_line1: to.address_line1,
      address_city: to.address_city,
      address_state: to.address_state,
      address_zip: to.address_zip,
    },
    from,
    front: front || '<html><body style="padding:24px;font-family:sans-serif"><h1>Hello</h1></body></html>',
    back: back || '<html><body style="padding:24px;font-family:sans-serif"><p>Scan the QR code on the front.</p></body></html>',
    size: '4x6',
  };
  const qrCode = buildDefaultPostcardQrCode(qrCodeRedirectUrl, qrCodePages);
  if (qrCode) payload.qr_code = qrCode;
  const data = await lobRequest('POST', '/postcards', { integrationEnv, body: payload });
  assertPostcardCreateResponse(data);
  return data;
}

async function createLetter({ to, fileUrl, description, integrationEnv }) {
  const from = resolveFromAddress(integrationEnv);
  if (!to || !to.address_line1 || !to.address_city || !to.address_state || !to.address_zip) {
    throw new Error('Recipient address is incomplete.');
  }
  const file = String(fileUrl || '').trim();
  if (!file) throw new Error('Letter PDF URL is required.');
  const payload = {
    description: description || 'AdHello letter',
    to: {
      name: lobRecipientName(to.name),
      address_line1: to.address_line1,
      address_city: to.address_city,
      address_state: to.address_state,
      address_zip: to.address_zip,
    },
    from,
    file,
    color: true,
  };
  return lobRequest('POST', '/letters', { integrationEnv, body: payload });
}

module.exports = {
  LOB_API_VERSION,
  resolveConfig,
  resolveFromAddress,
  isConfigured,
  isTestMode,
  lobPostcardDashboardUrl,
  assertPostcardCreateResponse,
  buildDefaultPostcardQrCode,
  testConnection,
  uploadPdfAsset,
  listPostcards,
  getPostcard,
  createPostcard,
  createLetter,
  lobRequest,
};
