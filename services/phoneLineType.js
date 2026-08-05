/**
 * Phone line type detection (mobile / landline / voip) via SignalWire Lookup.
 * Cached on the lead record; refreshed when the phone changes or cache expires.
 */
const signalwire = require('./signalwire');
const { normalizePhone: normalizePhoneDigits } = require('./leadDedupe');

const LINE_TYPES = new Set(['mobile', 'landline', 'voip', 'unknown']);

const DEFAULT_CACHE_DAYS = 30;

function cacheTtlMs() {
  const raw = parseInt(process.env.PHONE_LINE_TYPE_CACHE_DAYS || '', 10);
  const days = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_CACHE_DAYS;
  return days * 86400000;
}

function truthyEnv(v) {
  const t = String(v || '')
    .trim()
    .toLowerCase();
  return t === '1' || t === 'true' || t === 'yes' || t === 'on';
}

function lookupEnabled() {
  const v = String(process.env.PHONE_LINE_TYPE_LOOKUP_ENABLED || '1')
    .trim()
    .toLowerCase();
  if (v === '0' || v === 'false' || v === 'off' || v === 'no') return false;
  return true;
}

function normalizeE164(raw) {
  return signalwire.normalizePhone(raw);
}

function phoneNormKey(raw) {
  return normalizePhoneDigits(raw);
}

function hasUsablePhone(raw) {
  const digits = phoneNormKey(raw);
  return digits.length >= 10;
}

function normalizeLineType(raw) {
  const t = String(raw || '')
    .trim()
    .toLowerCase();
  if (!t) return 'unknown';
  if (t === 'mobile' || t === 'cell' || t === 'wireless') return 'mobile';
  if (t === 'landline' || t === 'fixed' || t === 'fixed line' || t === 'fixed_line') return 'landline';
  if (t === 'voip' || t === 'non-fixed voip' || t === 'nonfixedvoip') return 'voip';
  if (LINE_TYPES.has(t)) return t;
  return 'unknown';
}

function lineTypeLabel(type) {
  const t = normalizeLineType(type);
  if (t === 'mobile') return 'Mobile';
  if (t === 'landline') return 'Landline';
  if (t === 'voip') return 'VoIP';
  return 'Unknown';
}

function lineTypePillClass(type) {
  const t = normalizeLineType(type);
  if (t === 'mobile') {
    return 'text-sky-800 dark:text-sky-200 bg-sky-500/15 dark:bg-sky-950/40 border-sky-500/35';
  }
  if (t === 'landline') {
    return 'text-amber-800 dark:text-amber-200 bg-amber-500/15 dark:bg-amber-950/40 border-amber-500/35';
  }
  if (t === 'voip') {
    return 'text-violet-800 dark:text-violet-200 bg-violet-500/15 dark:bg-violet-950/40 border-violet-500/35';
  }
  return 'text-brand-muted dark:text-slate-400 bg-brand-cream/80 dark:bg-slate-800 border-brand-border/40 dark:border-white/10';
}

function cachedPhoneNorm(lead) {
  if (!lead || typeof lead !== 'object') return '';
  return phoneNormKey(lead.phoneLineTypePhoneNorm || lead.phoneNorm || lead.phone);
}

function needsRefresh(lead, priorLead) {
  if (!lead || !hasUsablePhone(lead.phone)) return false;
  const currentNorm = phoneNormKey(lead.phone);
  const cachedNorm = cachedPhoneNorm(lead);
  if (!lead.phoneLineTypeCheckedAt || !cachedNorm || cachedNorm !== currentNorm) return true;
  if (priorLead && phoneNormKey(priorLead.phone) !== currentNorm) return true;
  const checkedMs = Date.parse(lead.phoneLineTypeCheckedAt);
  if (!Number.isFinite(checkedMs)) return true;
  return Date.now() - checkedMs > cacheTtlMs();
}

function unknownPatch(phone, reason) {
  const norm = phoneNormKey(phone);
  return {
    phoneLineType: 'unknown',
    phoneCarrier: '',
    phoneLineTypeCheckedAt: new Date().toISOString(),
    phoneLineTypePhoneNorm: norm,
    phoneLineTypeSource: reason || 'unknown',
  };
}

function lookupUrl(e164) {
  const host = signalwire.relaySpaceHost();
  if (!host) return '';
  const enc = encodeURIComponent(e164);
  return `https://${host}/api/relay/rest/lookup/phone_number/${enc}?include=carrier`;
}

/**
 * Lookup carrier + line type from SignalWire Relay REST API.
 * @returns {Promise<{ lineType: string, carrier: string, source: string }>}
 */
async function lookupPhoneLineType(phone, opts) {
  const e164 = normalizeE164(phone);
  if (!e164 || !hasUsablePhone(e164)) {
    return { lineType: 'unknown', carrier: '', source: 'invalid_phone' };
  }

  if (!lookupEnabled()) {
    return { lineType: 'unknown', carrier: '', source: 'lookup_disabled' };
  }

  if (!signalwire.configured()) {
    return { lineType: 'unknown', carrier: '', source: 'signalwire_not_configured' };
  }

  const url = lookupUrl(e164);
  if (!url) {
    return { lineType: 'unknown', carrier: '', source: 'missing_space_url' };
  }

  const fetchImpl = (opts && opts.fetch) || global.fetch;
  if (typeof fetchImpl !== 'function') {
    return { lineType: 'unknown', carrier: '', source: 'fetch_unavailable' };
  }

  const cfg = signalwire.envConfig();
  const auth = Buffer.from(`${cfg.projectId}:${cfg.token}`).toString('base64');
  const res = await fetchImpl(url, {
    method: 'GET',
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: 'application/json',
    },
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : {};
  } catch (_) {
    body = {};
  }

  if (!res.ok) {
    const msg =
      (body && (body.message || body.error || body.detail)) ||
      `SignalWire lookup HTTP ${res.status}`;
    throw new Error(String(msg));
  }

  const carrier = (body && body.carrier) || (body && body.data && body.data.carrier) || {};
  const lineType = normalizeLineType(carrier.type || carrier.line_type || carrier.lineType);
  const carrierName = String(carrier.name || carrier.carrier_name || '').trim();

  return {
    lineType,
    carrier: carrierName,
    source: 'signalwire',
  };
}

function patchFromLookup(phone, result) {
  const norm = phoneNormKey(phone);
  return {
    phoneLineType: normalizeLineType(result && result.lineType),
    phoneCarrier: String((result && result.carrier) || '').trim(),
    phoneLineTypeCheckedAt: new Date().toISOString(),
    phoneLineTypePhoneNorm: norm,
    phoneLineTypeSource: String((result && result.source) || 'signalwire').trim(),
  };
}

/**
 * Resolve line type fields for a lead, performing lookup when cache is stale.
 * @returns {Promise<object|null>} patch fields or null when no phone / no refresh needed
 */
async function refreshIfNeeded(lead, priorLead, opts) {
  if (!lead || !hasUsablePhone(lead.phone)) return null;
  if (!needsRefresh(lead, priorLead)) return null;

  try {
    const result = await lookupPhoneLineType(lead.phone, opts);
    return patchFromLookup(lead.phone, result);
  } catch (err) {
    console.warn('[phoneLineType] lookup failed:', err && err.message ? err.message : err);
    return unknownPatch(lead.phone, 'lookup_failed');
  }
}

function isSmsAllowed(lead) {
  const t = normalizeLineType(lead && lead.phoneLineType);
  if (t === 'landline') return false;
  return true;
}

function prefersCallFirst(lead) {
  const t = normalizeLineType(lead && lead.phoneLineType);
  return t === 'landline' || t === 'unknown';
}

function badgeForLead(lead) {
  if (!lead || !hasUsablePhone(lead.phone)) return null;
  const type = normalizeLineType(lead.phoneLineType);
  const label = lineTypeLabel(type);
  const carrier = String(lead.phoneCarrier || '').trim();
  const title = carrier ? `${label} · ${carrier}` : label;
  return {
    type,
    label,
    carrier,
    title,
    pillClass: lineTypePillClass(type),
  };
}

module.exports = {
  LINE_TYPES,
  normalizeLineType,
  lineTypeLabel,
  lineTypePillClass,
  normalizeE164,
  phoneNormKey,
  hasUsablePhone,
  needsRefresh,
  lookupPhoneLineType,
  refreshIfNeeded,
  patchFromLookup,
  isSmsAllowed,
  prefersCallFirst,
  badgeForLead,
};
