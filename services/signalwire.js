const DEFAULT_API_BASE = 'https://api.signalwire.com';

function truthyEnv(v) {
  const t = String(v || '')
    .trim()
    .toLowerCase();
  return t === '1' || t === 'true' || t === 'yes' || t === 'on';
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

function normalizePhone(raw) {
  if (raw == null) return '';
  const stripped = String(raw).replace(/[^\d+]/g, '');
  if (!stripped) return '';
  if (stripped.startsWith('+')) return stripped;
  if (stripped.length === 10) return `+1${stripped}`;
  return `+${stripped}`;
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

  return postForm('/Calls.json', body);
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

module.exports = {
  configured,
  envConfig,
  normalizePhone,
  buildAppUrl,
  createLeadCall,
  sendSms,
};
