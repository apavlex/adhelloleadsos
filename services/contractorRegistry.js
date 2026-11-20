/**
 * HomeElk contractor lead builder.
 * Pulls active WA L&I (986/985) and Oregon CCB (Multnomah, Washington, Clackamas)
 * licenses, tags them to trade folders, and dedupes by phone.
 * Public Socrata APIs — no registry key. Google Places enrichment is optional.
 */

const { JOB_TYPES } = require('./scrapeJobTypes');

const WA_API = 'https://data.wa.gov/resource/m8qx-ubtq.json';
const OR_API = 'https://data.oregon.gov/resource/g77e-6bhs.json';

const WA_SELECT = [
  'businessname',
  'contractorlicensenumber',
  'contractorlicensetypecodedesc',
  'city',
  'state',
  'zip',
  'phonenumber',
  'specialtycode1desc',
  'primaryprincipalname',
  'licenseeffectivedate',
  'licenseexpirationdate',
  'ubi',
  'statuscode',
].join(',');

const OR_SELECT = [
  'full_name',
  'license_number',
  'license_type',
  'county_name',
  'city',
  'state',
  'zip_code',
  'phone_number',
  'endorsement_text',
  'lic_exp_date',
  'rmi_name',
  'bond_amount',
  'bond_exp_date',
  'ins_amount',
  'ins_exp_date',
  'ins_company',
  'address',
].join(',');

/** Oregon CCB uses MM/DD/YYYY; store ISO dates when we can so scoring is timezone-stable. */
function normalizeRegistryDate(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (mdy) {
    return `${mdy[3]}-${mdy[1].padStart(2, '0')}-${mdy[2].padStart(2, '0')}`;
  }
  return s.slice(0, 10);
}

const WA_WHERE = "statuscode='A' AND (zip like '986%' OR zip like '985%')";
const OR_WHERE = "county_name in('Multnomah','Washington','Clackamas')";

const PAGE_SIZE = 2000;
const DEFAULT_MAX_RESULTS = 400;
const MAX_RESULTS_CAP = 5000;
const PLACES_LIMIT = 25;
const RAW_CAP = 60000;

/** Script trade id → folder label, and the ServiceTitan slug when one already exists. */
const CONTRACTOR_TRADES = [
  { id: 'electricians', folderName: 'Electricians', tradeSlug: 'electrical' },
  { id: 'plumbers', folderName: 'Plumbers', tradeSlug: 'plumbing' },
  { id: 'hvac', folderName: 'HVAC', tradeSlug: 'hvac' },
  { id: 'roofers', folderName: 'Roofers', tradeSlug: 'roofing' },
  { id: 'painters', folderName: 'Painters', tradeSlug: 'painting' },
  { id: 'flooring', folderName: 'Flooring', tradeSlug: '' },
  { id: 'handymen', folderName: 'Handymen', tradeSlug: 'handyman' },
  { id: 'remodelers', folderName: 'Remodelers', tradeSlug: 'remodeling' },
  { id: 'tile_masonry', folderName: 'Tile and Masonry', tradeSlug: '' },
  { id: 'cabinetry', folderName: 'Cabinetry', tradeSlug: '' },
  { id: 'siding', folderName: 'Siding and Exterior', tradeSlug: 'siding' },
];

const TRADE_BY_ID = CONTRACTOR_TRADES.reduce((acc, row) => {
  acc[row.id] = row;
  return acc;
}, {});

/** Raw specialty / endorsement / license-type → trade id. null = known skip. */
const TRADE_MAP = {
  GENERAL: 'remodelers',
  RESIDENTIAL: 'remodelers',
  'PAINTING/WALLCOVERING': 'painters',
  'FLOOR COVERING AND COUNTER TOPS': 'flooring',
  ROOFING: 'roofers',
  'HEATING/VENT/AIR-CONDITIONING AND REFRIG (HVAC/R)': 'hvac',
  'HVAC/RFRG': 'hvac',
  'HVAC/RFRG-RESTRICTED': 'hvac',
  'TILE, CERAMIC, MOSAIC, NATURAL AND MFG STONE': 'tile_masonry',
  MASONRY: 'tile_masonry',
  'CABINETS, MILLWORK AND FINISH CARPENTRY': 'cabinetry',
  SIDING: 'siding',
  HANDYMAN: 'handymen',
  LANDSCAPING: 'handymen',
  'ELECTRICAL CONTRACTOR': 'electricians',
  'PLUMBING CONTRACTOR': 'plumbers',
  'RESIDENTIAL GENERAL CONTRACTOR': 'remodelers',
  'COMMERCIAL GENERAL CONTRACTOR LEVEL 1': 'remodelers',
  'COMMERCIAL GENERAL CONTRACTOR LEVEL 2': 'remodelers',
  'RESIDENTIAL SPECIALTY CONTRACTOR': 'remodelers',
  'COMMERCIAL SPECIALTY CONTRACTOR LEVEL 1': 'remodelers',
  'COMMERCIAL SPECIALTY CONTRACTOR LEVEL 2': 'remodelers',
  'RESIDENTIAL LIMITED CONTRACTOR': 'handymen',
  'LEAD BASED PAINT RENOVATION CONTRACTOR': 'painters',
  'RESIDENTIAL LOCKSMITH SERVICES CONTRACTOR': 'handymen',
  'HOME INSPECTOR SERVICES CONTRACTOR': null,
  'OREGON CERTIFIED HOME INSPECTOR': null,
  'RESIDENTIAL DEVELOPER': null,
  'COMMERCIAL DEVELOPER': null,
  'CONSTRUCTION FLAGGING CONTRACTOR': null,
  'HOME ENERGY PERFORMANCE SCORE CONTRACTOR': null,
};

function tradeById(id) {
  return TRADE_BY_ID[String(id || '').trim()] || null;
}

function asList(value) {
  if (Array.isArray(value)) return value;
  if (value == null || value === '') return [];
  return [value];
}

function truthy(value) {
  const s = String(value == null ? '' : value).trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'on' || s === 'yes';
}

function cleanPhone(value) {
  if (!value) return null;
  const digits = String(value).replace(/\D/g, '');
  if (digits.length === 10) return digits;
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  return null;
}

function formatPhone(digits) {
  const d = cleanPhone(digits);
  if (!d) return '';
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

function titleCase(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\b([a-z])/g, (_m, ch) => ch.toUpperCase());
}

function tagTradeWa(row) {
  const lt = String((row && row.contractorlicensetypecodedesc) || '').toUpperCase();
  if (Object.prototype.hasOwnProperty.call(TRADE_MAP, lt) && TRADE_MAP[lt]) return TRADE_MAP[lt];
  const sp = String((row && row.specialtycode1desc) || '').toUpperCase();
  return TRADE_MAP[sp] || null;
}

function tagTradeOr(row) {
  const et = String((row && row.endorsement_text) || '').toUpperCase();
  if (Object.prototype.hasOwnProperty.call(TRADE_MAP, et)) return TRADE_MAP[et];
  const lt = String((row && row.license_type) || '').toUpperCase();
  return Object.prototype.hasOwnProperty.call(TRADE_MAP, lt) ? TRADE_MAP[lt] : null;
}

function normalizeWa(rows) {
  const out = [];
  for (const row of rows || []) {
    const trade = tagTradeWa(row);
    if (!trade) continue;
    const businessName = String(row.businessname || '').trim();
    if (!businessName) continue;
    out.push({
      source: 'WA_L&I',
      business_name: businessName,
      license_number: String(row.contractorlicensenumber || '').trim(),
      trade,
      city: titleCase(row.city),
      state: 'WA',
      zip: String(row.zip || '').slice(0, 5),
      phone: cleanPhone(row.phonenumber),
      principal: titleCase(row.primaryprincipalname),
      license_expires: normalizeRegistryDate(row.licenseexpirationdate),
      ubi: String(row.ubi || '').trim(),
      specialty_raw: String(row.specialtycode1desc || '').trim(),
    });
  }
  return out;
}

function normalizeOr(rows) {
  const out = [];
  for (const row of rows || []) {
    const trade = tagTradeOr(row);
    if (!trade) continue;
    const businessName = String(row.full_name || '').trim();
    if (!businessName) continue;
    out.push({
      source: 'OR_CCB',
      business_name: businessName,
      license_number: String(row.license_number || '').trim(),
      trade,
      city: titleCase(row.city),
      state: 'OR',
      zip: String(row.zip_code || '').slice(0, 5),
      phone: cleanPhone(row.phone_number),
      principal: titleCase(row.rmi_name),
      license_expires: normalizeRegistryDate(row.lic_exp_date),
      bond_amount: row.bond_amount,
      bond_expires: normalizeRegistryDate(row.bond_exp_date),
      insurance_amount: row.ins_amount,
      insurance_expires: normalizeRegistryDate(row.ins_exp_date),
      insurance_company: String(row.ins_company || '').trim() || undefined,
      address: String(row.address || '').trim(),
      endorsement_raw: String(row.endorsement_text || '').trim(),
    });
  }
  return out;
}

function dedupeContractors(records) {
  const seenPhone = new Set();
  const seenName = new Set();
  const out = [];
  for (const rec of records || []) {
    if (!rec) continue;
    if (rec.phone) {
      if (seenPhone.has(rec.phone)) continue;
      seenPhone.add(rec.phone);
    } else {
      const key = `${String(rec.business_name || '').toLowerCase()}|${String(rec.city || '').toLowerCase()}|${rec.state || ''}`;
      if (seenName.has(key)) continue;
      seenName.add(key);
    }
    out.push(rec);
  }
  return out;
}

/** Spread a capped import across trades instead of filling the cap with whichever trade sorts first. */
function capByTrade(records, max) {
  const list = records || [];
  const limit = Math.max(0, max);
  if (list.length <= limit) return list.slice();
  const byTrade = new Map();
  for (const rec of list) {
    const id = rec.trade || 'other';
    if (!byTrade.has(id)) byTrade.set(id, []);
    byTrade.get(id).push(rec);
  }
  const keys = [...byTrade.keys()];
  const out = [];
  let round = 0;
  while (out.length < limit) {
    let added = false;
    for (const key of keys) {
      const bucket = byTrade.get(key);
      if (bucket[round]) {
        out.push(bucket[round]);
        added = true;
        if (out.length >= limit) break;
      }
    }
    if (!added) break;
    round += 1;
  }
  return out;
}

function keywordLabel(params) {
  const regs = (params.registries || []).map((r) => (r === 'wa' ? 'WA' : 'OR'));
  const where = regs.length ? regs.join(' + ') : 'WA + OR';
  const trades = params.trades || [];
  if (trades.length && trades.length < CONTRACTOR_TRADES.length) {
    return `Licensed contractors · ${where} · ${trades.length} trade${trades.length === 1 ? '' : 's'}`;
  }
  return `Licensed contractors · ${where}`;
}

/**
 * @param {object} input form body or MCP args
 * @returns {{ ok: true, params: object } | { ok: false, error: string }}
 */
function parseContractorSearchInput(input) {
  const src = input && typeof input === 'object' ? input : {};
  let registries = asList(src.registries || src.contractorRegistries)
    .map((v) => String(v || '').trim().toLowerCase())
    .filter((v) => v === 'wa' || v === 'or');
  if (!registries.length) {
    if (truthy(src.waOnly) || truthy(src.wa_only)) registries = ['wa'];
    else if (truthy(src.orOnly) || truthy(src.or_only)) registries = ['or'];
    else if (src.registries || src.contractorRegistries) {
      return { ok: false, error: 'Select Washington, Oregon, or both.' };
    } else {
      registries = ['wa', 'or'];
    }
  }
  registries = [...new Set(registries)];

  const submitted = truthy(src.contractorTradesSubmitted);
  const requestedTrades = asList(src.trades || src.contractorTrades)
    .map((v) => String(v || '').trim().toLowerCase())
    .filter(Boolean);
  let trades = [...new Set(requestedTrades.filter((id) => TRADE_BY_ID[id]))];
  if ((submitted || requestedTrades.length) && !trades.length) {
    return { ok: false, error: 'Select at least one known trade.' };
  }

  const full = truthy(src.contractorFull) || truthy(src.full);
  let maxResults = parseInt(src.contractorMaxResults || src.contractor_limit || src.maxResults || src.max_results, 10);
  if (!Number.isFinite(maxResults) || maxResults <= 0) maxResults = DEFAULT_MAX_RESULTS;
  maxResults = Math.min(MAX_RESULTS_CAP, Math.max(1, maxResults));
  if (full) maxResults = MAX_RESULTS_CAP;

  const folderKey = String(src.folderKey || src.folder_id || '').trim();
  const newFolderName = String(src.newFolderName || '').trim();
  const mcpFolderName = String(src.folder_name || '').trim();
  const explicitFolder =
    (folderKey && folderKey !== '__new__') ||
    (folderKey === '__new__' && !!newFolderName) ||
    (!folderKey && !!mcpFolderName);
  const splitByTrade = src.splitByTrade === false ? false : !explicitFolder;

  return {
    ok: true,
    params: {
      registries,
      trades,
      maxResults,
      enrichPlaces: truthy(src.enrichPlaces) || truthy(src.enrich_places) || truthy(src.contractorPlaces),
      placesLimit: PLACES_LIMIT,
      splitByTrade,
      rawCap: Math.min(RAW_CAP, Math.max(maxResults * 20, 4000)),
    },
  };
}

function recordToLead(rec) {
  const row = rec && typeof rec === 'object' ? rec : {};
  if (row.title && row.contractorLicenseNumber) return row;
  const trade = tradeById(row.trade);
  const phoneMatch = row.google_match_confidence === 'phone';
  const notes = [
    row.license_number
      ? `${row.source === 'OR_CCB' ? 'CCB' : 'License'} ${row.license_number}`
      : '',
    row.license_expires
      ? `${row.source === 'OR_CCB' ? 'CCB' : 'License'} expires ${row.license_expires}`
      : '',
    row.insurance_expires ? `COI expires ${row.insurance_expires}` : '',
    row.specialty_raw || row.endorsement_raw || '',
    row.ubi ? `UBI ${row.ubi}` : '',
    row.bond_amount != null && row.bond_amount !== '' ? `Bond ${row.bond_amount}` : '',
    row.insurance_amount != null && row.insurance_amount !== '' ? `Insurance ${row.insurance_amount}` : '',
    row.insurance_company ? `Carrier ${row.insurance_company}` : '',
    row.google_match_confidence ? `Google match: ${row.google_match_confidence}` : '',
    !phoneMatch && row.google_website ? `Website ${row.google_website}` : '',
  ]
    .filter(Boolean)
    .join(' · ');

  const lead = {
    title: String(row.business_name || row.title || '').trim(),
    company: String(row.business_name || row.title || '').trim(),
    phone: formatPhone(row.phone) || undefined,
    city: row.city || undefined,
    state: row.state || undefined,
    zip: row.zip || undefined,
    address: row.address || undefined,
    contactName: row.principal || undefined,
    categoryName: trade ? trade.folderName : row.trade || undefined,
    source: 'contractor_registry',
    jobType: JOB_TYPES.CONTRACTORS,
    contractorRegistry: row.source || undefined,
    contractorLicenseNumber: row.license_number || undefined,
    contractorLicenseExpires: row.license_expires || undefined,
    contractorCoiExpires: row.insurance_expires || undefined,
    contractorBondExpires: row.bond_expires || undefined,
    contractorInsuranceCompany: row.insurance_company || undefined,
    contractorTrade: row.trade || undefined,
    notes: notes || undefined,
    pipelineStage: 1,
    updates: [
      {
        type: 'contractor_import',
        message: `Imported ${row.source || 'contractor'} license ${row.license_number || ''}`.trim(),
        timestamp: new Date().toISOString(),
      },
    ],
  };
  if (phoneMatch && row.google_website) lead.website = row.google_website;
  if (row.google_rating != null && row.google_rating !== '') lead.totalScore = Number(row.google_rating) || undefined;
  if (row.google_review_count != null && row.google_review_count !== '') {
    lead.reviewsCount = parseInt(row.google_review_count, 10) || undefined;
  }
  if (phoneMatch && row.google_place_id) lead.googlePlaceId = row.google_place_id;
  return lead;
}

async function readJson(fetchImpl, url) {
  const res = await fetchImpl(url, {
    headers: { Accept: 'application/json' },
    signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(120000) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Registry request failed (${res.status}) ${text.slice(0, 180)}`.trim());
  }
  const data = await res.json();
  if (data && data.error) throw new Error(String(data.message || data.error).slice(0, 200));
  return data;
}

async function sodapyGet(fetchImpl, url, { select, where, offset, limit }) {
  const params = new URLSearchParams();
  params.set('$select', select);
  params.set('$limit', String(limit));
  params.set('$offset', String(offset));
  params.set('$order', ':id');
  if (where) params.set('$where', where);
  const data = await readJson(fetchImpl, `${url}?${params.toString()}`);
  if (!Array.isArray(data)) throw new Error('Registry returned an unexpected payload.');
  return data;
}

async function pullRegistry(kind, params, { fetchImpl, sleep, onProgress }) {
  const isWa = kind === 'wa';
  const url = isWa ? WA_API : OR_API;
  const select = isWa ? WA_SELECT : OR_SELECT;
  const where = isWa ? WA_WHERE : OR_WHERE;
  const normalize = isWa ? normalizeWa : normalizeOr;
  const wanted = new Set(params.trades || []);
  const kept = [];
  let offset = 0;
  let raw = 0;
  while (raw < params.rawCap && kept.length < params.maxResults) {
    const limit = Math.min(PAGE_SIZE, params.rawCap - raw);
    // eslint-disable-next-line no-await-in-loop
    const batch = await sodapyGet(fetchImpl, url, { select, where, offset, limit });
    if (!batch.length) break;
    raw += batch.length;
    for (const rec of normalize(batch)) {
      if (wanted.size && !wanted.has(rec.trade)) continue;
      kept.push(rec);
      if (kept.length >= params.maxResults) break;
    }
    if (onProgress) {
      // eslint-disable-next-line no-await-in-loop
      await onProgress({
        registry: kind,
        raw,
        kept: kept.length,
        label: `Scanning ${isWa ? 'WA L&I' : 'Oregon CCB'} · ${kept.length} trades matched`,
      });
    }
    if (batch.length < limit) break;
    offset += batch.length;
    if (sleep) {
      // eslint-disable-next-line no-await-in-loop
      await sleep(150);
    }
  }
  return { records: kept, raw };
}

async function placeDetails(fetchImpl, placeId, apiKey) {
  const url = new URL('https://maps.googleapis.com/maps/api/place/details/json');
  url.searchParams.set('place_id', placeId);
  url.searchParams.set('fields', 'formatted_phone_number,website,name');
  url.searchParams.set('key', apiKey);
  const data = await readJson(fetchImpl, url.toString());
  if (data.status === 'REQUEST_DENIED' || data.status === 'OVER_QUERY_LIMIT') {
    const err = new Error(data.error_message || data.status);
    err.code = data.status;
    throw err;
  }
  return data.result && typeof data.result === 'object' ? data.result : {};
}

async function lookupPlace(rec, apiKey, fetchImpl) {
  const query = `${rec.business_name} ${rec.city} ${rec.state}`.trim();
  const url = new URL('https://maps.googleapis.com/maps/api/place/textsearch/json');
  url.searchParams.set('query', query);
  url.searchParams.set('key', apiKey);
  const data = await readJson(fetchImpl, url.toString());
  if (data.status === 'REQUEST_DENIED' || data.status === 'OVER_QUERY_LIMIT') {
    const err = new Error(data.error_message || data.status);
    err.code = data.status;
    throw err;
  }
  const results = Array.isArray(data.results) ? data.results.slice(0, 3) : [];
  if (!results.length) return null;
  let chosen = null;
  let confidence = 'name_only';
  for (const place of results) {
    if (!place || !place.place_id) continue;
    // eslint-disable-next-line no-await-in-loop
    const details = await placeDetails(fetchImpl, place.place_id, apiKey);
    const gphone = cleanPhone(details.formatted_phone_number);
    const pack = { place, details };
    if (gphone && rec.phone && gphone === rec.phone) {
      chosen = pack;
      confidence = 'phone';
      break;
    }
    if (!chosen) chosen = pack;
  }
  if (!chosen) return null;
  return {
    google_place_id: chosen.place.place_id,
    google_rating: chosen.place.rating,
    google_review_count: chosen.place.user_ratings_total,
    google_website: chosen.details.website || '',
    google_types: Array.isArray(chosen.place.types) ? chosen.place.types.slice(0, 5).join(',') : '',
    google_match_confidence: confidence,
  };
}

async function enrichPlaces(records, apiKey, { fetchImpl, sleep, limit }) {
  const out = [];
  const cap = Math.min(records.length, Math.max(0, limit || 0));
  for (let i = 0; i < records.length; i += 1) {
    const rec = { ...records[i] };
    if (i < cap) {
      // eslint-disable-next-line no-await-in-loop
      const info = await lookupPlace(rec, apiKey, fetchImpl);
      if (info) Object.assign(rec, info);
      if (sleep) {
        // eslint-disable-next-line no-await-in-loop
        await sleep(100);
      }
    }
    out.push(rec);
  }
  return out;
}

function summarize(records, extra) {
  const byTrade = {};
  const byState = {};
  let withPhone = 0;
  let placesMatched = 0;
  for (const rec of records) {
    byTrade[rec.trade] = (byTrade[rec.trade] || 0) + 1;
    byState[rec.state] = (byState[rec.state] || 0) + 1;
    if (rec.phone) withPhone += 1;
    if (rec.google_place_id) placesMatched += 1;
  }
  return {
    total: records.length,
    withPhone,
    placesMatched,
    byTrade,
    byState,
    ...(extra || {}),
  };
}

/**
 * Fetch, tag, dedupe, and optionally enrich. Does not write leads.
 * @param {object} params from parseContractorSearchInput
 * @param {{ fetchImpl?: Function, sleep?: Function, placesKey?: string, onProgress?: Function }} [deps]
 */
async function collectContractorRecords(params, deps = {}) {
  const fetchImpl = deps.fetchImpl || fetch;
  const sleep = deps.sleep;
  const onProgress = deps.onProgress;
  const errors = [];
  let combined = [];
  const raw = {};
  for (const kind of params.registries) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const pulled = await pullRegistry(kind, params, { fetchImpl, sleep, onProgress });
      raw[kind] = pulled.raw;
      combined = combined.concat(pulled.records);
    } catch (err) {
      raw[kind] = raw[kind] || 0;
      errors.push(`${kind === 'wa' ? 'WA L&I' : 'Oregon CCB'}: ${err && err.message ? err.message : 'request failed'}`);
    }
  }
  if (!combined.length && errors.length) {
    const err = new Error(errors.join(' '));
    err.registryErrors = errors;
    throw err;
  }

  let records = capByTrade(dedupeContractors(combined), params.maxResults);
  records.sort((a, b) =>
    String(a.trade).localeCompare(String(b.trade)) ||
    String(a.city).localeCompare(String(b.city)) ||
    String(a.business_name).localeCompare(String(b.business_name))
  );

  let placesError = '';
  if (params.enrichPlaces) {
    const key = String(deps.placesKey || '').trim();
    if (!key) {
      placesError = 'Google Places skipped — set GOOGLE_PLACES_API_KEY.';
    } else {
      try {
        records = await enrichPlaces(records, key, {
          fetchImpl,
          sleep,
          limit: Math.min(params.placesLimit || PLACES_LIMIT, records.length),
        });
      } catch (err) {
        placesError = err && err.message ? String(err.message).slice(0, 200) : 'Google Places failed';
      }
    }
  }

  return {
    records,
    placesError,
    errors,
    summary: summarize(records, { raw, errors, placesError }),
  };
}

function placesKeyFromEnv(integrationEnv) {
  const env = integrationEnv && typeof integrationEnv === 'object' ? integrationEnv : {};
  return String(env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_PLACES_API_KEY || '').trim();
}

module.exports = {
  WA_API,
  OR_API,
  WA_WHERE,
  OR_WHERE,
  CONTRACTOR_TRADES,
  TRADE_MAP,
  DEFAULT_MAX_RESULTS,
  MAX_RESULTS_CAP,
  PLACES_LIMIT,
  tradeById,
  cleanPhone,
  formatPhone,
  tagTradeWa,
  tagTradeOr,
  normalizeWa,
  normalizeOr,
  dedupeContractors,
  capByTrade,
  keywordLabel,
  parseContractorSearchInput,
  recordToLead,
  collectContractorRecords,
  placesKeyFromEnv,
};
