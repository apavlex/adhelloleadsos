/**
 * Coalesce scattered lead fields (contacts[], importFields, url) into top-level
 * panel/table shape so SSR rows and /panel-data return usable phone/address/map data.
 */

function hasContactValue(v) {
  const s = v == null ? '' : String(v).trim();
  return !!(s && s !== 'N/A' && s !== '—' && s !== '-' && s !== 'undefined' && s !== 'null');
}

function firstContactValue(...candidates) {
  for (const v of candidates) {
    if (hasContactValue(v)) return String(v).trim();
  }
  return '';
}

function pickImportField(importFields, keys) {
  if (!importFields || typeof importFields !== 'object') return '';
  const entries = Object.entries(importFields);
  for (const key of keys) {
    const lk = String(key || '').toLowerCase();
    for (const [k, v] of entries) {
      if (String(k || '').toLowerCase() === lk && hasContactValue(v)) {
        return String(v).trim();
      }
    }
  }
  return '';
}

function pickFromContacts(contacts) {
  const out = { phone: '', email: '', name: '' };
  if (!Array.isArray(contacts)) return out;
  const withPhone = contacts.filter((c) => c && hasContactValue(c.phone));
  const pri = withPhone.find((c) => c.primary) || withPhone[0];
  if (pri) {
    out.phone = String(pri.phone).trim();
    if (hasContactValue(pri.email)) out.email = String(pri.email).trim();
    if (hasContactValue(pri.name)) out.name = String(pri.name).trim();
  }
  if (!out.email) {
    const withEmail = contacts.find((c) => c && hasContactValue(c.email));
    if (withEmail) out.email = String(withEmail.email).trim();
  }
  return out;
}

function parseNum(raw, parser, fallback) {
  if (raw == null || raw === '') return fallback;
  const n = parser(String(raw).replace(/,/g, ''));
  return Number.isFinite(n) ? n : fallback;
}

/**
 * @param {Record<string, unknown>|null|undefined} lead
 * @returns {Record<string, unknown>}
 */
function normalizeLeadForPanel(lead) {
  if (!lead || typeof lead !== 'object') return lead || {};

  const imp = lead.importFields;
  const fromContacts = pickFromContacts(lead.contacts);

  const phone = firstContactValue(
    lead.phone,
    fromContacts.phone,
    pickImportField(imp, ['phone', 'phone_number', 'telephone', 'mobile', 'tel', 'primary_phone'])
  );

  const email = firstContactValue(
    lead.email,
    fromContacts.email,
    pickImportField(imp, ['email', 'email_address', 'primary_email', 'contact_email'])
  );

  const address = firstContactValue(
    lead.address,
    pickImportField(imp, [
      'address',
      'full_address',
      'company_location',
      'street_address',
      'location',
      'company_address',
    ])
  );

  const city = firstContactValue(
    lead.city,
    pickImportField(imp, ['city', 'locality', 'town'])
  );

  const state = firstContactValue(
    lead.state,
    pickImportField(imp, ['state', 'region', 'province'])
  );

  const website = firstContactValue(
    lead.website,
    pickImportField(imp, [
      'website',
      'website_url',
      'company_website',
      'site_url',
      'web',
      'domain',
    ])
  );

  const url = firstContactValue(
    lead.url,
    lead.googlePlaces,
    pickImportField(imp, ['url', 'google_maps_url', 'maps_url', 'google_places'])
  );

  const facebook = firstContactValue(
    lead.facebook,
    pickImportField(imp, ['facebook', 'facebook_url', 'fb', 'fb_url'])
  );

  const instagram = firstContactValue(
    lead.instagram,
    pickImportField(imp, ['instagram', 'instagram_url', 'ig'])
  );

  const twitter = firstContactValue(
    lead.twitter,
    pickImportField(imp, ['twitter', 'twitter_url', 'x', 'x_url'])
  );

  const latitude =
    lead.latitude != null && lead.latitude !== ''
      ? lead.latitude
      : pickImportField(imp, ['latitude', 'lat']) || undefined;

  const longitude =
    lead.longitude != null && lead.longitude !== ''
      ? lead.longitude
      : pickImportField(imp, ['longitude', 'lng', 'lon']) || undefined;

  const totalScore = parseNum(
    firstContactValue(
      lead.totalScore,
      lead.total_score,
      lead.rating,
      pickImportField(imp, ['totalscore', 'rating', 'stars', 'total_score'])
    ),
    parseFloat,
    0
  );

  const reviewsCount = parseNum(
    firstContactValue(
      lead.reviewsCount,
      lead.reviews_count,
      lead.reviews,
      pickImportField(imp, ['reviewscount', 'reviews_count', 'reviews', 'total_reviews'])
    ),
    (v) => parseInt(v, 10),
    0
  );

  const out = { ...lead };

  if (hasContactValue(phone)) out.phone = phone;
  else if (!hasContactValue(out.phone)) out.phone = out.phone || 'N/A';

  if (hasContactValue(email)) out.email = email;
  else if (!hasContactValue(out.email)) out.email = out.email || 'N/A';

  if (hasContactValue(website)) out.website = website;
  else if (!hasContactValue(out.website)) out.website = out.website || 'N/A';

  if (hasContactValue(address)) out.address = address;
  else if (!hasContactValue(out.address)) out.address = out.address || 'N/A';

  if (city) out.city = city;
  if (state) out.state = state;
  if (hasContactValue(url)) out.url = url;

  if (hasContactValue(facebook)) out.facebook = facebook;
  else if (!hasContactValue(out.facebook)) out.facebook = out.facebook || 'N/A';

  if (hasContactValue(instagram)) out.instagram = instagram;
  else if (!hasContactValue(out.instagram)) out.instagram = out.instagram || 'N/A';

  if (hasContactValue(twitter)) out.twitter = twitter;
  else if (!hasContactValue(out.twitter)) out.twitter = out.twitter || 'N/A';

  if (latitude != null && latitude !== '') out.latitude = latitude;
  if (longitude != null && longitude !== '') out.longitude = longitude;

  if (totalScore > 0) out.totalScore = totalScore;
  if (reviewsCount > 0) out.reviewsCount = reviewsCount;

  if (Array.isArray(lead.tags)) {
    out.tags = [...new Set(lead.tags.map((t) => String(t || '').trim()).filter(Boolean))];
  } else if (!Array.isArray(out.tags)) {
    out.tags = [];
  }

  return out;
}

function leadMissingCoreContact(lead) {
  const n = normalizeLeadForPanel(lead);
  return !hasContactValue(n.phone) || !hasContactValue(n.address);
}

module.exports = {
  hasContactValue,
  normalizeLeadForPanel,
  leadMissingCoreContact,
};
