const { parse } = require('csv-parse/sync');
const XLSX = require('xlsx');
const { scoreLocalProspect } = require('./localProspectScore');

const XLSX_EXT = /\.xlsx?$/i;

function isExcelImportFilename(filename) {
  return XLSX_EXT.test(String(filename || ''));
}

/**
 * @param {Buffer} buffer
 * @returns {Array<Record<string, unknown>>}
 */
function parseXlsxRows(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheetName = wb.SheetNames && wb.SheetNames[0];
  if (!sheetName) return [];
  const sheet = wb.Sheets[sheetName];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
}

/**
 * Normalize CSV header keys for flexible column matching.
 * @param {Record<string, string>} row
 */
function normalizeKeys(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    const key = String(k || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    if (!key) continue;
    out[key] = v == null ? '' : String(v).trim();
  }
  return out;
}

function stripTablePreamble(text) {
  const lines = String(text || '').split(/\r?\n/);
  if (lines.length < 2) return text;
  const first = String(lines[0] || '').trim();
  const second = String(lines[1] || '').trim();
  // Outscraper exports may prepend "Table 1" before actual CSV headers.
  if (/^table\s+\d+$/i.test(first) && second.includes(',')) {
    return lines.slice(1).join('\n');
  }
  return text;
}

function stripUtf8Bom(text) {
  return String(text || '').replace(/^\uFEFF/, '');
}

function detectCsvDelimiter(headerLine) {
  const line = String(headerLine || '');
  const candidates = [
    [',', (line.match(/,/g) || []).length],
    [';', (line.match(/;/g) || []).length],
    ['\t', (line.match(/\t/g) || []).length],
  ];
  candidates.sort((a, b) => b[1] - a[1]);
  return candidates[0][1] > 0 ? candidates[0][0] : ',';
}

/**
 * @param {Buffer} buffer
 * @returns {Array<Record<string, unknown>>}
 */
function parseCsvRawRows(buffer) {
  const textRaw = stripUtf8Bom(buffer.toString('utf8'));
  const text = stripTablePreamble(textRaw);
  if (!text.trim()) return [];

  const headerLine = text.split(/\r?\n/).find((l) => String(l).trim()) || '';
  const delimiter = detectCsvDelimiter(headerLine);

  return parse(text, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
    relax_quotes: true,
    delimiter,
  });
}

function isPlaceholderValue(v) {
  const s = String(v ?? '').trim();
  if (!s) return true;
  if (/^(n\/a|na|none|null|—|-|\.)$/i.test(s)) return true;
  if (/^not\s+found$/i.test(s)) return true;
  return false;
}

function firstNonEmpty(r, keys) {
  for (const key of keys) {
    const v = r[key];
    if (!isPlaceholderValue(v)) return String(v).trim();
  }
  return '';
}

function collectImportFields(row) {
  const normalized = normalizeKeys(row);
  const out = {};
  for (const [k, v] of Object.entries(normalized)) {
    if (isPlaceholderValue(v)) continue;
    out[k] = String(v).trim();
  }
  return out;
}

function parseCityStateFromLocation(address) {
  if (isPlaceholderValue(address)) {
    return { city: '', state: '' };
  }
  const m = address.match(/,\s*([^,]+),\s*([A-Z]{2})(?:\s+\d{5}(?:-\d{4})?)?\s*$/i);
  if (m) {
    return { city: m[1].trim(), state: m[2].toUpperCase() };
  }
  const tail = address.match(/,\s*([A-Z]{2})\s*$/i);
  if (tail) {
    const state = tail[1].toUpperCase();
    const before = address.slice(0, tail.index).trim();
    const parts = before.split(/\s*\/\s*/).map((p) => p.trim()).filter(Boolean);
    const city = parts.length ? parts[parts.length - 1] : before;
    return { city, state };
  }
  return { city: '', state: '' };
}

function parseAreaField(r) {
  const area = firstNonEmpty(r, [
    'area',
    'service_area',
    'market',
    'territory',
    'company_location',
    'location',
    'address',
  ]);
  if (!area) {
    return { address: '', city: '', state: '' };
  }
  const { city, state } = parseCityStateFromLocation(area);
  return { address: area, city, state };
}

function safeHostname(raw) {
  const s = String(raw || '').trim();
  if (!s || isPlaceholderValue(s)) return '';
  try {
    const u = new URL(s.includes('://') ? s : `https://${s}`);
    return u.hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return '';
  }
}

function isGoogleMapsUrl(u) {
  const s = String(u || '').toLowerCase();
  return (
    s.includes('google.com/maps') ||
    s.includes('maps.app.goo.gl') ||
    s.includes('goo.gl/maps') ||
    s.includes('maps.google.com')
  );
}

function splitUrlList(raw) {
  if (isPlaceholderValue(raw)) return [];
  return String(raw)
    .split(/[\s,;|]+/)
    .map((s) => s.trim())
    .filter((s) => /^https?:\/\//i.test(s) || /^www\./i.test(s) || /^[a-z0-9][-a-z0-9]*\.[a-z]{2,}/i.test(s));
}

function normalizeWebsite(raw) {
  if (isPlaceholderValue(raw)) return 'N/A';
  let u = String(raw).trim();
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  return u;
}

function parseSocialUrls(raw) {
  const out = { facebook: 'N/A', instagram: 'N/A', twitter: 'N/A', linkedin: '' };
  for (const token of splitUrlList(raw)) {
    const url = normalizeWebsite(token);
    if (url === 'N/A') continue;
    const host = safeHostname(url);
    if (!host) continue;
    if (host.includes('facebook.com') || host === 'fb.com') out.facebook = url;
    else if (host.includes('instagram.com')) out.instagram = url;
    else if (host.includes('twitter.com') || host === 'x.com') out.twitter = url;
    else if (host.includes('linkedin.com')) out.linkedin = url;
  }
  return out;
}

function pickMapsUrlFromSources(r) {
  const direct = firstNonEmpty(r, [
    'google_maps_url',
    'maps_url',
    'gbp_link',
    'google_business_profile',
    'gbp_url',
    'place_url',
  ]);
  if (direct) return direct;
  for (const key of ['source_urls', 'source_url', 'sources', 'listing_url', 'url']) {
    for (const u of splitUrlList(r[key])) {
      if (isGoogleMapsUrl(u)) return u;
    }
  }
  return '';
}

function normalizeProspectTier(raw) {
  const s = String(raw || '')
    .trim()
    .toLowerCase();
  if (s === 'hot') return 'Hot';
  if (s === 'warm') return 'Warm';
  if (s === 'low' || s === 'cold') return 'Low';
  if (s === 'skip') return 'Skip';
  return '';
}

function pickPrimaryEmail(r) {
  const dm = (r.decision_maker_email || '').trim();
  const one = (r.one_email || '').trim();
  const direct = (r.e_mail || r.email || '').trim();
  if (dm) return dm;
  if (one) return one;
  if (direct && !/^n\/a$/i.test(direct)) return direct;
  const list = (r.company_emails || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const first = list[0] || '';
  if (first && !/^n\/a$/i.test(first)) return first;
  return '';
}

function parseReviewCount(r) {
  const raw =
    r.reviews ||
    r.review_count ||
    r.reviewcount ||
    r.reviewscount ||
    r.reviews_count ||
    r.total_review ||
    r.total_reviews ||
    r.number_of_reviews ||
    r.num_reviews;
  const n = parseInt(String(raw ?? '').replace(/,/g, ''), 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function parseReviewSnippet(r) {
  const raw = firstNonEmpty(r, [
    'review_snippet',
    'reviewsnippet',
    'review_text',
    'review_quote',
    'snippet',
    'customer_review',
  ]);
  if (!raw) return undefined;
  const text = String(raw).replace(/^["']+|["']+$/g, '').trim();
  return text ? [text.slice(0, 2000)] : undefined;
}

function parseSponsored(r) {
  const raw = firstNonEmpty(r, ['sponsored', 'is_sponsored', 'ad', 'is_ad', 'paid_listing']);
  if (!raw) return undefined;
  const s = String(raw).trim().toLowerCase();
  if (['yes', 'true', '1', 'y'].includes(s)) return true;
  if (['no', 'false', '0', 'n'].includes(s)) return false;
  return undefined;
}

function parseStarRating(r) {
  const raw = r.rating || r.totalscore || r.stars || r.avg_rating || r.star_rating;
  const f = parseFloat(String(raw ?? '').replace(/,/g, ''));
  return Number.isFinite(f) && f > 0 ? f : 0;
}

function trimGbpField(raw, maxLen) {
  const s = String(raw ?? '').trim();
  if (!s || /^n\/a$/i.test(s)) return '';
  return s.slice(0, maxLen);
}

function parseImportPrice(raw) {
  const s = String(raw ?? '')
    .trim()
    .replace(/[$,\s]/g, '');
  if (!s) return null;
  const n = parseFloat(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseImportNumber(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

function parseListingNote(note) {
  const s = String(note || '');
  const priceRaw = (s.match(/Price:\s*\$?\s*([\d,]+)/i) || [])[1];
  const bedsRaw = (s.match(/Beds:\s*([\d.]+)/i) || [])[1];
  const bathsRaw = (s.match(/Baths:\s*([\d.]+)/i) || [])[1];
  const price = priceRaw ? parseInt(String(priceRaw).replace(/,/g, ''), 10) : null;
  const beds = bedsRaw ? parseFloat(bedsRaw) : null;
  const baths = bathsRaw ? parseFloat(bathsRaw) : null;
  return {
    price: Number.isFinite(price) && price > 0 ? price : null,
    beds: Number.isFinite(beds) ? beds : null,
    baths: Number.isFinite(baths) ? baths : null,
  };
}

function mapImportSourceChannel(raw) {
  const s = String(raw || '')
    .trim()
    .toLowerCase();
  if (!s) return '';
  if (s.includes('facebook') || s.includes('marketplace')) return 'facebook_marketplace';
  if (s.includes('craigslist')) return 'craigslist';
  if (s.includes('zillow')) return 'zillow';
  if (s.includes('mhvillage') || s.includes('mh village')) return 'mhvillage';
  if (s.includes('realtor')) return 'realtor';
  if (s.includes('redfin')) return 'redfin';
  if (s.includes('offerup')) return 'offerup';
  if (s.includes('ebay')) return 'ebay';
  if (s.includes('google_maps') || s.includes('chrome_extension_maps')) return 'google_maps';
  if (s.includes('yelp')) return 'yelp';
  if (s.includes('yellowpages') || s.includes('yellow pages')) return 'yellowpages';
  if (s.includes('tripadvisor')) return 'tripadvisor';
  if (s.includes('homeadvisor')) return 'homeadvisor';
  if (s.includes('thumbtack')) return 'thumbtack';
  if (s.includes('linkedin')) return s.includes('company') ? 'linkedin_company' : 'linkedin_profile';
  if (s.includes('instagram')) return 'instagram';
  if (s.includes('nextdoor')) return 'nextdoor';
  if (s.includes('houzz')) return 'houzz';
  if (s.includes('groupon')) return 'groupon';
  if (s.includes('bbb')) return 'bbb';
  if (s.includes('angi')) return 'angi';
  return s.replace(/\s+/g, '_').slice(0, 48);
}

function isRealEstateImportRow(r) {
  const blob = [
    r.categoryname,
    r.category,
    r.company_type,
    r.source,
    r.company_name,
    r.title,
    r.name,
  ]
    .join(' ')
    .toLowerCase();
  return (
    /real\s*estate|mobile\s*home|manufactured\s*home|manufactured|mhvillage|zillow/.test(blob) ||
    /facebook\s*marketplace|craigslist/.test(blob) ||
    /^fb:|^facebook:|^craigslist:/i.test(String(r.company_name || r.title || r.name || ''))
  );
}

function pickListingUrl(r) {
  return firstNonEmpty(r, [
    'url',
    'listing_url',
    'source_url',
    'source_urls',
    'company_website',
    'website',
    'website_url',
  ]);
}

function applyRealEstateListingFields(lead, r, options = {}) {
  const listingUrl = pickListingUrl(r);
  const importSourceRaw = firstNonEmpty(r, ['source', 'source_channel']);
  const sourceChannel = mapImportSourceChannel(importSourceRaw);
  const noteText = firstNonEmpty(r, ['note', 'notes', 'why_prospect', 'why']);
  const noteParsed = parseListingNote(noteText);
  const priceFromCol = parseImportPrice(firstNonEmpty(r, ['price', 'listing_price', 'list_price', 'asking_price']));
  const bedsFromCol = parseImportNumber(firstNonEmpty(r, ['beds', 'bedrooms', 'bed', 'br']));
  const bathsFromCol = parseImportNumber(firstNonEmpty(r, ['baths', 'bathrooms', 'bath', 'ba']));
  const isListing = isRealEstateImportRow(r) || (!!listingUrl && !!sourceChannel);

  if (!isListing) return lead;

  lead.jobType = 'real_estate';
  lead.sourceType = 'real_estate';
  if (sourceChannel) lead.sourceChannel = sourceChannel;

  if (listingUrl) {
    const normalized = normalizeWebsite(listingUrl);
    lead.url = normalized;
    lead.website = normalized;
    if (sourceChannel === 'facebook_marketplace' || /facebook\.com/i.test(normalized)) {
      lead.facebook = normalized;
    }
  }

  const categoryLabel = firstNonEmpty(r, [
    'categoryname',
    'category',
    'company_type',
    'industry',
    'type',
  ]);
  if (categoryLabel) lead.categoryName = categoryLabel;

  lead.listing = {
    source: sourceChannel || options.leadSource || 'csv_import',
    price: priceFromCol ?? noteParsed.price,
    beds: bedsFromCol ?? noteParsed.beds,
    baths: bathsFromCol ?? noteParsed.baths,
    propertyType: /mobile|manufactured/i.test(categoryLabel || '') ? 'mobile_home' : 'real_estate',
    url: lead.url || listingUrl || undefined,
  };

  return lead;
}

function toLeadPayload(row, originalFilename, rowIndex, options = {}) {
  const r = normalizeKeys(row);
  const importFields = collectImportFields(row);
  const leadSource =
    typeof options.leadSource === 'string' && options.leadSource.trim()
      ? options.leadSource.trim()
      : 'csv_import';

  let title =
    (
      r.company_name ||
      r.business_name ||
      r.business ||
      r.company ||
      r.account_name ||
      r.organization ||
      r.org_name ||
      r.lead_name ||
      r.contact_name ||
      r.full_name ||
      r.title ||
      r.name ||
      r.companyname ||
      ''
    ).trim() || (r.company_domain || '').trim();

  if (!title) {
    const websiteRaw = firstNonEmpty(r, [
      'company_website',
      'website',
      'website_url',
      'website_link',
      'site_url',
      'domain',
    ]);
    if (websiteRaw) {
      title = websiteRaw
        .replace(/^https?:\/\//i, '')
        .replace(/^www\./i, '')
        .split('/')[0]
        .trim();
    }
  }
  if (!title) {
    const emailRaw = pickPrimaryEmail(r);
    if (emailRaw && emailRaw.includes('@')) {
      title = emailRaw.split('@')[0].replace(/[._-]+/g, ' ').trim();
    }
  }
  if (!title) {
    const phone = (r.phone_number || r.phone || r.telephone || '').trim();
    if (phone) title = `Lead ${phone}`;
  }
  if (!title) return null;

  const areaPack = parseAreaField(r);
  const companyLocation = firstNonEmpty(r, ['company_location', 'address', 'full_address']);
  const address =
    areaPack.address ||
    companyLocation ||
    [r.address_line_1, r.city, r.state].filter((x) => !isPlaceholderValue(x)).join(', ').trim() ||
    'N/A';

  const websiteRaw = firstNonEmpty(r, [
    'company_website',
    'website',
    'website_url',
    'website_link',
    'site_url',
    'web',
    'domain',
  ]);
  const website = websiteRaw ? normalizeWebsite(websiteRaw) : 'N/A';

  let companyDomain = firstNonEmpty(r, ['company_domain', 'domain']);
  if (!companyDomain && website && website !== 'N/A') {
    companyDomain = safeHostname(website);
  }

  const phone = firstNonEmpty(r, ['phone_number', 'phone', 'telephone', 'mobile', 'tel']) || 'N/A';

  const emailRaw = pickPrimaryEmail(r);
  const email = emailRaw || 'N/A';

  const categoryName =
    firstNonEmpty(r, [
      'company_type',
      'subtypes',
      'category',
      'categoryname',
      'industry',
      'type',
      'business_type',
    ]) || (isRealEstateImportRow(r) ? 'Real Estate' : 'Imported');

  const socials = parseSocialUrls(
    firstNonEmpty(r, ['social_urls', 'socials', 'social_links', 'social_profiles'])
  );
  const linkedin =
    firstNonEmpty(r, ['decision_maker_linkedin_url', 'linkedin', 'linkedin_url']) ||
    socials.linkedin ||
    '';
  const decisionMakerName = firstNonEmpty(r, ['decision_maker_name', 'contact_name', 'owner_name']);
  const decisionMakerTitle = firstNonEmpty(r, ['decision_maker_job_title', 'contact_title', 'title_role']);

  const lat = firstNonEmpty(r, ['latitude', 'lat']);
  const lng = firstNonEmpty(r, ['longitude', 'lng', 'lon']);

  const mapsUrl = pickMapsUrlFromSources(r);
  const listingUrlEarly = pickListingUrl(r);
  const whyProspect = firstNonEmpty(r, ['why_prospect', 'why', 'prospect_reason', 'notes', 'note']);
  const importedTier = normalizeProspectTier(
    firstNonEmpty(r, ['score', 'prospect_tier', 'tier', 'priority', 'lead_score'])
  );
  const importedWebsiteStatus = firstNonEmpty(r, ['website_status', 'website_status_label', 'site_status']);
  const distanceKm = firstNonEmpty(r, ['distance_km', 'distance', 'distance_miles']);

  const reviewSnippets = parseReviewSnippet(r);
  const sponsored = parseSponsored(r);
  const importSourceRaw = firstNonEmpty(r, ['source_channel', 'sourcechannel', 'source']);
  const sourceChannel = mapImportSourceChannel(importSourceRaw);

  const lead = {
    title,
    phone,
    website,
    email,
    categoryName,
    address: address || 'N/A',
    city: areaPack.city || firstNonEmpty(r, ['city']) || '',
    state: areaPack.state || firstNonEmpty(r, ['state', 'region']) || '',
    totalScore: parseStarRating(r),
    reviewsCount: parseReviewCount(r),
    reviewSnippets: reviewSnippets || undefined,
    sponsored: sponsored !== undefined ? sponsored : undefined,
    url: mapsUrl || listingUrlEarly || '',
    gbpClaimStatus: trimGbpField(
      firstNonEmpty(r, ['claim_status', 'gbp_claim_status', 'claimed']),
      80
    ),
    gbpOptimizationScore: trimGbpField(
      firstNonEmpty(r, ['optimization_score', 'gbp_optimization_score', 'gbp_score']),
      32
    ),
    facebook: socials.facebook,
    instagram: socials.instagram,
    twitter: socials.twitter,
    status: 'Not Contacted',
    loomUrl: '',
    savedAt: new Date().toISOString(),
    source: leadSource,
    importFilename: originalFilename || 'upload.csv',
    importRowIndex: rowIndex,
    importFields,
    linkedin: linkedin || undefined,
    decisionMakerName: decisionMakerName || undefined,
    decisionMakerTitle: decisionMakerTitle || undefined,
    companyEmails: firstNonEmpty(r, ['company_emails']) || undefined,
    companyDomain: companyDomain || undefined,
    latitude: lat || undefined,
    longitude: lng || undefined,
    emailValidationStatus: firstNonEmpty(r, ['email_validation_status']) || undefined,
    ownerSignal: whyProspect || undefined,
    prospectTier: importedTier || undefined,
    websiteStatusLabel: importedWebsiteStatus || undefined,
    distanceKm: distanceKm || undefined,
  };

  if (sourceChannel) lead.sourceChannel = sourceChannel;

  if (whyProspect) {
    lead.updates = [
      {
        type: 'import',
        message: whyProspect.slice(0, 2000),
        timestamp: new Date().toISOString(),
      },
    ];
  }

  applyRealEstateListingFields(lead, r, options);

  const scored = scoreLocalProspect(lead);
  if (!lead.prospectTier) lead.prospectTier = scored.prospectTier;
  if (!lead.websiteStatusLabel) lead.websiteStatusLabel = scored.websiteStatusLabel;
  lead.websiteStatus = scored.websiteStatus;

  return lead;
}

/**
 * Parse uploaded CSV bytes into LeadSOS-shaped records for db.saveLead().
 * @param {Buffer} buffer
 * @param {string} originalFilename
 * @returns {Array<Record<string, unknown>>}
 */
function rowsToLeadRecords(rows, originalFilename, options = {}) {
  const leads = [];
  let i = 0;
  for (const row of rows) {
    const lead = toLeadPayload(row, originalFilename, i, options);
    if (lead) leads.push(lead);
    i += 1;
  }
  return leads;
}

/**
 * @returns {{ leads: Array<Record<string, unknown>>, rawRowCount: number }}
 */
function parseImportFile(buffer, originalFilename, options = {}) {
  let rawRows = [];
  if (isExcelImportFilename(originalFilename)) {
    rawRows = parseXlsxRows(buffer);
  } else {
    rawRows = parseCsvRawRows(buffer);
  }
  const leads = rowsToLeadRecords(rawRows, originalFilename, options);
  return { leads, rawRowCount: rawRows.length };
}

function parseCsvToLeadRecords(buffer, originalFilename, options = {}) {
  return parseImportFile(buffer, originalFilename, options).leads;
}

module.exports = {
  parseCsvToLeadRecords,
  parseImportFile,
  toLeadPayload,
  isExcelImportFilename,
  parseXlsxRows,
  parseCsvRawRows,
  detectCsvDelimiter,
  isPlaceholderValue,
  parseSocialUrls,
  parseAreaField,
  parseListingNote,
  parseReviewCount,
  parseReviewSnippet,
  parseSponsored,
  mapImportSourceChannel,
  isRealEstateImportRow,
  pickListingUrl,
  applyRealEstateListingFields,
};
