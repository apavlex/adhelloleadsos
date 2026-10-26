/**
 * Normalize website / Lead Connector form answers for Reviews profiles.
 * Sources: Form Submitted webhook extras, or GHL contact custom + extra fields.
 */
const ghlClient = require('./ghlClient');

const MAX_ANSWERS = 20;
const MAX_Q = 80;
const MAX_A = 500;

/** Internal AdHello→GHL fields — never show as form answers. */
const INTERNAL_FIELD_RE = /^(adhello\b|ao:\s*)/i;

const STANDARD_EXTRAS = [
  ['companyName', 'Company'],
  ['company', 'Company'],
  ['website', 'Website'],
  ['websiteUrl', 'Website'],
  ['source', 'Source'],
  ['contactSource', 'Source'],
  ['type', 'Type'],
];

function str(v) {
  if (v == null) return '';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (Array.isArray(v)) return v.map((x) => str(x)).filter(Boolean).join(', ');
  if (typeof v === 'object') {
    try { return JSON.stringify(v).slice(0, MAX_A); } catch (_) { return ''; }
  }
  return String(v).replace(/\s+/g, ' ').trim();
}

function humanizeLabel(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (/\s/.test(s) && !/[_\-.]/.test(s)) return s.slice(0, MAX_Q);
  return s
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_\-.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .slice(0, MAX_Q);
}

function isInternalField(label, key) {
  return INTERNAL_FIELD_RE.test(String(label || '')) || INTERNAL_FIELD_RE.test(String(key || ''));
}

/** GHL attribution crumbs (Direct / AI Studio) → friendly “Website” for Source fields. */
const SOURCE_ATTRIBUTION_JUNK = new Set([
  'direct',
  'organic',
  'referral',
  'ai_studio',
  'ai studio',
  'aistudio',
  'ai-studio',
  'leadconnector',
  'lead connector',
  'api',
  'manual',
  'import',
  'csv',
  'unknown',
  'null',
  'undefined',
  'other',
  'none',
  'n/a',
  'na',
  '-',
]);

function isSourceQuestion(q) {
  return /^(source|contact\s*source|session\s*source|attribution)$/i.test(String(q || '').trim());
}

function friendlySourceAnswer(value) {
  const raw = str(value);
  if (!raw) return '';
  const key = raw.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  const compact = key.replace(/\s+/g, '');
  if (
    SOURCE_ATTRIBUTION_JUNK.has(key)
    || SOURCE_ATTRIBUTION_JUNK.has(compact)
    || SOURCE_ATTRIBUTION_JUNK.has(raw.toLowerCase())
    || /^ai[_\s-]?studio$/i.test(raw)
  ) {
    return 'Website';
  }
  return raw;
}

/**
 * @param {unknown} raw
 * @returns {{ q: string, a: string }[]}
 */
function normalizeFormAnswers(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const out = [];
  const seen = new Set();
  for (const row of list) {
    if (!row || typeof row !== 'object') continue;
    const q = humanizeLabel(row.q || row.label || row.name || row.key || '');
    let a = str(row.a != null ? row.a : row.value != null ? row.value : row.answer).slice(0, MAX_A);
    if (!q || !a) continue;
    if (isInternalField(q, row.key || row.id)) continue;
    if (isSourceQuestion(q)) a = friendlySourceAnswer(a) || a;
    const dedupe = q.toLowerCase();
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    out.push({ q, a });
    if (out.length >= MAX_ANSWERS) break;
  }
  return out;
}

function answersPreview(answers, limit = 3) {
  return normalizeFormAnswers(answers)
    .slice(0, Math.max(1, Number(limit) || 3))
    .map((x) => `${x.q}: ${x.a}`)
    .join(' · ')
    .slice(0, 240);
}

function contactAddressLine(contact) {
  const c = contact && typeof contact === 'object' ? contact : {};
  const parts = [
    c.address1 || c.address || '',
    c.city || '',
    [c.state || '', c.postalCode || c.zip || ''].filter(Boolean).join(' ').trim(),
    c.country || '',
  ]
    .map((p) => str(p))
    .filter(Boolean);
  // Dedupe consecutive repeats
  const uniq = [];
  for (const p of parts) {
    if (uniq[uniq.length - 1] === p) continue;
    uniq.push(p);
  }
  return uniq.join(', ').slice(0, MAX_A);
}

function catalogLabelMap(catalog) {
  const map = new Map();
  for (const f of Array.isArray(catalog) ? catalog : []) {
    if (!f || typeof f !== 'object') continue;
    const id = String(f.id || '').trim();
    const name = String(f.name || f.fieldKey || f.key || '').trim();
    if (id && name) map.set(id, name);
    const key = String(f.fieldKey || f.key || '').trim();
    if (key && name) map.set(key, name);
  }
  return map;
}

function contactCustomFieldEntries(contact) {
  const raw = contact && contact.customFields;
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object') {
    return Object.entries(raw).map(([k, v]) => {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        return { id: v.id || k, key: v.key || v.fieldKey || k, value: v.value != null ? v.value : v.fieldValue };
      }
      return { id: k, key: k, value: v };
    });
  }
  return [];
}

/**
 * Build display answers from a GHL contact (+ optional location custom-field catalog).
 * Skips name/phone/email (already on the Reviews Details card).
 */
function answersFromContact(contact, catalog = []) {
  const c = contact && typeof contact === 'object' ? contact : {};
  const labels = catalogLabelMap(catalog);
  const draft = [];

  for (const [key, label] of STANDARD_EXTRAS) {
    const val = str(c[key]);
    if (!val) continue;
    draft.push({ q: label, a: val });
  }

  const address = contactAddressLine(c);
  if (address) draft.push({ q: 'Address', a: address });

  for (const entry of contactCustomFieldEntries(c)) {
    if (!entry) continue;
    const id = String(entry.id || '').trim();
    const key = String(entry.key || entry.fieldKey || '').trim();
    const label = labels.get(id) || labels.get(key) || humanizeLabel(entry.name || key || id);
    const val = str(entry.value != null ? entry.value : entry.fieldValue);
    if (!label || !val) continue;
    if (isInternalField(label, key || id)) continue;
    draft.push({ q: label, a: val, key: key || id });
  }

  return normalizeFormAnswers(draft);
}

/** Standard fields from a form submission / customer (shown when no custom Q&A). */
function coreIdentityAnswers(person = {}) {
  const draft = [];
  const name = str(person.name || [person.firstName, person.lastName].filter(Boolean).join(' '));
  const phone = str(person.phone);
  const email = str(person.email);
  const address = contactAddressLine(person) || str(person.address);
  if (name) draft.push({ q: 'Name', a: name });
  if (phone) draft.push({ q: 'Phone', a: phone });
  if (email) draft.push({ q: 'Email', a: email });
  if (address) draft.push({ q: 'Address', a: address });
  if (str(person.companyName || person.company)) {
    draft.push({ q: 'Company', a: str(person.companyName || person.company) });
  }
  return normalizeFormAnswers(draft);
}

/**
 * Parse GHL /forms/submissions row (`others` holds extra form fields).
 */
function answersFromSubmission(submission, catalog = []) {
  const s = submission && typeof submission === 'object' ? submission : {};
  const labels = catalogLabelMap(catalog);
  const draft = [];
  const name = str(s.name || s.fullName);
  const email = str(s.email);
  const phone = str(s.phone);
  if (name) draft.push({ q: 'Name', a: name });
  if (phone) draft.push({ q: 'Phone', a: phone });
  if (email) draft.push({ q: 'Email', a: email });

  const others = s.others && typeof s.others === 'object' ? s.others : {};
  for (const [key, raw] of Object.entries(others)) {
    if (raw == null || typeof raw === 'object') continue;
    const k = String(key || '').trim();
    if (!k) continue;
    // Skip duplicates of standard fields
    if (/^(full_?name|first_?name|last_?name|name|email|phone|contactid|formid)$/i.test(k)) continue;
    const label = labels.get(k) || humanizeLabel(k);
    const val = str(raw);
    if (!label || !val) continue;
    if (isInternalField(label, k)) continue;
    draft.push({ q: label, a: val, key: k });
  }

  // fieldsOriSequance is the form's field order when present — keep first-seen order from others.
  return normalizeFormAnswers(draft);
}

function pickBestSubmission(submissions, contactId) {
  const list = Array.isArray(submissions) ? submissions.filter(Boolean) : [];
  if (!list.length) return null;
  const id = String(contactId || '').trim();
  if (id) {
    const hit = list.find((s) => String(s.contactId || '').trim() === id);
    if (hit) return hit;
  }
  return list.slice().sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0))[0];
}

/**
 * Load a contact (if needed) and resolve custom-field names from the location catalog.
 * Also tries GHL form submissions (Lead Connector) for the real field answers.
 * @param {object|string} contactOrId
 * @param {object} [integrationEnv]
 * @param {{ catalog?: object[], email?: string, phone?: string, includeCoreFallback?: boolean }} [opts]
 */
async function fetchContactFormAnswers(contactOrId, integrationEnv, opts = {}) {
  let contact = contactOrId;
  const contactIdHint = typeof contactOrId === 'string' ? contactOrId.trim() : String((contactOrId && contactOrId.id) || '').trim();
  if (typeof contactOrId === 'string' && contactOrId.trim()) {
    try {
      contact = await ghlClient.getContact(contactOrId.trim(), integrationEnv);
    } catch (err) {
      console.warn('[ghlFormAnswers] getContact failed:', err && err.message);
      contact = null;
    }
  }

  let catalog = Array.isArray(opts.catalog) ? opts.catalog : null;
  if (!catalog) {
    try {
      catalog = await ghlClient.listLocationContactCustomFields(integrationEnv);
    } catch (err) {
      console.warn('[ghlFormAnswers] custom field catalog failed:', err && err.message);
      catalog = [];
    }
  }

  let fromContact = contact && typeof contact === 'object' ? answersFromContact(contact, catalog) : [];

  // Prefer the actual form submission — Lead Connector often leaves customFields empty.
  let fromSubmission = [];
  const queries = [];
  const ghlId = String((contact && contact.id) || contactIdHint || '').trim();
  const email = str(opts.email || (contact && contact.email));
  const phone = str(opts.phone || (contact && contact.phone));
  if (ghlId) queries.push(ghlId);
  if (email) queries.push(email);
  if (phone) queries.push(phone.replace(/[^\d+]/g, '') || phone);

  for (const q of queries) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const batch = await ghlClient.listFormSubmissions(integrationEnv, { q, limit: 10 });
      const best = pickBestSubmission(batch.submissions, ghlId);
      if (best) {
        fromSubmission = answersFromSubmission(best, catalog);
        if (fromSubmission.length) break;
      }
    } catch (err) {
      // forms.readonly may be missing on older tokens — fall back to contact fields.
      console.warn('[ghlFormAnswers] form submissions failed:', err && err.message);
      break;
    }
  }

  // Prefer submission extras; merge any contact-only custom fields that aren't already present.
  let merged = fromSubmission.length ? fromSubmission : fromContact;
  if (fromSubmission.length && fromContact.length) {
    const seen = new Set(merged.map((a) => a.q.toLowerCase()));
    for (const row of fromContact) {
      if (seen.has(row.q.toLowerCase())) continue;
      merged.push(row);
      seen.add(row.q.toLowerCase());
      if (merged.length >= MAX_ANSWERS) break;
    }
  }

  if (!merged.length && opts.includeCoreFallback !== false) {
    merged = coreIdentityAnswers(contact || {
      name: opts.name,
      email,
      phone,
      address: opts.address,
    });
  }

  return normalizeFormAnswers(merged);
}

module.exports = {
  MAX_ANSWERS,
  normalizeFormAnswers,
  answersPreview,
  answersFromContact,
  answersFromSubmission,
  coreIdentityAnswers,
  fetchContactFormAnswers,
  humanizeLabel,
  contactAddressLine,
};
