/**
 * Phone line type detection (mobile / landline / voip).
 * Prefers Outscraper phones-enricher when configured; falls back to SignalWire Lookup.
 * Cached on the lead record; refreshed when the phone changes or cache expires.
 * Applies workspace tags (SMS safe / Cellphone / Landline / VoIP) on verify.
 */
const signalwire = require('./signalwire');
const outscraper = require('./outscraperClient');
const { normalizePhone: normalizePhoneDigits } = require('./leadDedupe');

/** Lazy require — database already depends on this module for auto line-type refresh. */
function db() {
  return require('./database');
}

const LINE_TYPES = new Set(['mobile', 'landline', 'voip', 'unknown']);

const DEFAULT_CACHE_DAYS = 30;

/** Stable tag names applied when verifying phone line type. */
const TAG_SMS_SAFE = 'SMS safe';
const TAG_CELLPHONE = 'Cellphone';
const TAG_LANDLINE = 'Landline';
const TAG_VOIP = 'VoIP';
const PHONE_LINE_TAG_NAMES = [TAG_SMS_SAFE, TAG_CELLPHONE, TAG_LANDLINE, TAG_VOIP];

const TAG_COLORS = {
  [TAG_SMS_SAFE]: '#0EA5E9',
  [TAG_CELLPHONE]: '#38BDF8',
  [TAG_LANDLINE]: '#F59E0B',
  [TAG_VOIP]: '#8B5CF6',
};

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

function preferOutscraperFirst() {
  const v = String(process.env.PHONE_LINE_TYPE_PROVIDER || 'outscraper')
    .trim()
    .toLowerCase();
  if (v === 'signalwire' || v === 'sw') return false;
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
  if (t === 'mobile' || t === 'cell' || t === 'cellphone' || t === 'cellular' || t === 'wireless') {
    return 'mobile';
  }
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

function outscraperConfigured(integrationEnv) {
  return outscraper.isConfigured(integrationEnv);
}

function signalwireLookupReady() {
  return signalwire.configured() && relaySpaceHostSafe();
}

/**
 * Lookup via Outscraper phones-enricher.
 * @returns {Promise<{ lineType: string, carrier: string, source: string }|null>}
 */
async function lookupViaOutscraper(phone, opts) {
  const integrationEnv = opts && opts.integrationEnv;
  if (!outscraperConfigured(integrationEnv)) return null;

  const e164 = normalizeE164(phone) || String(phone || '').trim();
  const row = await outscraper.fetchPhonesEnricher({
    phone: e164,
    integrationEnv,
  });
  if (!row) return null;
  return {
    lineType: normalizeLineType(row.carrierType),
    carrier: String(row.carrierName || '').trim(),
    source: 'outscraper',
  };
}

/**
 * Lookup carrier + line type from SignalWire Relay REST API.
 * @returns {Promise<{ lineType: string, carrier: string, source: string }>}
 */
async function lookupViaSignalWire(phone, opts) {
  const e164 = normalizeE164(phone);
  if (!e164 || !hasUsablePhone(e164)) {
    return { lineType: 'unknown', carrier: '', source: 'invalid_phone' };
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

/**
 * Lookup carrier + line type. Prefers Outscraper phones-enricher, then SignalWire.
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

  const integrationEnv = opts && opts.integrationEnv;
  const hasOutscraper = outscraperConfigured(integrationEnv);
  const hasSignalwire = signalwireLookupReady();

  if (!hasOutscraper && !hasSignalwire) {
    if (!signalwire.configured()) {
      return { lineType: 'unknown', carrier: '', source: 'not_configured' };
    }
    return { lineType: 'unknown', carrier: '', source: 'missing_space_url' };
  }

  const tryOutscraper = async () => {
    try {
      const result = await lookupViaOutscraper(phone, opts);
      if (result) return result;
    } catch (err) {
      console.warn(
        '[phoneLineType] Outscraper phones-enricher failed:',
        err && err.message ? err.message : err,
      );
    }
    return null;
  };

  const trySignalwire = async () => {
    try {
      return await lookupViaSignalWire(phone, opts);
    } catch (err) {
      console.warn(
        '[phoneLineType] SignalWire lookup failed:',
        err && err.message ? err.message : err,
      );
      throw err;
    }
  };

  if (preferOutscraperFirst()) {
    if (hasOutscraper) {
      const os = await tryOutscraper();
      if (os && os.lineType !== 'unknown') return os;
      if (os && !hasSignalwire) return os;
    }
    if (hasSignalwire) return trySignalwire();
    if (hasOutscraper) {
      const os = await tryOutscraper();
      if (os) return os;
    }
  } else {
    if (hasSignalwire) {
      try {
        const sw = await trySignalwire();
        if (sw && sw.lineType !== 'unknown') return sw;
        if (sw && !hasOutscraper) return sw;
      } catch (_) {
        /* fall through to Outscraper */
      }
    }
    if (hasOutscraper) {
      const os = await tryOutscraper();
      if (os) return os;
    }
    if (hasSignalwire) return trySignalwire();
  }

  return { lineType: 'unknown', carrier: '', source: 'lookup_failed' };
}

function patchFromLookup(phone, result) {
  const norm = phoneNormKey(phone);
  return {
    phoneLineType: normalizeLineType(result && result.lineType),
    phoneCarrier: String((result && result.carrier) || '').trim(),
    phoneLineTypeCheckedAt: new Date().toISOString(),
    phoneLineTypePhoneNorm: norm,
    phoneLineTypeSource: String((result && result.source) || '').trim() || 'unknown',
  };
}

/**
 * Resolve line type fields for a lead, performing lookup when cache is stale.
 * @returns {Promise<object|null>} patch fields or null when no phone / no refresh needed
 */
async function refreshIfNeeded(lead, priorLead, opts) {
  if (!lead || lead.isDemo || !hasUsablePhone(lead.phone)) return null;
  if (!(opts && opts.force) && !needsRefresh(lead, priorLead)) return null;

  try {
    const result = await lookupPhoneLineType(lead.phone, opts);
    return patchFromLookup(lead.phone, result);
  } catch (err) {
    console.warn('[phoneLineType] lookup failed:', err && err.message ? err.message : err);
    return unknownPatch(lead.phone, 'lookup_failed');
  }
}

/**
 * Always run carrier lookup (bulk “Verify phones”), ignoring cache TTL.
 * @returns {Promise<object|null>}
 */
async function forceRefresh(lead, opts) {
  return refreshIfNeeded(lead, null, { ...(opts || {}), force: true });
}

/**
 * Human-readable reason lookup cannot run (missing keys / disabled).
 * @param {Record<string, string>|null|undefined} [integrationEnv]
 * @returns {string|null}
 */
function lookupBlockedReason(integrationEnv) {
  if (!lookupEnabled()) {
    return 'Phone line-type lookup is disabled on the server (PHONE_LINE_TYPE_LOOKUP_ENABLED).';
  }
  if (outscraperConfigured(integrationEnv) || signalwireLookupReady()) {
    return null;
  }
  if (!outscraperConfigured(integrationEnv) && !signalwire.configured()) {
    return 'Phone line-type lookup needs Outscraper (OUTSCRAPER_API_KEY) or SignalWire under Workspace → Integrations / Phone bank.';
  }
  if (signalwire.configured() && !relaySpaceHostSafe()) {
    return 'SignalWire Space URL is missing. Set SIGNALWIRE_SPACE_URL under Workspace → Phone bank / Integrations (or configure Outscraper).';
  }
  return 'Phone line-type lookup is not configured. Add OUTSCRAPER_API_KEY or SignalWire credentials.';
}

function relaySpaceHostSafe() {
  try {
    return !!signalwire.relaySpaceHost();
  } catch (_) {
    return false;
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

/** Tag names that should be present for a given line type. */
function tagNamesForLineType(lineType) {
  const t = normalizeLineType(lineType);
  if (t === 'mobile') return [TAG_SMS_SAFE, TAG_CELLPHONE];
  if (t === 'landline') return [TAG_LANDLINE];
  if (t === 'voip') return [TAG_VOIP];
  return [];
}

async function ensurePhoneLineTagKey(workspaceId, name) {
  const dbService = db();
  const wid = workspaceId || 'default';
  const want = String(name || '')
    .trim()
    .toLowerCase();
  if (!want) return null;
  const tags = await dbService.listTags(wid);
  const found = (tags || []).find((t) => String(t.name || '').trim().toLowerCase() === want);
  if (found && found.key) return found.key;
  const created = await dbService.createTag(wid, name, TAG_COLORS[name] || '#0EA5E9');
  return created && created.key ? created.key : null;
}

/**
 * Sync workspace tags for SMS-safe / cellphone / landline / VoIP based on line type.
 * Removes prior phone-line tags, then adds the matching ones.
 * @returns {Promise<string[]|null>} updated tag keys, or null when unchanged / no workspace
 */
async function applyLineTypeTags(lead, lineType, workspaceId) {
  const dbService = db();
  const wid = workspaceId || (lead && lead.workspaceId) || '';
  if (!wid || !lead) return null;

  const nameToKey = {};
  for (const name of PHONE_LINE_TAG_NAMES) {
    // eslint-disable-next-line no-await-in-loop
    const key = await ensurePhoneLineTagKey(wid, name);
    if (key) nameToKey[name] = key;
  }

  const phoneLineKeys = new Set(Object.values(nameToKey));
  const prev = dbService.normalizeTagKeys(lead.tags);
  const kept = prev.filter((k) => !phoneLineKeys.has(k));
  const addNames = tagNamesForLineType(lineType);
  for (const name of addNames) {
    const key = nameToKey[name];
    if (key && !kept.includes(key)) kept.push(key);
  }

  const next = dbService.normalizeTagKeys(kept);
  const prevSet = new Set(prev);
  const nextSet = new Set(next);
  if (prev.length === next.length && next.every((k) => prevSet.has(k)) && prev.every((k) => nextSet.has(k))) {
    return null;
  }
  return next;
}

module.exports = {
  LINE_TYPES,
  TAG_SMS_SAFE,
  TAG_CELLPHONE,
  TAG_LANDLINE,
  TAG_VOIP,
  PHONE_LINE_TAG_NAMES,
  normalizeLineType,
  lineTypeLabel,
  lineTypePillClass,
  normalizeE164,
  phoneNormKey,
  hasUsablePhone,
  needsRefresh,
  lookupEnabled,
  lookupBlockedReason,
  lookupPhoneLineType,
  lookupViaOutscraper,
  lookupViaSignalWire,
  refreshIfNeeded,
  forceRefresh,
  patchFromLookup,
  isSmsAllowed,
  prefersCallFirst,
  badgeForLead,
  tagNamesForLineType,
  applyLineTypeTags,
  ensurePhoneLineTagKey,
};
