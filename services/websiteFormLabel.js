/**
 * Human-readable name for a website / Lead Connector form lead.
 * GHL often stamps contact.source as "Direct", "AI Studio", etc. — those are
 * attribution crumbs, not form names. Prefer a real form title, else the
 * business website host ("tprflooring.com Form"), else "Website form".
 */

const ATTRIBUTION_JUNK = new Set([
  'direct',
  'organic',
  'referral',
  'ai_studio',
  'ai studio',
  'aistudio',
  'leadconnector',
  'lead connector',
  'api',
  'manual',
  'import',
  'csv',
  'chat',
  'sms',
  'call',
  'phone',
  'email',
  'unknown',
  'null',
  'undefined',
  'other',
  'none',
  'n/a',
  'na',
  '-',
  'facebook',
  'instagram',
  'google',
  'meta',
  'ads',
  'ad',
  'paid',
  'cpc',
  'ppc',
]);

function clean(value, max = 140) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
}

function primarySegment(value) {
  return clean(String(value || '').split('·')[0].split('|')[0]);
}

function looksLikeRealFormName(name) {
  const n = clean(name);
  if (!n || n.length < 2) return false;
  if (ATTRIBUTION_JUNK.has(n.toLowerCase())) return false;
  // Bare GHL sessionSource / source tokens.
  if (/^(direct|organic|ai[_\s-]?studio)$/i.test(n)) return false;
  return true;
}

/** Hostname from a URL or bare domain (no protocol). Preserves brand casing when present. */
function hostFromWebsite(urlOrHost) {
  const raw = clean(urlOrHost, 500);
  if (!raw) return '';
  try {
    const withProto = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const host = new URL(withProto).hostname.replace(/^www\./i, '');
    if (!host || !host.includes('.')) return '';
    // Prefer casing from the original string when it wasn't all-lowercase.
    const lower = host.toLowerCase();
    const fromRaw = raw.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split(/[/?#]/)[0];
    if (fromRaw && fromRaw.toLowerCase() === lower && /[A-Z]/.test(fromRaw)) return fromRaw;
    return lower;
  } catch (_) {
    const bare = raw.replace(/^www\./i, '').split('/')[0];
    if (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(bare)) return bare;
    return '';
  }
}

/** GHL contact source / type / attribution crumb (not tags). */
function contactSourceHint(contact) {
  return String(
    (contact && (
      contact.source
      || contact.contactSource
      || contact.type
      || contact.attributionSource
      || (contact.attributionSource && contact.attributionSource.sessionSource)
    )) || '',
  ).trim().slice(0, 120);
}

function contactHasFormLikeExtras(contact) {
  const email = String((contact && contact.email) || '').trim();
  if (email) return true;
  const customs = Array.isArray(contact && contact.customFields) ? contact.customFields : [];
  return customs.some((f) => {
    if (!f || typeof f !== 'object') return false;
    const v = f.value != null
      ? f.value
      : (f.fieldValue != null ? f.fieldValue : f.field_value);
    return String(v == null ? '' : v).trim().length > 0;
  });
}

/**
 * True when a GHL contact looks like a website / Lead Connector form — not a
 * call, SMS, email, or import. Used before stamping Website form / form inbox.
 *
 * Blank / Direct sources only count when the contact has an email or custom
 * fields (Lead Connector forms). Phone-only inbound-call creates stay out.
 * Call/SMS sources never count, even when tags mention "lead".
 */
function looksLikeWebsiteFormContact(contact) {
  const source = contactSourceHint(contact).toLowerCase();
  const tags = Array.isArray(contact && contact.tags)
    ? contact.tags.map((t) => String(t || '').toLowerCase()).join(' ')
    : '';
  const hint = `${source} ${tags}`.trim();

  if (/manual|import|csv|\bapi\b|bulk|referral.?partner|teammate|walk[\s-]?in/.test(hint)) {
    return false;
  }

  // Phone / SMS / email contacts (GHL often uses "Inbound Call", "IVR", "SMS").
  // Do not treat these as website forms unless the same hint clearly says form.
  const phoneOrMessage = /\b(missed[\s_-]*)?call\b|\bphone\b|\bivr\b|\bsms\b|\btext\b|\bemail\b|inbound[\s_-]*message|outbound[\s_-]*message/.test(source)
    || /\b(missed[\s_-]*)?call\b|\bphone\b|\bivr\b|\bsms\b|\btext\b/.test(hint);
  const formSignal = /form|survey|typeform|jotform|widget|landing|funnel|lead[\s_-]*connector|facebook[\s_-]*lead|fb[\s_-]*lead/.test(hint);
  if (phoneOrMessage && !formSignal) return false;

  // Blank / generic attribution: require email or custom fields so a phone-only
  // inbound call is not stamped Website form. Real forms still arrive via the
  // submissions API even when source is empty.
  if (!hint || /^(direct|organic|other|unknown|none|n\/a|na|-)$/i.test(source)) {
    return contactHasFormLikeExtras(contact);
  }

  return /form|website|\bweb\b|facebook|fb[\s_-]*lead|landing|funnel|survey|chat|widget|typeform|jotform|lead[\s_-]*connector|paid[\s_-]*social|ai_?studio|\bstudio\b/.test(hint);
}

/**
 * @param {{
 *   formName?: string,
 *   label?: string,
 *   websiteUrl?: string,
 *   businessName?: string,
 *   companyName?: string,
 * }} [opts]
 * @returns {string}
 */
function websiteFormLabel(opts = {}) {
  const candidates = [opts.formName, opts.label]
    .map((v) => primarySegment(v))
    .filter(Boolean);
  for (const c of candidates) {
    if (looksLikeRealFormName(c)) return c;
  }

  const host = hostFromWebsite(opts.websiteUrl);
  if (host) {
    const pretty = /[A-Z]/.test(host) ? host : host.replace(/^(.)/, (ch) => ch.toUpperCase());
    return `${pretty} Form`;
  }

  const biz = clean(opts.businessName || opts.companyName, 80);
  if (biz) return `${biz} website form`;
  return 'Website form';
}

module.exports = {
  websiteFormLabel,
  looksLikeRealFormName,
  looksLikeWebsiteFormContact,
  contactSourceHint,
  hostFromWebsite,
  ATTRIBUTION_JUNK,
};
