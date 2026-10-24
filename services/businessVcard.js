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

/** Profile/lead phone usable on a contact card (rejects empty / N/A / email-like). */
function usablePhone(value) {
  const raw = cleanText(value, 40);
  if (!raw || /^n\/?a$/i.test(raw) || raw.indexOf('@') !== -1) return '';
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 7) return '';
  return raw;
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
 * Fallback PHOTO URI when we cannot embed bytes (rare). Prefer App branding
 * logo embedded as base64 — iOS Contacts ignores most PHOTO;VALUE=URI links.
 * @param {object} member
 * @returns {string}
 */
function photoUriForMember(member) {
  if (!member || !member.reviewSlug) return '';
  const base = getReviewPublicBaseUrl();
  const slug = encodeURIComponent(member.reviewSlug);
  // Request-page / review logo (business mark) before personal profile photo.
  if (member.reviewLogoUpdatedAt) {
    const v = encodeURIComponent(String(member.reviewLogoUpdatedAt));
    return `${base}/rv/${slug}/logo.png?v=${v}`;
  }
  if (member.profilePhotoUpdatedAt) {
    const v = encodeURIComponent(String(member.profilePhotoUpdatedAt));
    return `${base}/rv/${slug}/avatar.png?v=${v}`;
  }
  return '';
}

/** vCard 3.0 soft line fold (75 octets; continuation lines start with a space). */
function foldVcardLine(line) {
  const raw = String(line || '');
  if (raw.length <= 75) return raw;
  let out = raw.slice(0, 75);
  let rest = raw.slice(75);
  while (rest.length) {
    out += `\r\n ${rest.slice(0, 74)}`;
    rest = rest.slice(74);
  }
  return out;
}

/**
 * Embed a JPEG/PNG buffer as PHOTO so iOS shows it on the contact card.
 * Remote PHOTO;VALUE=URI is usually ignored when saving from Messages/Safari.
 * @param {Buffer|Uint8Array} buffer
 * @param {string} [contentType]
 * @returns {string} full PHOTO property line (may include folded CRLF)
 */
function photoLineFromBuffer(buffer, contentType) {
  if (!buffer || !buffer.length) return '';
  // Keep contact cards small — skip huge embeds (caller should resize first).
  if (buffer.length > 180_000) return '';
  const ct = String(contentType || 'image/jpeg').toLowerCase();
  const type = ct.includes('png') ? 'PNG' : 'JPEG';
  const b64 = Buffer.from(buffer).toString('base64');
  return foldVcardLine(`PHOTO;ENCODING=b;TYPE=${type}:${b64}`);
}

/**
 * Business website from review-settings “other” links (label Website / homepage),
 * else Facebook page URL if set. Review request page is a separate URL field.
 * @param {object} member
 * @param {string} [leadWebsite] optional website from the linked CRM lead
 * @returns {string}
 */
function websiteFromMember(member, leadWebsite) {
  const links = member && member.reviewLinks && typeof member.reviewLinks === 'object'
    ? member.reviewLinks
    : {};
  const others = Array.isArray(links.other) ? links.other : [];
  const labeled = others.find(
    (row) => row && row.url && /web\s*site|homepage|^site$|^web$/i.test(String(row.label || '')),
  );
  if (labeled && labeled.url) return cleanText(labeled.url, 400);
  const fromLead = cleanText(leadWebsite, 400);
  if (fromLead && /^https?:\/\//i.test(fromLead)) return fromLead;
  if (links.facebook) return cleanText(links.facebook, 400);
  const otherHttps = others.find((row) => row && row.url && /^https?:\/\//i.test(row.url));
  if (otherHttps) return cleanText(otherHttps.url, 400);
  return '';
}

/**
 * Split "First Last" → { family, given } for the N property.
 * Business cards prefer empty N (company via FN/ORG + X-ABShowAs) so iOS
 * doesn’t put the owner’s first name in the First Name field.
 */
function nameParts(contactName, companyName, { asCompany = false } = {}) {
  if (asCompany) {
    return { family: '', given: '' };
  }
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
 * @param {string} [opts.contactName] person name (for TITLE + NOTE)
 * @param {string} [opts.phone]
 * @param {string} [opts.email]
 * @param {string} [opts.website] business website
 * @param {string} [opts.reviewUrl] public review request page
 * @param {string} [opts.photoUrl] HTTPS image URI (fallback only)
 * @param {Buffer|Uint8Array} [opts.photoBuffer] embedded photo (preferred; App branding logo)
 * @param {string} [opts.photoContentType]
 * @param {boolean} [opts.asCompany] iOS company contact (X-ABShowAs:COMPANY)
 * @returns {string}
 */
function buildVcard(opts = {}) {
  const org = cleanText(opts.org, 160);
  const fn = cleanText(opts.fn, 160) || org || cleanText(opts.contactName, 120) || 'Business';
  const phone = usablePhone(opts.phone);
  const email = cleanText(opts.email, 200);
  const website = cleanText(opts.website, 400);
  const reviewUrl = cleanText(opts.reviewUrl || opts.url, 400);
  const photoUrl = cleanText(opts.photoUrl, 600);
  const contact = cleanText(opts.contactName, 120);
  const asCompany = opts.asCompany !== false && !!org;
  const { family, given } = nameParts(opts.contactName, fn, { asCompany });

  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `FN:${escapeVcardValue(fn)}`,
    `N:${escapeVcardValue(family)};${escapeVcardValue(given)};;;`,
  ];
  if (asCompany) lines.push('X-ABShowAs:COMPANY');
  if (org) lines.push(`ORG:${escapeVcardValue(org)}`);
  if (contact) lines.push(`TITLE:${escapeVcardValue(contact)}`);
  // WORK first — this is the business profile number customers should save.
  if (phone) {
    lines.push(`TEL;TYPE=WORK,VOICE:${escapeVcardValue(phone)}`);
    lines.push(`TEL;TYPE=CELL,VOICE:${escapeVcardValue(phone)}`);
  }
  if (email) lines.push(`EMAIL;TYPE=INTERNET:${escapeVcardValue(email)}`);
  if (website && /^https?:\/\//i.test(website)) {
    lines.push(`URL;TYPE=WORK:${escapeVcardValue(website)}`);
  }
  if (reviewUrl && /^https?:\/\//i.test(reviewUrl) && reviewUrl !== website) {
    lines.push(`URL:${escapeVcardValue(reviewUrl)}`);
  }
  const embedded = photoLineFromBuffer(opts.photoBuffer, opts.photoContentType);
  if (embedded) {
    lines.push(embedded);
  } else if (photoUrl && /^https:\/\//i.test(photoUrl)) {
    lines.push(`PHOTO;VALUE=URI;TYPE=JPEG:${escapeVcardValue(photoUrl)}`);
  }
  if (contact) {
    lines.push(`NOTE:${escapeVcardValue(`Contact: ${contact}`)}`);
  }
  lines.push('END:VCARD');
  return `${lines.join('\r\n')}\r\n`;
}

/**
 * Build vCard + download filename from a network member record.
 * @param {object} member
 * @param {{ website?: string, phone?: string, email?: string, photoBuffer?: Buffer, photoContentType?: string }} [extras]
 * @returns {{ body: string, filename: string, url: string } | null}
 */
function vcardFromMember(member, extras) {
  if (!member || !member.reviewSlug) return null;
  const company = cleanText(member.companyName, 160) || 'Business';
  const leadWebsite = extras && extras.website ? extras.website : '';
  const phone = usablePhone(member.phone) || usablePhone(extras && extras.phone) || '';
  const email = cleanText(member.email, 200)
    || cleanText(extras && extras.email, 200)
    || '';
  const photoBuffer = extras && extras.photoBuffer ? extras.photoBuffer : null;
  const body = buildVcard({
    fn: company,
    org: company,
    contactName: member.contactName,
    phone,
    email,
    website: websiteFromMember(member, leadWebsite),
    reviewUrl: getReviewPageUrl(member.reviewSlug),
    photoUrl: photoBuffer ? '' : photoUriForMember(member),
    photoBuffer,
    photoContentType: extras && extras.photoContentType,
    asCompany: true,
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
  usablePhone,
  foldVcardLine,
  photoLineFromBuffer,
  getBusinessVcardUrl,
  photoUriForMember,
  websiteFromMember,
  buildVcard,
  vcardFromMember,
};
