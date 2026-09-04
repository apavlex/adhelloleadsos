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

/** Normalize app root URL; rewrite historical leads.adhello.ai → leads.adhello.io. */
function normalizePublicBaseUrl(raw) {
  let s = String(raw || '')
    .trim()
    .replace(/\/+$/, '');
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  s = s.replace(/^(https?:\/\/)leads\.adhello\.ai(?=\/|$)/i, '$1leads.adhello.io');
  return s;
}

function envConfig() {
  const preferred = normalizePublicBaseUrl(process.env.BASE_URL);
  const render = normalizePublicBaseUrl(process.env.RENDER_EXTERNAL_URL);
  const webhookOverride = normalizePublicBaseUrl(process.env.TELEPHONY_WEBHOOK_BASE_URL);
  // Prefer an explicit webhook base, then Render's live host, then public BASE_URL.
  // leads.adhello.io may be configured as BASE_URL before DNS/SSL exist — keep SignalWire
  // callbacks on RENDER_EXTERNAL_URL until TELEPHONY_WEBHOOK_BASE_URL is set to the custom domain.
  const webhookBaseUrl = webhookOverride || render || preferred || '';
  return {
    spaceUrl: String(process.env.SIGNALWIRE_SPACE_URL || '')
      .trim()
      .replace(/\/+$/, ''),
    projectId: String(process.env.SIGNALWIRE_PROJECT_ID || '').trim(),
    token: String(process.env.SIGNALWIRE_TOKEN || '').trim(),
    fromNumber: String(process.env.SIGNALWIRE_FROM_NUMBER || '').trim(),
    callerId: String(process.env.SIGNALWIRE_CALLER_ID || process.env.SIGNALWIRE_FROM_NUMBER || '').trim(),
    baseUrl: preferred || render || '',
    webhookBaseUrl,
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
      const msg = e && e.message ? String(e.message) : '';
      if (/from must be a purchased or verified/i.test(msg)) {
        const fromUsed = normalizePhone(formBody && (formBody.From || formBody.from));
        throw new Error(
          `Caller ID ${fromUsed || '(empty)'} is not a SignalWire number in this project. In the dialer, pick a workspace number you bought in SignalWire (not your personal cell). Fix Phone bank / “Your caller ID”, then try again.`,
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
 * Cached briefly so softphone open does not wait on SignalWire every time.
 * @returns {{ numbers: Array<{ phoneNumber: string, friendlyName: string, sid: string }>, error?: string }}
 */
let _incomingNumbersCache = { at: 0, value: null };
const INCOMING_NUMBERS_CACHE_MS = 60 * 1000;

async function listIncomingPhoneNumbers(opts) {
  const force = !!(opts && opts.force);
  const now = Date.now();
  if (
    !force &&
    _incomingNumbersCache.value &&
    now - _incomingNumbersCache.at < INCOMING_NUMBERS_CACHE_MS
  ) {
    return _incomingNumbersCache.value;
  }
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
        voiceUrl: String(n.voice_url || n.VoiceUrl || '').trim(),
      }))
      .filter((n) => n.phoneNumber);
    const seen = new Set();
    const deduped = out.filter((n) => {
      if (seen.has(n.phoneNumber)) return false;
      seen.add(n.phoneNumber);
      return true;
    });
    const fromDefault = normalizePhone(cfg.fromNumber);
    // Do NOT inject SIGNALWIRE_FROM_NUMBER into the owned list when it is not on the project —
    // that made dialer think +1971… was valid and every call failed / never rang the agent.
    const value = { numbers: deduped, envFromNumber: fromDefault || '' };
    _incomingNumbersCache = { at: Date.now(), value };
    return value;
  } catch (e) {
    if (_incomingNumbersCache.value) return _incomingNumbersCache.value;
    return {
      numbers: [],
      error: e && e.message ? String(e.message) : 'list_failed',
      envFromNumber: normalizePhone(cfg.fromNumber),
    };
  }
}

/** Numbers that actually have a SignalWire IncomingPhoneNumbers SID (can be used as From). */
async function listOwnedDialNumbers(opts) {
  const listed = await listIncomingPhoneNumbers(opts);
  const numbers = (listed.numbers || []).filter((n) => n && n.sid && n.phoneNumber);
  return { numbers, error: listed.error || null, envFromNumber: listed.envFromNumber || '' };
}

/**
 * Pick a From number SignalWire will accept.
 * Prefers requested → env default (if owned) → first owned DID.
 */
async function resolveOutboundFromNumber(preferred) {
  const listed = await listOwnedDialNumbers();
  const owned = (listed.numbers || []).map((n) => n.phoneNumber).filter(Boolean);
  if (!owned.length) {
    const fallback = normalizePhone(envConfig().fromNumber) || normalizePhone(preferred);
    if (!fallback) {
      throw new Error(
        'No SignalWire phone numbers in this project. Buy a number in SignalWire, then set SIGNALWIRE_FROM_NUMBER and Phone bank to that DID.',
      );
    }
    return {
      from: fallback,
      owned: [],
      remapped: !!(normalizePhone(preferred) && normalizePhone(preferred) !== fallback),
      requested: normalizePhone(preferred) || '',
      warning: 'no_owned_numbers_listed',
    };
  }
  const want = normalizePhone(preferred);
  if (want && owned.includes(want)) {
    return { from: want, owned, remapped: false };
  }
  const envDefault = normalizePhone(envConfig().fromNumber);
  if (envDefault && owned.includes(envDefault)) {
    return {
      from: envDefault,
      owned,
      remapped: !!(want && want !== envDefault),
      requested: want || '',
    };
  }
  return {
    from: owned[0],
    owned,
    remapped: true,
    requested: want || '',
  };
}

/**
 * Point a DID's inbound Voice URL at AdHello dial-in webhook so agent-first
 * works when the agent calls the workspace number (avoids Silence Unknown Callers).
 */
async function configureIncomingNumberForDialIn(phoneNumber) {
  const want = normalizePhone(phoneNumber);
  if (!want) throw new Error('Phone number is required.');
  if (!configured()) throw new Error('SignalWire is not configured.');
  const voiceUrl = buildAppUrl('/api/telephony/voice/inbound', {});
  const statusCallback = buildAppUrl('/api/telephony/voice/status', {});
  if (!voiceUrl || !statusCallback) {
    throw new Error('BASE_URL must be a public https URL to configure inbound voice webhooks.');
  }
  const listed = await listIncomingPhoneNumbers();
  const match = (listed.numbers || []).find((n) => n.phoneNumber === want && n.sid);
  if (!match || !match.sid) {
    throw new Error(
      `Could not find ${want} in this SignalWire project to set Voice URL. Confirm the number is on the same Space as SIGNALWIRE_* keys.`,
    );
  }
  const raw = await postForm(`/IncomingPhoneNumbers/${encodeURIComponent(match.sid)}.json`, {
    VoiceUrl: voiceUrl,
    VoiceMethod: 'POST',
    StatusCallback: statusCallback,
    StatusCallbackMethod: 'POST',
  });
  return {
    sid: match.sid,
    phoneNumber: want,
    voiceUrl,
    statusCallback,
    raw,
  };
}

function voiceWebhookUrlsMatch(currentUrl, expectedUrl) {
  try {
    const a = new URL(String(currentUrl || ''));
    const b = new URL(String(expectedUrl || ''));
    if (a.origin !== b.origin || a.pathname.replace(/\/$/, '') !== b.pathname.replace(/\/$/, '')) {
      return false;
    }
    const ta = a.searchParams.get('token') || '';
    const tb = b.searchParams.get('token') || '';
    return ta === tb;
  } catch (_) {
    return false;
  }
}

/**
 * Re-point DID Voice/Status URLs when they drift (dead custom domain, stale token).
 * Safe to call often — no-ops when already correct.
 */
async function ensureIncomingVoiceWebhooks(phoneNumber) {
  const want = normalizePhone(phoneNumber);
  if (!want || !configured()) {
    return { ok: false, skipped: true, reason: 'not_ready' };
  }
  const expectedVoice = buildAppUrl('/api/telephony/voice/inbound', {});
  const expectedStatus = buildAppUrl('/api/telephony/voice/status', {});
  if (!expectedVoice || !expectedStatus) {
    return { ok: false, skipped: true, reason: 'missing_base_url' };
  }
  const listed = await listIncomingPhoneNumbers();
  const match = (listed.numbers || []).find((n) => n.phoneNumber === want && n.sid);
  if (!match || !match.sid) {
    return { ok: false, skipped: true, reason: 'number_not_found', phoneNumber: want };
  }
  if (voiceWebhookUrlsMatch(match.voiceUrl, expectedVoice)) {
    return { ok: true, updated: false, phoneNumber: want, voiceUrl: match.voiceUrl };
  }
  const configuredNum = await configureIncomingNumberForDialIn(want);
  return {
    ok: true,
    updated: true,
    phoneNumber: want,
    voiceUrl: configuredNum.voiceUrl,
    previousVoiceUrl: match.voiceUrl || '',
  };
}

function buildAppUrl(path, params) {
  const cfg = envConfig();
  let base = String(cfg.webhookBaseUrl || cfg.baseUrl || '').trim().replace(/\/+$/, '');
  if (!base) return '';
  if (!/^https?:\/\//i.test(base)) {
    base = `https://${base}`;
  }
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

async function createOutboundPstnCall(opts) {
  const to = normalizePhone(opts && opts.to);
  if (!to) throw new Error('A valid destination phone number is required.');
  const cfg = envConfig();
  const resolved = await resolveOutboundFromNumber((opts && opts.from) || cfg.callerId || cfg.fromNumber);
  const from = resolved.from;
  if (!from) throw new Error('SIGNALWIRE_FROM_NUMBER must be configured.');
  if (!cfg.baseUrl) {
    throw new Error('BASE_URL must be set to a public HTTPS URL so call webhooks can connect.');
  }
  const workspaceId = String((opts && opts.workspaceId) || '').trim();
  const voicePath = String((opts && opts.voicePath) || '/api/telephony/voice/twiml').trim();
  const voiceParams =
    opts && opts.voiceParams && typeof opts.voiceParams === 'object' ? opts.voiceParams : {};
  const statusAction = String((opts && opts.statusAction) || 'call').trim() || 'call';
  const voiceUrl = buildAppUrl(voicePath, { workspaceId, ...voiceParams });
  const statusCallback = buildAppUrl('/api/telephony/voice/status', {
    workspaceId,
    action: statusAction,
  });
  if (!String(voiceUrl || '').trim() || !String(statusCallback || '').trim()) {
    throw new Error(
      'TwiML or status callback URL is empty. Set BASE_URL in the environment to your public https root.',
    );
  }
  const raw = await postFormCreateCall({
    To: to,
    From: from,
    Url: voiceUrl,
    StatusCallback: statusCallback,
    StatusCallbackMethod: 'POST',
    StatusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
  });
  return ensureCallWithSid(raw, 'Create call:');
}

async function createLeadCall(opts) {
  const leadTo = normalizePhone(opts && opts.to);
  if (!leadTo) throw new Error('A valid destination phone number is required.');
  const cfg = envConfig();
  const resolved = await resolveOutboundFromNumber((opts && opts.from) || cfg.callerId || cfg.fromNumber);
  const from = resolved.from;
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
        leadCallerId: normalizePhone(opts && opts.leadCallerId) || from,
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
  return String(
    obj.status ||
      obj.Status ||
      obj.call_status ||
      obj.CallStatus ||
      obj.callStatus ||
      '',
  )
    .trim()
    .toLowerCase();
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
  const m = String((err && err.message) || err || '').toLowerCase();
  return (
    m.includes('cannot update a completed call') ||
    m.includes('update a completed call') ||
    m.includes('completed calls cannot be updated') ||
    m.includes('call is not in-progress') ||
    m.includes('not in-progress') ||
    m.includes('already completed') ||
    m.includes('21220') ||
    (m.includes('completed') && (m.includes('call') || m.includes('calls')))
  );
}

async function completeCall(callSid) {
  const sid = String(callSid || '').trim();
  if (!sid) throw new Error('Call SID is required.');
  try {
    const current = await getCall(sid);
    const status = normalizeCallStatus(current);
    if (isTerminalCallStatus(status)) {
      return { ...(current && typeof current === 'object' ? current : {}), sid, status, alreadyCompleted: true };
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

async function probeRelayJwtMint() {
  if (!relayWebrtcCanMint()) {
    return { ok: false, error: 'WebRTC prerequisites are not configured on the server.' };
  }
  try {
    await createRelayBrowserJwt({
      resource: 'adhello-webrtc-probe',
      expires_in: 5,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err || 'JWT mint failed') };
  }
}

function relayWebrtcDiagnostics() {
  const cfg = envConfig();
  return {
    enabled: cfg.enabled,
    webrtcEnabled: webrtcEnabled(),
    spaceHost: relaySpaceHost(),
    jwtUrl: relayJwtRequestUrl(),
    projectIdSet: !!cfg.projectId,
    tokenSet: !!cfg.token,
    fromNumber: normalizePhone(cfg.fromNumber),
    fromNumberSet: !!normalizePhone(cfg.fromNumber),
    relayCanMint: relayWebrtcCanMint(),
  };
}

module.exports = {
  configured,
  envConfig,
  webrtcEnabled,
  relayWebrtcCanMint,
  relayWebrtcDiagnostics,
  probeRelayJwtMint,
  relaySpaceHost,
  createRelayBrowserJwt,
  normalizePhone,
  extractCallSid,
  buildAppUrl,
  createLeadCall,
  createOutboundPstnCall,
  sendSms,
  getCall,
  completeCall,
  isTerminalCallStatus,
  isCallAlreadyFinishedError,
  normalizeCallStatus,
  redirectCall,
  extractRecordingSid,
  startCallRecording,
  stopCallRecording,
  listIncomingPhoneNumbers,
  listOwnedDialNumbers,
  resolveOutboundFromNumber,
  configureIncomingNumberForDialIn,
  ensureIncomingVoiceWebhooks,
};
