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

function responseHostForError(url) {
  try {
    return new URL(url).host;
  } catch (_) {
    return '';
  }
}

/**
 * Twilio / SignalWire may return 201/200 with an empty body and put the Call in the Location (or a sid header).
 * @see https://www.twilio.com/docs/voice/api/call-resource#create-a-call-resource
 */
function callSidFromString(s) {
  if (s == null) return '';
  const str = String(s);
  const m = str.match(/(CA[0-9a-f]{32})/i);
  return m ? m[1].toUpperCase() : '';
}

function extractCallSidFromResHeaders(res) {
  if (!res || typeof res.headers === 'undefined' || !res.headers.get) return '';
  const g = (n) => {
    const v = res.headers.get(n);
    return v == null || v === '' ? '' : String(v);
  };
  const location = g('location') || g('Location') || g('Call-Location') || g('call-location');
  if (location) {
    const fromLoc = callSidFromString(location);
    if (fromLoc) return fromLoc;
  }
  const hSid =
    g('x-twilio-call-sid') ||
    g('X-Twilio-Call-Sid') ||
    g('Call-Sid') ||
    g('I-Twilio-Call-Id') ||
    g('X-Call-Id') ||
    '';
  const t = String(hSid).trim();
  if (/^CA[0-9a-f]{32}$/i.test(t)) return t.toUpperCase();
  // Some proxies use uncommon header names: scan all values for a LaML Call sid.
  if (typeof res.headers.forEach === 'function') {
    let found = '';
    res.headers.forEach((value) => {
      if (found) return;
      const sid = callSidFromString(value);
      if (sid) found = sid;
    });
    if (found) return found;
  }
  return '';
}

/**
 * If LaML returns success with no JSON body, try to build a minimal { sid } from headers.
 */
function resourceFromHeaderFallback(res) {
  const sid = extractCallSidFromResHeaders(res);
  if (!sid) return null;
  return { sid, CallSid: sid };
}

/**
 * LaML responses must be JSON. Empty or HTML 200s often mean a wrong base URL, proxy, or WAF.
 * Also handles empty 201 + Location (Twilio-compatibility) by parsing Call SID from headers.
 */
function parseLamlJsonBody({ res, text, url, label }) {
  const trimmed = String(text == null ? '' : text).trim();
  const contentType = String((res && res.headers && res.headers.get && res.headers.get('content-type')) || '').toLowerCase();
  if (!res.ok) {
    let errMsg = `SignalWire API error ${res.status} ${res.statusText || ''}`.trim();
    if (trimmed) {
      try {
        const j = JSON.parse(trimmed);
        errMsg = j.message || j.error || j.MoreInfo || (Array.isArray(j.exceptions) && j.exceptions[0] && j.exceptions[0].err) || errMsg;
      } catch (_) {
        errMsg = `${errMsg} — ${trimmed.slice(0, 280)}`;
      }
    }
    throw new Error(String(label || 'SignalWire:') + ' ' + errMsg);
  }
  if (!trimmed) {
    const fromHeaders = resourceFromHeaderFallback(res);
    if (fromHeaders) {
      return fromHeaders;
    }
    const host = responseHostForError(url) || 'your-space.signalwire.com';
    throw new Error(
      (label || 'SignalWire') +
        ` returned HTTP ${res.status} with an empty body. Your app reached host "${host}" with no JSON and no Call SID in headers (e.g. Location). Set SIGNALWIRE_SPACE_URL in .env to the exact Space URL (Dashboard → API) and use PROJECT_ID + API token for that same space, and ensure the API token has Voice scope. If a proxy or CDN is in front, ensure it does not strip response bodies. Test with: curl -i -X POST "https://${host}/api/laml/2010-04-01/Accounts/YOUR_PROJECT/Calls" (and /Calls.json) with Basic auth and form or JSON body.`,
    );
  }
  if (contentType.includes('text/html') || (trimmed.startsWith('<') && /<\s*!?\s*html/i.test(trimmed))) {
    throw new Error(
      (label || 'SignalWire') +
        ` returned HTML, not JSON — the request likely hit a wrong path or a login page. Set SIGNALWIRE_SPACE_URL to your real Space (see Dashboard → API) so the base is https://&lt;your-space&gt;.signalwire.com, not a generic or frontend URL. Host used: ${responseHostForError(url) || 'unknown'}. First bytes: ` +
        trimmed.slice(0, 200),
    );
  }
  try {
    return JSON.parse(trimmed);
  } catch (e) {
    throw new Error(
      (label || 'SignalWire') +
        ` response was not valid JSON (HTTP ${res.status}). Check credentials and base URL. Snippet: ` +
        trimmed.slice(0, 200),
    );
  }
}

function isEmptyLaml2xxError(err) {
  const m = err && err.message ? String(err.message) : '';
  return m.includes('empty body') && m.includes('no Call SID in headers');
}

/**
 * Create-call only: try paths/types documented or reported to work. Official docs use POST .../Calls (no .json)
 * with x-www-form-urlencoded; OpenAPI also lists application/json. Some spaces return 200/empty for one variant.
 * @see https://signalwire.com/docs/compatibility-api/rest/calls/create-a-call
 */
async function postFormCreateCall(formBody) {
  const attempts = [
    { path: '/Calls', asJson: false, label: 'POST /Calls' },
    { path: '/Calls', asJson: true, label: 'POST /Calls (application/json)' },
    { path: '/Calls.json', asJson: false, label: 'POST /Calls.json' },
  ];
  let last;
  for (const a of attempts) {
    try {
      return await lamlPost(a.path, formBody, { asJson: a.asJson, label: a.label });
    } catch (e) {
      last = e;
      if (isEmptyLaml2xxError(e)) continue;
      throw e;
    }
  }
  throw last;
}

async function lamlPost(path, formBody, opts) {
  const { asJson = false, label: labelIn } = opts || {};
  const label = labelIn != null ? labelIn : 'POST ' + path;
  const cfg = envConfig();
  if (!configured()) {
    throw new Error('SignalWire is not configured. Set SIGNALWIRE_PROJECT_ID, SIGNALWIRE_TOKEN, SIGNALWIRE_FROM_NUMBER.');
  }
  const root = buildApiRoot(cfg);
  const url = `${root}${path}`;
  const auth = Buffer.from(`${cfg.projectId}:${cfg.token}`).toString('base64');
  const q = new URLSearchParams();
  if (!asJson) {
    Object.entries(formBody || {}).forEach(([k, v]) => {
      if (v == null || v === '') return;
      q.set(k, String(v));
    });
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': asJson ? 'application/json' : 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: asJson ? JSON.stringify(formBody && typeof formBody === 'object' ? formBody : {}) : q.toString(),
  });
  const text = await res.text();
  return parseLamlJsonBody({ res, text, url, label });
}

async function postForm(path, formBody) {
  return lamlPost(path, formBody, { asJson: false, label: 'POST ' + path });
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
  return parseLamlJsonBody({ res, text, url, label: 'GET ' + path });
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
  if (!String(voiceUrl || '').trim() || !String(statusCallback || '').trim()) {
    throw new Error(
      'TwiML or status callback URL is empty. Set BASE_URL in the environment to your public https root (e.g. https://yourapp.com) so /api/telephony/voice routes can be reached by SignalWire.',
    );
  }

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

  const raw = await postFormCreateCall(body);
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
