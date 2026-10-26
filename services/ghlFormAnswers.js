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
    const a = str(row.a != null ? row.a : row.value != null ? row.value : row.answer).slice(0, MAX_A);
    if (!q || !a) continue;
    if (isInternalField(q, row.key || row.id)) continue;
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

/**
 * Load a contact (if needed) and resolve custom-field names from the location catalog.
 * @param {object|string} contactOrId
 * @param {object} [integrationEnv]
 * @param {{ catalog?: object[] }} [opts]
 */
async function fetchContactFormAnswers(contactOrId, integrationEnv, opts = {}) {
  let contact = contactOrId;
  if (typeof contactOrId === 'string' && contactOrId.trim()) {
    try {
      contact = await ghlClient.getContact(contactOrId.trim(), integrationEnv);
    } catch (err) {
      console.warn('[ghlFormAnswers] getContact failed:', err && err.message);
      return [];
    }
  }
  if (!contact || typeof contact !== 'object') return [];

  let catalog = Array.isArray(opts.catalog) ? opts.catalog : null;
  if (!catalog) {
    try {
      catalog = await ghlClient.listLocationContactCustomFields(integrationEnv);
    } catch (err) {
      console.warn('[ghlFormAnswers] custom field catalog failed:', err && err.message);
      catalog = [];
    }
  }
  return answersFromContact(contact, catalog);
}

module.exports = {
  MAX_ANSWERS,
  normalizeFormAnswers,
  answersPreview,
  answersFromContact,
  fetchContactFormAnswers,
  humanizeLabel,
  contactAddressLine,
};
