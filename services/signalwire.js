const DEFAULT_API_BASE = 'https://api.signalwire.com';

function truthyEnv(v) {
  const t = String(v || '')
    .trim()
    .toLowerCase();
  return t === '1' || t === 'true' || t === 'yes' || t === 'on';
}

function webrtcEnabled() {
  const v = String(process.env.SIGNALWIRE_WEBRTC_ENABLED || '1')
    .trim()
    .toLowerCase();
  if (v === '0' || v === 'false' || v === 'off' || v === 'no') return false;
  return true;
}

function relaySpaceHost() {
  const raw = String(process.env.SIGNALWIRE_SPACE_URL || '')
    .trim()
    .replace(/\/+$/, '');
  if (!raw) return '';
  return raw.replace(/^https?:\/\//, '');
}

/**
 * Public HTTPS URL for creating Relay (browser) JWTs, e.g. https://your-space.signalwire.com/api/relay/rest/jwt
 * Override with SIGNALWIRE_FABRIC_HTTP + SIGNALWIRE_FABRIC_TOKEN_PATH if your deployment uses a custom edge URL.
 */
function relayJwtRequestUrl() {
  const customBase = String(process.env.SIGNALWIRE_FABRIC_HTTP || '')
    .trim()
    .replace(/\/+$/, '');
  const path = String(
    (process.env.SIGNALWIRE_FABRIC_TOKEN_PATH || '/api/relay/rest/jwt').trim() || '/api/relay/rest/jwt',
  );
  if (customBase) {
    return (path.startsWith('/') ? `${customBase}${path}` : `${customBase}/${path}`);
  }
  const host = relaySpaceHost();
  if (!host) return '';
  return `https://${host}/api/relay/rest/jwt`;
}

function envConfig() {
  return {
    spaceUrl: String(process.env.SIGNALWIRE_SPACE_URL || '')
      .trim()
      .replace(/\/+$/, ''),
    projectId: String(process.env.SIGNALWIRE_PROJECT_ID || '').trim(),
    token: String(process.env.SIGNALWIRE_TOKEN || '').trim(),
    fromNumber: String(process.env.SIGNALWIRE_FROM_NUMBER || '').trim(),
    callerId: String(process.env.SIGNALWIRE_CALLER_ID || process.env.SIGNALWIRE_FROM_NUMBER || '').trim(),
    baseUrl: String(process.env.BASE_URL || '').trim().replace(/\/+$/, ''),
    webhookToken: String(process.env.TELEPHONY_WEBHOOK_TOKEN || '').trim(),
    enabled: truthyEnv(process.env.SIGNALWIRE_ENABLED || '1'),
  };
}

function configured() {
  const cfg = envConfig();
  return !!(cfg.enabled && cfg.projectId && cfg.token && cfg.fromNumber);
}

/**
 * True when the legacy Relay (Verto) browser WebRTC path can request a signed JWT.
 */
function relayWebrtcCanMint() {
  if (!configured() || !webrtcEnabled()) return false;
  if (!relayJwtRequestUrl() || !relaySpaceHost()) return false;
  return true;
}

function normalizePhone(raw) {
  if (raw == null) return '';
  const stripped = String(raw).replace(/[^\d+]/g, '');
  if (!stripped) return '';
  if (stripped.startsWith('+')) return stripped;
  if (stripped.length === 10) return `+1${stripped}`;
  return `+${stripped}`;
}

/**
 * Twilio/SignalWire LaML responses may use `sid`, `CallSid`, or `call_sid`.
 */
function extractCallSid(obj) {
  if (!obj || typeof obj !== 'object') return '';
  return String(
    obj.sid || obj.Sid || obj.CallSid || obj.call_sid || obj.callSid || '',
  ).trim();
}

/**
 * Create-call response: normalize to always include `sid` when the provider returns any known key.
 * Throws if HTTP succeeded but no call id is present.
 */
function ensureCallWithSid(raw, context) {
  const sid = extractCallSid(raw);
  if (sid) {
    return { ...(raw || {}), sid };
  }
  const sample = (() => {
    try {
      return JSON.stringify(raw).slice(0, 400);
    } catch (_) {
      return String(raw);
    }
  })();
  const hint = context ? `${context} ` : '';
  throw new Error(
    `${hint}SignalWire did not return a call id (sid). ${sample ? 'Response: ' + sample : 'Empty response.'}`,
  );
}

function buildApiRoot(cfg) {
  if (cfg.spaceUrl) {
    const clean = cfg.spaceUrl.replace(/^https?:\/\//, '').replace(/\/+$/, '');
    return `https://${clean}/api/laml/2010-04-01/Accounts/${encodeURIComponent(cfg.projectId)}`;
  }
  return `${DEFAULT_API_BASE}/api/laml/2010-04-01/Accounts/${encodeURIComponent(cfg.projectId)}`;
}

async function postForm(path, formBody) {
  const cfg = envConfig();
  if (!configured()) {
    throw new Error('SignalWire is not configured. Set SIGNALWIRE_PROJECT_ID, SIGNALWIRE_TOKEN, SIGNALWIRE_FROM_NUMBER.');
  }
  const root = buildApiRoot(cfg);
  const url = `${root}${path}`;
  const auth = Buffer.from(`${cfg.projectId}:${cfg.token}`).toString('base64');
  const body = new URLSearchParams();
  Object.entries(formBody || {}).forEach(([k, v]) => {
    if (v == null || v === '') return;
    body.set(k, String(v));
  });
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: body.toString(),
  });
  const text = await res.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch (_) {
    parsed = { raw: text };
  }
  if (!res.ok) {
    const msg =
      (parsed && (parsed.message || parsed.error || parsed.raw)) ||
      `SignalWire API error ${res.status}`;
    throw new Error(msg);
  }
  return parsed || {};
}

async function getJson(path) {
  const cfg = envConfig();
  if (!configured()) {
    throw new Error('SignalWire is not configured. Set SIGNALWIRE_PROJECT_ID, SIGNALWIRE_TOKEN, SIGNALWIRE_FROM_NUMBER.');
  }
  const root = buildApiRoot(cfg);
  const url = `${root}${path}`;
  const auth = Buffer.from(`${cfg.projectId}:${cfg.token}`).toString('base64');
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: 'application/json',
    },
  });
  const text = await res.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch (_) {
    parsed = { raw: text };
  }
  if (!res.ok) {
    const msg =
      (parsed && (parsed.message || parsed.error || parsed.raw)) ||
      `SignalWire API error ${res.status}`;
    throw new Error(msg);
  }
  return parsed || {};
}

function buildAppUrl(path, params) {
  const cfg = envConfig();
  const base = cfg.baseUrl;
  if (!base) return '';
  const u = new URL(path, `${base}/`);
  const qp = new URLSearchParams(params || {});
  if (cfg.webhookToken) qp.set('token', cfg.webhookToken);
  qp.forEach((v, k) => u.searchParams.set(k, v));
  return u.toString();
}

async function createLeadCall(opts) {
  const to = normalizePhone(opts && opts.to);
  if (!to) throw new Error('A valid destination phone number is required.');
  const cfg = envConfig();
  const from = normalizePhone((opts && opts.from) || cfg.callerId || cfg.fromNumber);
  if (!from) throw new Error('SIGNALWIRE_FROM_NUMBER must be configured.');
  if (!cfg.baseUrl) {
    throw new Error('BASE_URL must be set to a public HTTPS URL so call webhooks can connect.');
  }

  const action = (opts && opts.action) || 'call';
  const leadKey = String((opts && opts.leadKey) || '').trim();
  const workspaceId = String((opts && opts.workspaceId) || '').trim();
  const voicemailAudioUrl = String((opts && opts.voicemailAudioUrl) || '').trim();

  const statusCallback = buildAppUrl('/api/telephony/voice/status', {
    leadKey,
    workspaceId,
    action,
  });
  const voiceUrl = buildAppUrl('/api/telephony/voice/twiml', {
    leadKey,
    workspaceId,
    action,
    audioUrl: voicemailAudioUrl,
  });

  const body = {
    To: to,
    From: from,
    Url: voiceUrl,
    StatusCallback: statusCallback,
    StatusCallbackMethod: 'POST',
    StatusCallbackEvent: 'initiated ringing answered completed',
  };

  if (action === 'voicemail_drop') {
    body.MachineDetection = 'DetectMessageEnd';
    body.AsyncAmd = 'true';
    body.AsyncAmdStatusCallback = buildAppUrl('/api/telephony/voice/amd', {
      leadKey,
      workspaceId,
      action,
    });
  }

  const raw = await postForm('/Calls.json', body);
  return ensureCallWithSid(raw, 'Create call:');
}

async function sendSms(opts) {
  const to = normalizePhone(opts && opts.to);
  if (!to) throw new Error('A valid destination phone number is required.');
  const cfg = envConfig();
  const from = normalizePhone((opts && opts.from) || cfg.fromNumber);
  if (!from) throw new Error('SIGNALWIRE_FROM_NUMBER must be configured.');
  const message = String((opts && opts.body) || '').trim();
  if (!message) throw new Error('SMS body cannot be empty.');

  const leadKey = String((opts && opts.leadKey) || '').trim();
  const workspaceId = String((opts && opts.workspaceId) || '').trim();
  const statusCallback = buildAppUrl('/api/telephony/sms/status', { leadKey, workspaceId });

  return postForm('/Messages.json', {
    To: to,
    From: from,
    Body: message,
    StatusCallback: statusCallback,
  });
}

async function getCall(callSid) {
  const sid = String(callSid || '').trim();
  if (!sid) throw new Error('Call SID is required.');
  return getJson(`/Calls/${encodeURIComponent(sid)}.json`);
}

async function completeCall(callSid) {
  const sid = String(callSid || '').trim();
  if (!sid) throw new Error('Call SID is required.');
  return postForm(`/Calls/${encodeURIComponent(sid)}.json`, { Status: 'completed' });
}

/**
 * Create a short-lived Relay JWT for @signalwire/js (v1) browser softphone.
 * @see https://signalwire.com/docs/browser-sdk/v2/js#authentication-using-jwt
 */
async function createRelayBrowserJwt(body) {
  if (!configured()) {
    throw new Error('SignalWire is not configured. Set SIGNALWIRE_PROJECT_ID, SIGNALWIRE_TOKEN, SIGNALWIRE_FROM_NUMBER.');
  }
  const url = relayJwtRequestUrl();
  if (!url) {
    throw new Error('SIGNALWIRE_SPACE_URL (or SIGNALWIRE_FABRIC_HTTP) is required for WebRTC token minting.');
  }
  const cfg = envConfig();
  const auth = Buffer.from(`${cfg.projectId}:${cfg.token}`).toString('base64');
  const payload = body && typeof body === 'object' ? body : {};
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch (_) {
    parsed = { raw: text };
  }
  if (!res.ok) {
    const msg =
      (parsed && (parsed.message || parsed.error || parsed.title || parsed.raw)) ||
      `SignalWire Relay JWT error ${res.status}`;
    throw new Error(msg);
  }
  const jwt = String((parsed && (parsed.jwt_token || parsed.token)) || '').trim();
  if (!jwt) {
    throw new Error('SignalWire did not return jwt_token in the Relay JWT response.');
  }
  return {
    token: jwt,
    refresh: String((parsed && parsed.refresh_token) || '').trim(),
  };
}

module.exports = {
  configured,
  envConfig,
  webrtcEnabled,
  relayWebrtcCanMint,
  relaySpaceHost,
  createRelayBrowserJwt,
  normalizePhone,
  extractCallSid,
  buildAppUrl,
  createLeadCall,
  sendSms,
  getCall,
  completeCall,
};
