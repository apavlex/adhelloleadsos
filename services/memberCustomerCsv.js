/**
 * Bulk customer list import for the member app (CSV / Excel).
 */
const { parse } = require('csv-parse/sync');
const XLSX = require('xlsx');
const work = require('./memberWork');

const MAX_IMPORT_ROWS = 500;

function stripUtf8Bom(text) {
  return String(text || '').replace(/^\uFEFF/, '');
}

function normalizeKeys(row) {
  const out = {};
  for (const [k, v] of Object.entries(row || {})) {
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

function firstNonEmpty(row, keys) {
  for (const key of keys) {
    const v = String(row[key] || '').trim();
    if (v && !/^(n\/a|na|none|null|-)$/i.test(v)) return v;
  }
  return '';
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

function parseCsvRows(buffer) {
  const text = stripUtf8Bom(buffer.toString('utf8'));
  if (!text.trim()) return [];
  const headerLine = text.split(/\r?\n/).find((l) => String(l).trim()) || '';
  return parse(text, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
    relax_quotes: true,
    delimiter: detectCsvDelimiter(headerLine),
  });
}

function parseXlsxRows(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheetName = wb.SheetNames && wb.SheetNames[0];
  if (!sheetName) return [];
  return XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '', raw: false });
}

function isExcelFilename(filename) {
  return /\.xlsx?$/i.test(String(filename || ''));
}

function mapRowToCustomer(row) {
  const r = normalizeKeys(row);
  const first = firstNonEmpty(r, ['first_name', 'firstname', 'first', 'given_name']);
  const last = firstNonEmpty(r, ['last_name', 'lastname', 'last', 'surname', 'family_name']);
  const combined = [first, last].filter(Boolean).join(' ').trim();
  const name = firstNonEmpty(r, [
    'name',
    'customer',
    'customer_name',
    'full_name',
    'contact',
    'contact_name',
    'client',
    'client_name',
  ]) || combined;
  const phone = firstNonEmpty(r, [
    'phone',
    'mobile',
    'cell',
    'telephone',
    'phone_number',
    'mobile_phone',
    'cell_phone',
  ]);
  const email = firstNonEmpty(r, ['email', 'e_mail', 'email_address', 'mail']);
  const address = firstNonEmpty(r, [
    'address',
    'street',
    'street_address',
    'address1',
    'address_1',
    'full_address',
  ]);
  const notes = firstNonEmpty(r, ['notes', 'note', 'comments', 'comment']);
  return { name, phone, email, address, notes };
}

/**
 * Parse an uploaded customer list file into validated field objects.
 * @returns {{ ok: true, rows: object[] } | { ok: false, error: string }}
 */
function parseCustomerImportFile(buffer, filename) {
  if (!buffer || !Buffer.isBuffer(buffer) || !buffer.length) {
    return { ok: false, error: 'Choose a CSV or Excel file to upload.' };
  }
  let raw;
  try {
    raw = isExcelFilename(filename) ? parseXlsxRows(buffer) : parseCsvRows(buffer);
  } catch (err) {
    return { ok: false, error: err.message || 'Could not read that file.' };
  }
  if (!raw.length) return { ok: false, error: 'That file has no rows.' };

  const rows = [];
  const errors = [];
  for (let i = 0; i < raw.length && rows.length < MAX_IMPORT_ROWS; i += 1) {
    const fields = mapRowToCustomer(raw[i]);
    if (!fields.name && !fields.phone && !fields.email) continue;
    const checked = work.validateCustomer(fields);
    if (!checked.ok) {
      errors.push(`Row ${i + 2}: ${checked.error}`);
      continue;
    }
    rows.push(checked.fields);
  }
  if (!rows.length) {
    return {
      ok: false,
      error: errors[0] || 'No customers found. Include columns like Name, Phone, Email.',
    };
  }
  return { ok: true, rows, skipped: errors.length, truncate: raw.length > MAX_IMPORT_ROWS };
}

/**
 * Import parsed rows into a member's customer list (dedupe by phone/email).
 */
async function importCustomers(networkId, memberId, rows, { pushToGhl } = {}) {
  const existing = await work.listCustomers(networkId, memberId);
  let created = 0;
  let updated = 0;
  let failed = 0;
  const saved = [];

  for (const fields of rows) {
    const match = work.findCustomerMatch(existing, fields);
    // eslint-disable-next-line no-await-in-loop
    const result = await work.saveCustomer(networkId, memberId, fields, {
      id: match ? match.id : undefined,
      source: match ? match.source || 'csv' : 'csv',
      ghlContactId: match ? match.ghlContactId : undefined,
      ghlSyncedAt: match ? match.ghlSyncedAt : undefined,
    });
    if (!result.ok) {
      failed += 1;
      continue;
    }
    if (result.created) {
      created += 1;
      existing.push(result.customer);
    } else {
      updated += 1;
      const idx = existing.findIndex((c) => c.id === result.customer.id);
      if (idx >= 0) existing[idx] = result.customer;
    }
    saved.push(result.customer);
  }

  let ghl = null;
  if (pushToGhl && typeof pushToGhl === 'function' && saved.length) {
    ghl = await pushToGhl(saved);
  }

  return { ok: true, created, updated, failed, total: rows.length, ghl };
}

module.exports = {
  MAX_IMPORT_ROWS,
  parseCustomerImportFile,
  importCustomers,
  mapRowToCustomer,
  isExcelFilename,
};
