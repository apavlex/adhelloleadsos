/**
 * Per-business vCard (vCard 3.0) for the white-label reviews app.
 *
 * Stable public URL (never changes for a slug):
 *   https://reviews.adhello.io/c/{reviewSlug}.vcf
 *
 * Built from the member profile: company, phone, email, review URL, photo.
 */

const {
  getReviewPublicBaseUrl,
  getReviewPageUrl,
  getBusinessVcardUrl,
} = require('../lib/publicBaseUrl');

/** Escape text values for vCard 3.0 (RFC 2426). */
function escapeVcardValue(value) {
  return String(value == null ? '' : value)
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
}

function cleanText(value, max) {
  return String(value == null ? '' : value)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/** Safe ASCII filename stem from a business name. */
function filenameStem(name, fallback) {
  const raw = cleanText(name, 80) || cleanText(fallback, 80) || 'contact';
  const stem = raw
    .normalize('NFKD')
    .replace(/[^\w\s-]+/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return stem || 'contact';
}

/**
 * Absolute photo URI for PHOTO;VALUE=URI (profile avatar on the public review host).
 * @param {object} member
 * @returns {string}
 */
function photoUriForMember(member) {
  if (!member || !member.reviewSlug || !member.profilePhotoUpdatedAt) return '';
  const v = encodeURIComponent(String(member.profilePhotoUpdatedAt));
  return `${getReviewPublicBaseUrl()}/rv/${encodeURIComponent(member.reviewSlug)}/avatar.png?v=${v}`;
}

/**
 * Split "First Last" → { family, given } for the N property.
 * Business-only contacts use empty family + company as given.
 */
function nameParts(contactName, companyName) {
  const contact = cleanText(contactName, 120);
  if (contact) {
    const parts = contact.split(/\s+/).filter(Boolean);
    if (parts.length === 1) return { family: '', given: parts[0] };
    return { family: parts.slice(1).join(' '), given: parts[0] };
  }
  const company = cleanText(companyName, 160);
  return { family: '', given: company || 'Business' };
}

/**
 * Build a vCard 3.0 string (CRLF, UTF-8 semantics).
 * @param {object} opts
 * @param {string} [opts.fn] display name
 * @param {string} [opts.org] organization
 * @param {string} [opts.contactName] person name (for N)
 * @param {string} [opts.phone]
 * @param {string} [opts.email]
 * @param {string} [opts.url]
 * @param {string} [opts.photoUrl] HTTPS image URI
 * @returns {string}
 */
function buildVcard(opts = {}) {
  const org = cleanText(opts.org, 160);
  const fn = cleanText(opts.fn, 160) || org || cleanText(opts.contactName, 120) || 'Business';
  const phone = cleanText(opts.phone, 40);
  const email = cleanText(opts.email, 200);
  const url = cleanText(opts.url, 400);
  const photoUrl = cleanText(opts.photoUrl, 600);
  const { family, given } = nameParts(opts.contactName, fn);

  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `FN:${escapeVcardValue(fn)}`,
    `N:${escapeVcardValue(family)};${escapeVcardValue(given)};;;`,
  ];
  if (org) lines.push(`ORG:${escapeVcardValue(org)}`);
  if (phone) lines.push(`TEL;TYPE=CELL,VOICE:${escapeVcardValue(phone)}`);
  if (email) lines.push(`EMAIL;TYPE=INTERNET:${escapeVcardValue(email)}`);
  if (url) lines.push(`URL:${escapeVcardValue(url)}`);
  if (photoUrl && /^https:\/\//i.test(photoUrl)) {
    lines.push(`PHOTO;VALUE=URI;TYPE=JPEG:${escapeVcardValue(photoUrl)}`);
  }
  lines.push('END:VCARD');
  return `${lines.join('\r\n')}\r\n`;
}

/**
 * Build vCard + download filename from a network member record.
 * @param {object} member
 * @returns {{ body: string, filename: string, url: string } | null}
 */
function vcardFromMember(member) {
  if (!member || !member.reviewSlug) return null;
  const company = cleanText(member.companyName, 160) || 'Business';
  const body = buildVcard({
    fn: company,
    org: company,
    contactName: member.contactName,
    phone: member.phone,
    email: member.email,
    url: getReviewPageUrl(member.reviewSlug),
    photoUrl: photoUriForMember(member),
  });
  return {
    body,
    filename: `${filenameStem(company, member.reviewSlug)}.vcf`,
    url: getBusinessVcardUrl(member.reviewSlug),
  };
}

module.exports = {
  escapeVcardValue,
  filenameStem,
  getBusinessVcardUrl,
  photoUriForMember,
  buildVcard,
  vcardFromMember,
};
