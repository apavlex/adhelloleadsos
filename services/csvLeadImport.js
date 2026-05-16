const { parse } = require('csv-parse/sync');
const XLSX = require('xlsx');

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
    r.reviewscount ||
    r.reviews_count ||
    r.total_review ||
    r.total_reviews ||
    r.number_of_reviews ||
    r.num_reviews;
  const n = parseInt(String(raw ?? '').replace(/,/g, ''), 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
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
    const websiteRaw = (r.company_website || r.website || r.domain || '').trim();
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
    totalScore: parseStarRating(r),
    reviewsCount: parseReviewCount(r),
    url: (r.google_maps_url || r.maps_url || r.gbp_link || r.url || '').trim() || '',
    gbpClaimStatus: trimGbpField(r.claim_status, 80),
    gbpOptimizationScore: trimGbpField(r.optimization_score, 32),
    facebook: 'N/A',
    instagram: 'N/A',
    twitter: 'N/A',
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
};
