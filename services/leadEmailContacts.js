/**
 * Extra emails found for a business (e.g. Chrome extension website scrape) are kept as
 * email-only entries in lead.contacts[] so the main lead.email stays a single address.
 */
const { normalizeEmail, normalizePhone } = require('./leadDedupe');

const MAX_EMAIL_CONTACTS = 25;

function contactKey(c) {
  if (!c || typeof c !== 'object') return '';
  const email = normalizeEmail(c.email);
  if (email) return `e:${email}`;
  const phone = normalizePhone(c.phone);
  if (phone) return `p:${phone}`;
  const name = String(c.name || '').trim().toLowerCase();
  return name ? `n:${name}` : '';
}

/** Append contacts from `incoming` that aren't already present (matched by email, then phone, then name). */
function mergeContactLists(existing, incoming) {
  const out = Array.isArray(existing) ? existing.filter(Boolean) : [];
  const seen = new Set(out.map(contactKey).filter(Boolean));
  (Array.isArray(incoming) ? incoming : []).forEach((c) => {
    const key = contactKey(c);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(c);
  });
  return out;
}

/**
 * @param {object[]} existingContacts
 * @param {string} primaryEmail lead.email (not duplicated into contacts)
 * @param {string[]} emails every email found
 * @param {(email: string) => boolean} isValid
 * @returns {{ contacts: object[], added: number }}
 */
function addEmailContacts(existingContacts, primaryEmail, emails, isValid) {
  const base = Array.isArray(existingContacts) ? existingContacts.filter(Boolean) : [];
  const known = new Set(base.map((c) => normalizeEmail(c.email)).filter(Boolean));
  const primary = normalizeEmail(primaryEmail);
  if (primary) known.add(primary);
  const extra = [];
  (Array.isArray(emails) ? emails : []).forEach((raw) => {
    const email = normalizeEmail(raw);
    if (!email || known.has(email) || (isValid && !isValid(email))) return;
    if (extra.length >= MAX_EMAIL_CONTACTS) return;
    known.add(email);
    extra.push({ role: 'Email', name: '', phone: '', email, primary: false });
  });
  return { contacts: [...base, ...extra], added: extra.length };
}

module.exports = { mergeContactLists, addEmailContacts, MAX_EMAIL_CONTACTS };
