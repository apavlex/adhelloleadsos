const { parse } = require('csv-parse/sync');

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

function collectImportFields(row) {
  const normalized = normalizeKeys(row);
  const out = {};
  for (const [k, v] of Object.entries(normalized)) {
    if (v == null) continue;
    const s = String(v).trim();
    if (!s) continue;
    out[k] = s;
  }
  return out;
}

function parseCityStateFromLocation(address) {
  if (!address || address === 'N/A') {
    return { city: '', state: '' };
  }
  const m = address.match(/,\s*([^,]+),\s*([A-Z]{2})(?:\s+\d{5}(?:-\d{4})?)?\s*$/i);
  if (m) {
    return { city: m[1].trim(), state: m[2].toUpperCase() };
  }
  return { city: '', state: '' };
}

function normalizeWebsite(raw) {
  if (!raw || !String(raw).trim()) return 'N/A';
  let u = String(raw).trim();
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  return u;
}

function pickPrimaryEmail(r) {
  const dm = (r.decision_maker_email || '').trim();
  const one = (r.one_email || '').trim();
  if (dm) return dm;
  if (one) return one;
  const list = (r.company_emails || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return list[0] || '';
}

function toLeadPayload(row, originalFilename, rowIndex) {
  const r = normalizeKeys(row);
  const importFields = collectImportFields(row);

  const title =
    (r.company_name || r.business_name || r.title || r.name || '').trim() ||
    (r.company_domain || '').trim();
  if (!title) return null;

  const companyLocation = (r.company_location || r.address || '').trim();
  const { city, state } = parseCityStateFromLocation(companyLocation);
  const address =
    companyLocation ||
    [r.address_line_1, r.city, r.state].filter(Boolean).join(', ').trim() ||
    'N/A';

  const websiteRaw = (r.company_website || r.website || '').trim();
  const website = websiteRaw ? normalizeWebsite(websiteRaw) : 'N/A';

  const phone = (r.phone_number || r.phone || r.telephone || '').trim() || 'N/A';

  const emailRaw = pickPrimaryEmail(r);
  const email = emailRaw || 'N/A';

  const categoryName =
    (r.company_type || r.subtypes || r.category || r.categoryname || r.industry || r.type || 'Painters').trim() || 'Painters';

  const linkedin = (r.decision_maker_linkedin_url || r.linkedin || '').trim();
  const decisionMakerName = (r.decision_maker_name || '').trim();
  const decisionMakerTitle = (r.decision_maker_job_title || '').trim();

  const lat = (r.latitude || '').trim();
  const lng = (r.longitude || '').trim();

  return {
    title,
    phone,
    website,
    email,
    categoryName,
    address: address || 'N/A',
    city: city || (r.city || '').trim(),
    state: state || (r.state || '').trim(),
    totalScore: parseFloat(r.rating || r.totalscore || r.stars || '0') || 0,
    reviewsCount: parseInt(r.reviews || r.reviewscount || r.reviews_count || '0', 10) || 0,
    url: (r.google_maps_url || r.maps_url || r.url || '').trim() || '',
    facebook: 'N/A',
    instagram: 'N/A',
    twitter: 'N/A',
    status: 'Not Contacted',
    loomUrl: '',
    savedAt: new Date().toISOString(),
    source: 'csv_import',
    importFilename: originalFilename || 'upload.csv',
    importRowIndex: rowIndex,
    importFields,
    linkedin: linkedin || undefined,
    decisionMakerName: decisionMakerName || undefined,
    decisionMakerTitle: decisionMakerTitle || undefined,
    companyEmails: (r.company_emails || '').trim() || undefined,
    companyDomain: (r.company_domain || '').trim() || undefined,
    latitude: lat || undefined,
    longitude: lng || undefined,
    emailValidationStatus: (r.email_validation_status || '').trim() || undefined,
  };
}

/**
 * Parse uploaded CSV bytes into LeadSOS-shaped records for db.saveLead().
 * @param {Buffer} buffer
 * @param {string} originalFilename
 * @returns {Array<Record<string, unknown>>}
 */
function parseCsvToLeadRecords(buffer, originalFilename) {
  const textRaw = buffer.toString('utf8');
  const text = stripTablePreamble(textRaw);
  if (!text.trim()) return [];

  const rows = parse(text, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
    relax_quotes: true,
  });

  const leads = [];
  let i = 0;
  for (const row of rows) {
    const lead = toLeadPayload(row, originalFilename, i);
    if (lead) leads.push(lead);
    i += 1;
  }
  return leads;
}

module.exports = {
  parseCsvToLeadRecords,
  toLeadPayload,
};
