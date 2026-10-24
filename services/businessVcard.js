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
 * Absolute HTTPS URI for PHOTO — same image as Profile / request-page logo:
 * profile photo → custom review logo → (none; initials on the page).
 * @param {object} member
 * @returns {string}
 */
function photoUriForMember(member) {
  if (!member || !member.reviewSlug) return '';
  const base = getReviewPublicBaseUrl();
  const slug = encodeURIComponent(member.reviewSlug);
  if (member.profilePhotoUpdatedAt) {
    const v = encodeURIComponent(String(member.profilePhotoUpdatedAt));
    return `${base}/rv/${slug}/avatar.png?v=${v}`;
  }
  if (member.reviewLogoUpdatedAt) {
    const v = encodeURIComponent(String(member.reviewLogoUpdatedAt));
    return `${base}/rv/${slug}/logo.png?v=${v}`;
  }
  return '';
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
 * @param {string} [opts.contactName] person name (for N + NOTE)
 * @param {string} [opts.phone]
 * @param {string} [opts.email]
 * @param {string} [opts.website] business website
 * @param {string} [opts.reviewUrl] public review request page
 * @param {string} [opts.photoUrl] HTTPS image URI (profile logo)
 * @returns {string}
 */
function buildVcard(opts = {}) {
  const org = cleanText(opts.org, 160);
  const fn = cleanText(opts.fn, 160) || org || cleanText(opts.contactName, 120) || 'Business';
  const phone = cleanText(opts.phone, 40);
  const email = cleanText(opts.email, 200);
  const website = cleanText(opts.website, 400);
  const reviewUrl = cleanText(opts.reviewUrl || opts.url, 400);
  const photoUrl = cleanText(opts.photoUrl, 600);
  const contact = cleanText(opts.contactName, 120);
  const { family, given } = nameParts(opts.contactName, fn);

  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `FN:${escapeVcardValue(fn)}`,
    `N:${escapeVcardValue(family)};${escapeVcardValue(given)};;;`,
  ];
  if (org) lines.push(`ORG:${escapeVcardValue(org)}`);
  if (contact) lines.push(`TITLE:${escapeVcardValue(contact)}`);
  if (phone) lines.push(`TEL;TYPE=CELL,VOICE:${escapeVcardValue(phone)}`);
  if (email) lines.push(`EMAIL;TYPE=INTERNET:${escapeVcardValue(email)}`);
  if (website && /^https?:\/\//i.test(website)) {
    lines.push(`URL;TYPE=WORK:${escapeVcardValue(website)}`);
  }
  if (reviewUrl && /^https?:\/\//i.test(reviewUrl) && reviewUrl !== website) {
    lines.push(`URL:${escapeVcardValue(reviewUrl)}`);
  }
  if (photoUrl && /^https:\/\//i.test(photoUrl)) {
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
 * @param {{ website?: string }} [extras] optional lead website override
 * @returns {{ body: string, filename: string, url: string } | null}
 */
function vcardFromMember(member, extras) {
  if (!member || !member.reviewSlug) return null;
  const company = cleanText(member.companyName, 160) || 'Business';
  const leadWebsite = extras && extras.website ? extras.website : '';
  const body = buildVcard({
    fn: company,
    org: company,
    contactName: member.contactName,
    phone: member.phone,
    email: member.email,
    website: websiteFromMember(member, leadWebsite),
    reviewUrl: getReviewPageUrl(member.reviewSlug),
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
  websiteFromMember,
  buildVcard,
  vcardFromMember,
};
