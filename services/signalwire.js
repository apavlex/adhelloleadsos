/**
 * The Compatibility (LaML) / Twilio-migration API is not served on api.signalwire.com.
 * Each Space has its own host: https://&lt;subdomain&gt;.signalwire.com/.../Accounts/...
 * @see https://signalwire.com/docs/compatibility-api
 */

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
    /** Full LaML account root, optional override: .../2010-04-01/Accounts/PROJECT_ID */
    lamlApiRoot: String(process.env.SIGNALWIRE_LAML_API_ROOT || '')
      .trim()
      .replace(/\/+$/, ''),
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
  if (cfg.lamlApiRoot) {
    return cfg.lamlApiRoot;
  }
  if (String(cfg.spaceUrl || '').trim()) {
    const clean = cfg.spaceUrl.replace(/^https?:\/\//, '').replace(/\/+$/, '');
    return `https://${clean}/api/laml/2010-04-01/Accounts/${encodeURIComponent(cfg.projectId)}`;
  }
  throw new Error(
    'SIGNALWIRE_SPACE_URL is required for the Compatibility (LaML) API. It only exists on your Space host (see SignalWire Dashboard → API), e.g. https://YOUR_SUBDOMAIN.signalwire.com — not https://api.signalwire.com. Set SIGNALWIRE_SPACE_URL to that base URL, or set SIGNALWIRE_LAML_API_ROOT to the full path ending in .../Accounts/' +
      (cfg.projectId || 'YOUR_PROJECT_ID') +
      '.',
  );
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
 * 404 with this body usually means the Space hostname in SIGNALWIRE_SPACE_URL is wrong (not the real API subdomain).
 */
function isSpaceSubdomainNotFoundError(err) {
  const m = err && err.message ? String(err.message) : '';
  if (!/\b404\b/i.test(m) && !/Not Found/i.test(m)) return false;
  return /The space api|space api does|doesn.t exist on Signalwire|double check you are sending|the correct subdoma/i.test(m);
}

/**
 * Create-call: try /Calls and /Calls.json, form and JSON. LaML only exists on the Space host (SIGNALWIRE_SPACE_URL).
 * @see https://signalwire.com/docs/compatibility-api/rest/calls/create-a-call
 */
async function postFormCreateCall(formBody) {
  if (!configured()) {
    throw new Error('SignalWire is not configured. Set SIGNALWIRE_PROJECT_ID, SIGNALWIRE_TOKEN, SIGNALWIRE_FROM_NUMBER.');
  }

  const attempts = [
    { path: '/Calls', asJson: false, label: 'POST /Calls (form)' },
    { path: '/Calls', asJson: true, label: 'POST /Calls (JSON)' },
    { path: '/Calls.json', asJson: false, label: 'POST /Calls.json (form)' },
  ];

  const tried = [];
  let last;
  for (const a of attempts) {
    try {
      return await lamlPost(a.path, formBody, { asJson: a.asJson, label: a.label });
    } catch (e) {
      last = e;
      tried.push(a.label);
      if (isEmptyLaml2xxError(e)) continue;
      if (isSpaceSubdomainNotFoundError(e)) {
        throw new Error(
          'SIGNALWIRE_SPACE_URL must be the exact Space base URL from SignalWire (Dashboard → API), e.g. https://your-subdomain.signalwire.com. The LaML/Compatibility API is not available on https://api.signalwire.com. Original error: ' +
            (e && e.message ? String(e.message) : '404'),
        );
      }
      throw e;
    }
  }
  const summary = 'Tried: ' + tried.join(' → ') + '. ';
  const inner = last && last.message ? String(last.message) : 'Unknown error';
  throw new Error(
    `SignalWire create call: ${summary}${inner} If responses are empty 2xx, contact SignalWire with curl -i for your Space host.`,
  );
}

async function lamlPost(path, formBody, opts) {
  const { asJson = false, label: labelIn, apiRoot: apiRootIn } = opts || {};
  const label = labelIn != null ? labelIn : 'POST ' + path;
  const cfg = envConfig();
  if (!configured()) {
    throw new Error('SignalWire is not configured. Set SIGNALWIRE_PROJECT_ID, SIGNALWIRE_TOKEN, SIGNALWIRE_FROM_NUMBER.');
  }
  const root = apiRootIn != null && String(apiRootIn).trim() ? String(apiRootIn).trim().replace(/\/+$/, '') : buildApiRoot(cfg);
  const url = `${root}${path}`;
  const auth = Buffer.from(`${cfg.projectId}:${cfg.token}`).toString('base64');
  const q = new URLSearchParams();
  if (!asJson) {
    Object.entries(formBody || {}).forEach(([k, v]) => {
      if (v == null || v === '') return;
      if (Array.isArray(v)) {
        v.forEach((item) => {
          if (item == null || item === '') return;
          q.append(k, String(item).trim());
        });
      } else {
        q.set(k, String(v));
      }
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

/**
 * Phone numbers owned in this LaML project (same as Dashboard → Phone numbers).
 * @returns {{ numbers: Array<{ phoneNumber: string, friendlyName: string, sid: string }>, error?: string }}
 */
async function listIncomingPhoneNumbers() {
  if (!configured()) {
    return { numbers: [], error: 'not_configured' };
  }
  const cfg = envConfig();
  try {
    const raw = await getJson('/IncomingPhoneNumbers.json?PageSize=200');
    const arr = raw.incoming_phone_numbers || raw.IncomingPhoneNumbers;
    const rows = Array.isArray(arr) ? arr : [];
    const out = rows
      .map((n) => ({
        sid: String(n.sid || n.Sid || '').trim(),
        phoneNumber: normalizePhone(n.phone_number || n.PhoneNumber || ''),
        friendlyName: String(n.friendly_name || n.FriendlyName || '')
          .trim()
          .slice(0, 64),
      }))
      .filter((n) => n.phoneNumber);
    const seen = new Set();
    const deduped = out.filter((n) => {
      if (seen.has(n.phoneNumber)) return false;
      seen.add(n.phoneNumber);
      return true;
    });
    const fromDefault = normalizePhone(cfg.fromNumber);
    if (fromDefault && !deduped.some((n) => n.phoneNumber === fromDefault)) {
      deduped.unshift({
        sid: '',
        phoneNumber: fromDefault,
        friendlyName: 'Default (SIGNALWIRE_FROM_NUMBER)',
      });
    }
    return { numbers: deduped };
  } catch (e) {
    return {
      numbers: [],
      error: e && e.message ? String(e.message) : 'list_failed',
    };
  }
}

function buildAppUrl(path, params) {
  const cfg = envConfig();
  const base = cfg.baseUrl;
  if (!base) return '';
  const u = new URL(path, `${base}/`);
  const qp = new URLSearchParams();
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      if (v != null && v !== '') qp.set(k, String(v));
    });
  }
  if (cfg.webhookToken) qp.set('token', cfg.webhookToken);
  qp.forEach((v, k) => u.searchParams.set(k, v));
  return u.toString();
}

async function createLeadCall(opts) {
  const leadTo = normalizePhone(opts && opts.to);
  if (!leadTo) throw new Error('A valid destination phone number is required.');
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
  const agentFirst = !!(opts && opts.agentFirst);
  const agentTo = normalizePhone(opts && opts.agentTo);

  if (agentFirst) {
    if (action === 'voicemail_drop') {
      throw new Error(
        'Agent-first calling is not available for voicemail drop. Use a normal call or change call routing in Workspace.',
      );
    }
    if (!agentTo) {
      throw new Error('Agent phone number is required for agent-first mode.');
    }
  }

  const statusCallback = buildAppUrl('/api/telephony/voice/status', {
    leadKey,
    workspaceId,
    action,
  });
  const voiceUrl = agentFirst
    ? buildAppUrl('/api/telephony/voice/twiml', {
        leadKey,
        workspaceId,
        action: 'call',
        agentFirst: '1',
        dialTo: leadTo,
        bridgeFrom: from,
        session: (opts && opts.session) ? '1' : undefined,
      })
    : buildAppUrl('/api/telephony/voice/twiml', {
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
    To: agentFirst ? agentTo : leadTo,
    From: from,
    Url: voiceUrl,
    StatusCallback: statusCallback,
    StatusCallbackMethod: 'POST',
    // Twilio-compatible: send one form field per event (not a single space-separated value).
    StatusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
  };

  if (action === 'voicemail_drop' && !agentFirst) {
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

function normalizeCallStatus(obj) {
  if (!obj || typeof obj !== 'object') return '';
  return String(obj.status || obj.Status || '').trim().toLowerCase();
}

function isTerminalCallStatus(status) {
  const s = String(status || '').trim().toLowerCase();
  return (
    s === 'completed' ||
    s === 'canceled' ||
    s === 'cancelled' ||
    s === 'failed' ||
    s === 'busy' ||
    s === 'no-answer' ||
    s === 'noanswer'
  );
}

function isCallAlreadyFinishedError(err) {
  const m = String((err && err.message) || '').toLowerCase();
  return (
    m.includes('cannot update a completed call') ||
    m.includes('call is not in-progress') ||
    m.includes('not in-progress') ||
    (m.includes('completed') && m.includes('call'))
  );
}

async function completeCall(callSid) {
  const sid = String(callSid || '').trim();
  if (!sid) throw new Error('Call SID is required.');
  try {
    const current = await getCall(sid);
    if (isTerminalCallStatus(normalizeCallStatus(current))) {
      return { ...(current && typeof current === 'object' ? current : {}), sid, alreadyCompleted: true };
    }
  } catch (err) {
    const msg = String((err && err.message) || '');
    if (/\b404\b/.test(msg) || /not found/i.test(msg)) {
      return { sid, status: 'completed', alreadyCompleted: true };
    }
  }
  try {
    return await postForm(`/Calls/${encodeURIComponent(sid)}.json`, { Status: 'completed' });
  } catch (err) {
    if (isCallAlreadyFinishedError(err)) {
      return { sid, status: 'completed', alreadyCompleted: true };
    }
    throw err;
  }
}

/**
 * Redirect an in-progress call to new TwiML instructions.
 * Uses SignalWire LaML REST API: POST /Calls/{CallSid}.json with Url param.
 * This lets the agent stay on the line while the call is redirected to dial a new lead.
 */
async function redirectCall(callSid, url) {
  const sid = String(callSid || '').trim();
  if (!sid) throw new Error('Call SID is required.');
  if (!url || typeof url !== 'string') throw new Error('Redirect URL is required.');
  return postForm(`/Calls/${encodeURIComponent(sid)}.json`, { Url: url });
}

/**
 * Recording resource SID from create/update responses (Twilio/SignalWire LaML).
 */
function extractRecordingSid(obj) {
  if (!obj || typeof obj !== 'object') return '';
  return String(obj.sid || obj.Sid || '').trim();
}

/**
 * Start recording an in-progress call (LaML).
 * @see https://www.twilio.com/docs/voice/api/recording#create-a-recording-resource
 */
async function startCallRecording(callSid, opts) {
  const sid = String(callSid || '').trim();
  if (!sid) throw new Error('Call SID is required.');
  const o = opts && typeof opts === 'object' ? opts : {};
  const body = {};
  if (o.recordingStatusCallback) {
    body.RecordingStatusCallback = String(o.recordingStatusCallback).trim();
    body.RecordingStatusCallbackMethod = 'POST';
    body.RecordingStatusCallbackEvent = ['in-progress', 'completed'];
  }
  return postForm(`/Calls/${encodeURIComponent(sid)}/Recordings.json`, body);
}

/**
 * Stop an in-flight recording.
 * @see https://www.twilio.com/docs/voice/api/recording#update-a-recording-resource
 */
async function stopCallRecording(recordingSid) {
  const rsid = String(recordingSid || '').trim();
  if (!rsid) throw new Error('Recording SID is required.');
  return postForm(`/Recordings/${encodeURIComponent(rsid)}.json`, { Status: 'stopped' });
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
  redirectCall,
  extractRecordingSid,
  startCallRecording,
  stopCallRecording,
  listIncomingPhoneNumbers,
};
