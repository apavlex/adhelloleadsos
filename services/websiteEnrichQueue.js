/**
 * Queue of pipeline leads selected for Chrome-extension website contact scrape.
 * App enqueues lead keys; extension polls GET /autonomous/website-enrich-queue.
 */

const { hasContactValue } = require('./leadPanelNormalize');

const WEBSITE_ENRICH_FIELDS = [
  'email',
  'phone',
  'address',
  'city',
  'state',
  'zip',
  'facebook',
  'instagram',
  'twitter',
  'linkedin',
  'tiktok',
];

const QUEUE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_QUEUE_KEYS = 150;

function queueStorageKey(workspaceId) {
  const wid = String(workspaceId || 'default').trim() || 'default';
  return `website_enrich_queue:${wid}`;
}

function isMissingContactValue(v) {
  return !hasContactValue(v);
}

function normalizeWebsiteUrl(raw) {
  const s = String(raw || '').trim();
  if (!s || s === 'N/A') return '';
  try {
    const u = new URL(s.includes('://') ? s : `https://${s}`);
    if (!/^https?:$/i.test(u.protocol)) return '';
    const host = u.hostname.replace(/^www\./i, '').toLowerCase();
    if (!host || host === 'localhost') return '';
    if (host.includes('google.') && u.pathname.toLowerCase().includes('/maps')) return '';
    return u.toString();
  } catch {
    return '';
  }
}

function pickLeadWebsite(lead) {
  if (!lead) return '';
  const candidates = [
    lead.website,
    lead.url,
    lead.importFields && lead.importFields.website,
    lead.importFields && lead.importFields.company_website,
    lead.importFields && lead.importFields.domain,
    lead.importFields && lead.importFields.company_domain,
  ];
  for (const c of candidates) {
    const url = normalizeWebsiteUrl(c);
    if (url) return url;
  }
  return '';
}

function missingWebsiteEnrichFields(lead) {
  if (!lead) return [];
  const missing = [];
  for (const field of WEBSITE_ENRICH_FIELDS) {
    if (field === 'zip') {
      const zip = lead.zip || lead.postalCode;
      if (isMissingContactValue(zip)) missing.push('zip');
      continue;
    }
    if (isMissingContactValue(lead[field])) missing.push(field);
  }
  return missing;
}

function leadNeedsWebsiteEnrich(lead) {
  if (!pickLeadWebsite(lead)) return false;
  return missingWebsiteEnrichFields(lead).length > 0;
}

function buildWebsiteEnrichQueueItem(lead) {
  const website = pickLeadWebsite(lead);
  const missing = missingWebsiteEnrichFields(lead);
  if (!website || !missing.length) return null;
  return {
    key: lead.key,
    title: lead.title || '',
    website,
    missing,
  };
}

function buildWebsiteEnrichQueueItems(leads, { limit = MAX_QUEUE_KEYS } = {}) {
  const max = Math.min(Math.max(1, Number(limit) || MAX_QUEUE_KEYS), MAX_QUEUE_KEYS);
  const items = [];
  for (const lead of leads || []) {
    if (items.length >= max) break;
    const item = buildWebsiteEnrichQueueItem(lead);
    if (item) items.push(item);
  }
  return items;
}

/**
 * Build fill-missing PATCH from scraped website extract.
 * Only includes fields listed in `missing` (or all enrich fields if missing omitted).
 */
function buildWebsiteEnrichPatchFromScrape(detail, { missing, isValidEmail } = {}) {
  const patch = {};
  const allow = new Set(
    Array.isArray(missing) && missing.length ? missing : WEBSITE_ENRICH_FIELDS,
  );
  const src = detail && typeof detail === 'object' ? detail : {};

  const emailRaw = String(src.email || '').trim();
  if (allow.has('email') && emailRaw && emailRaw !== 'N/A') {
    const email = emailRaw.toLowerCase();
    const ok = typeof isValidEmail === 'function' ? isValidEmail(email) : true;
    if (ok) patch.email = email;
  }

  const phone = String(src.phone || '').trim();
  if (allow.has('phone') && phone && phone !== 'N/A') patch.phone = phone;

  const address = String(src.address || '').trim();
  if (allow.has('address') && address && address !== 'N/A') patch.address = address;

  const city = String(src.city || '').trim();
  if (allow.has('city') && city) patch.city = city;

  const state = String(src.state || '').trim();
  if (allow.has('state') && state) patch.state = state;

  const zip = String(src.zip || src.postalCode || '').trim();
  if (allow.has('zip') && zip) patch.zip = zip;

  for (const social of ['facebook', 'instagram', 'twitter', 'linkedin', 'tiktok']) {
    const val = String(src[social] || '').trim();
    if (allow.has(social) && val && val !== 'N/A') patch[social] = val;
  }

  return patch;
}

async function saveWebsiteEnrichQueue(dbService, workspaceId, leadKeys) {
  const keys = [];
  const seen = new Set();
  for (const raw of leadKeys || []) {
    const k = String(raw || '').trim().replace(/^lead:/i, '');
    if (!k || seen.has(k)) continue;
    seen.add(k);
    keys.push(k.startsWith('lead:') ? k : `lead:${k}`);
    if (keys.length >= MAX_QUEUE_KEYS) break;
  }
  const payload = {
    leadKeys: keys,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await dbService.putStorageKey(queueStorageKey(workspaceId), payload);
  return payload;
}

async function loadWebsiteEnrichQueue(dbService, workspaceId) {
  const raw = await dbService.peekStorageKey(queueStorageKey(workspaceId));
  if (!raw) return null;
  try {
    const doc = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!doc || !Array.isArray(doc.leadKeys)) return null;
    const createdAt = Date.parse(doc.createdAt || '') || 0;
    if (createdAt && Date.now() - createdAt > QUEUE_TTL_MS) {
      await clearWebsiteEnrichQueue(dbService, workspaceId);
      return null;
    }
    return doc;
  } catch {
    return null;
  }
}

async function clearWebsiteEnrichQueue(dbService, workspaceId) {
  await dbService.deleteStorageKey(queueStorageKey(workspaceId));
}

module.exports = {
  WEBSITE_ENRICH_FIELDS,
  MAX_QUEUE_KEYS,
  QUEUE_TTL_MS,
  queueStorageKey,
  isMissingContactValue,
  normalizeWebsiteUrl,
  pickLeadWebsite,
  missingWebsiteEnrichFields,
  leadNeedsWebsiteEnrich,
  buildWebsiteEnrichQueueItem,
  buildWebsiteEnrichQueueItems,
  buildWebsiteEnrichPatchFromScrape,
  saveWebsiteEnrichQueue,
  loadWebsiteEnrichQueue,
  clearWebsiteEnrichQueue,
};
