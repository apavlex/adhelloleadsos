/**
 * Shared filtering for outreach queue / folders fetch and pipeline GET filters.
 */

const { noteEntryBody } = require('./leadNotes');
const {
  quickLogLabelForDisposition,
  quickLogItemForStatus,
  isQuickLogFilterTagKey,
  leadMatchesQuickLogFilter,
} = require('./quickLogConfig');
const { computeProspectGapLabels, getLowReviewsThresholdFromWorkspace } = require('./prospectGapLabels');

function displayStatus(s) {
  const raw = s || 'Not Contacted';
  return raw === 'Needs Video' ? 'Not Contacted' : raw;
}

function leadCategoryLabel(lead) {
  const cat = String((lead && (lead.categoryName || lead.category)) || '').trim();
  if (!cat || cat === 'N/A') return '';
  return cat;
}

function buildPipelineCategoryOptions(leads) {
  const map = new Map();
  for (const l of leads || []) {
    const cat = leadCategoryLabel(l);
    if (!cat) continue;
    const key = cat.toLowerCase();
    if (!map.has(key)) map.set(key, cat);
  }
  return Array.from(map.values()).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: 'base' }),
  );
}

function leadMatchesCategoryFilter(lead, categoryRaw) {
  const want = String(categoryRaw || '').trim().toLowerCase();
  if (!want || want === 'all') return true;
  const cat = leadCategoryLabel(lead).toLowerCase();
  if (!cat) return false;
  return cat === want || cat.includes(want);
}

/** Local calendar day start (midnight) for YYYY-MM-DD from date input. */
function localDayStartMs(isoDate) {
  const s = String(isoDate || '').trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10) - 1;
  const d = parseInt(m[3], 10);
  const dt = new Date(y, mo, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo || dt.getDate() !== d) return null;
  dt.setHours(0, 0, 0, 0);
  return dt.getTime();
}

function localDayEndMs(isoDate) {
  const start = localDayStartMs(isoDate);
  if (start == null) return null;
  return start + 24 * 60 * 60 * 1000 - 1;
}

function leadCreatedMs(l) {
  const raw = l.createdAt || l.savedAt;
  if (!raw) return null;
  const t = Date.parse(raw);
  return Number.isNaN(t) ? null : t;
}

function isWarmSource(l) {
  const s = String(l.source || '');
  return s.startsWith('adhello_');
}

function isCsvImported(l) {
  const s = String(l.source || '');
  if (s === 'csv_import' || s === 'google_drive' || s === 'autonomous') return true;
  if (l.importFilename) return true;
  if (l.importRowIndex != null && l.importRowIndex !== '') return true;
  if (l.importFields && typeof l.importFields === 'object' && Object.keys(l.importFields).length > 0) {
    return true;
  }
  return false;
}

function isManualSource(l) {
  const s = String(l.source || '');
  return s === 'manual_offline' || s.startsWith('manual');
}

/** Maps / search saves: cold workspace leads not from file import (CSV/Drive) or manual entry. */
function isSearchedSource(l) {
  if (isWarmSource(l)) return false;
  if (isCsvImported(l)) return false;
  if (isManualSource(l)) return false;
  return true;
}

const LISTING_SOURCE_RE =
  /craigslist|facebook\s*marketplace|marketplace|offerup|ebay|zillow|realtor|redfin|mhvillage|mh\s*village/i;

const LISTING_TITLE_PREFIX_RE = /^(cl|fb|facebook|craigslist|zillow|realtor|redfin|offerup|ebay)\s*:/i;

/** Craigslist-style titles without a CL:/FB: prefix (price + housing keywords). */
const LISTING_TITLE_BODY_RE =
  /\bhome for (sale|rent)\b|\b(mobile|manufactured) home\b|\bsingle\s*wide\b|\bdouble\s*wide\b|\bmove-?in ready\b|\bfor rent\b|\bfor sale\b|\b\d+\s*(bed|bd|br|bath|ba)\b|\$\s*[\d,]+(?:\.\d{2})?/i;

const LISTING_TITLE_PRICE_HOME_RE =
  /\$\s*[\d,]+(?:\.\d{2})?.*\b(home|house|mobile home|manufactured home|property|lot|acre|duplex|rent|sale)\b|\b(home|house|mobile home|manufactured home|property|lot|duplex)\b.*\$\s*[\d,]+(?:\.\d{2})?/i;

const LISTING_CATEGORY_RE =
  /real\s*estate|mobile\s*home|manufactured\s*home|single\s*wide|double\s*wide|trailer|home\s*for\s*sale|property\s*for\s*sale|homes?\s*for\s*rent|land\s*for\s*sale/i;

const LISTING_FOLDER_KEY_RE = /real[-_]?estate|mobile[-_]?home|product|wholesale|listing/i;

const LISTING_AGGREGATOR_HOST_RE =
  /(?:^|\.)facebook\.com$|(?:^|\.)craigslist\.org$|(?:^|\.)offerup\.com$|(?:^|\.)ebay\.com$|(?:^|\.)zillow\.com$|(?:^|\.)realtor\.com$|(?:^|\.)redfin\.com$|(?:^|\.)mhvillage\.com$/i;

function leadJobType(l) {
  if (l && l.jobType) return String(l.jobType).trim().toLowerCase();
  const src = String((l && l.source) || '').trim().toLowerCase();
  if (src === 'mobile_homes_search' || (l && l.sourceType) === 'mobile_home_listing') {
    return 'real_estate';
  }
  if (src === 'real_estate_search' || (l && l.sourceType) === 'real_estate') {
    return 'real_estate';
  }
  if (src === 'home_owners_search' || (l && l.sourceType) === 'home_owners') {
    return 'home_owners';
  }
  if (src === 'products_search' || (l && l.sourceType) === 'product_listing') {
    return 'products';
  }
  if (src === 'wholesale_search' || (l && l.sourceType) === 'wholesale_listing') {
    return 'wholesale';
  }
  if (src === 'maps_search' || (l && l.sourceType) === 'maps_business') {
    return 'maps_business';
  }
  if (LISTING_SOURCE_RE.test(src)) return 'real_estate';
  if (l && l.listing && typeof l.listing === 'object') return 'real_estate';
  if (l && l.realEstate && typeof l.realEstate === 'object') return 'real_estate';
  return '';
}

const NON_BUSINESS_JOB_TYPES = new Set(['real_estate', 'home_owners', 'products', 'wholesale']);

function isListingAggregatorUrl(url) {
  const raw = String(url || '').trim();
  if (!raw || raw === 'N/A' || raw === '—') return false;
  try {
    const u = new URL(raw.includes('://') ? raw : `https://${raw}`);
    const host = u.hostname.replace(/^www\./i, '').toLowerCase();
    return LISTING_AGGREGATOR_HOST_RE.test(host);
  } catch {
    return LISTING_AGGREGATOR_HOST_RE.test(raw.toLowerCase());
  }
}

/** Heuristic for legacy imports missing jobType (e.g. CL:/FB: craigslist scrapes). */
function looksLikeListingPipelineLead(l) {
  if (!l || typeof l !== 'object') return false;

  const folderKey = String(l.folderKey || '').trim().toLowerCase();
  if (folderKey && LISTING_FOLDER_KEY_RE.test(folderKey)) return true;

  const src = String(l.source || '').trim();
  if (LISTING_SOURCE_RE.test(src)) return true;

  const sourceChannel = String(l.sourceChannel || '').trim();
  if (LISTING_SOURCE_RE.test(sourceChannel)) return true;

  const title = String(l.title || l.company || '').trim();
  if (LISTING_TITLE_PREFIX_RE.test(title)) return true;
  if (LISTING_TITLE_BODY_RE.test(title) && LISTING_TITLE_PRICE_HOME_RE.test(title)) return true;
  if (/\bhome for (sale|rent)\b/i.test(title)) return true;
  if (/\b(mobile|manufactured) home (for )?(sale|rent)\b/i.test(title)) return true;

  const category = String(l.categoryName || l.category || '').trim();
  if (category && LISTING_CATEGORY_RE.test(category)) return true;

  if (isListingAggregatorUrl(l.website) || isListingAggregatorUrl(l.url)) return true;

  return false;
}

/** Maps / manual / CSV business leads — excludes listings, products, and real estate. */
function isBusinessPipelineLead(l) {
  if (NON_BUSINESS_JOB_TYPES.has(leadJobType(l))) return false;
  if (looksLikeListingPipelineLead(l)) return false;
  return true;
}

function filterBusinessPipelineLeads(leads) {
  return (Array.isArray(leads) ? leads : []).filter(isBusinessPipelineLead);
}

function matchesJobTypeFilter(l, origin) {
  const want = String(origin || '').trim().toLowerCase();
  if (!want || want === 'all') return true;
  const jt = leadJobType(l);
  if (want === 'maps_business' || want === 'maps' || want === 'business') {
    return jt === 'maps_business' || (isSearchedSource(l) && !jt);
  }
  if (want === 'mobile_homes' || want === 'mobile') return jt === 'real_estate';
  if (want === 'real_estate' || want === 'realestate' || want === 'zillow') {
    return jt === 'real_estate';
  }
  if (want === 'home_owners' || want === 'homeowners') return jt === 'home_owners';
  if (want === 'products' || want === 'product') return jt === 'products';
  if (want === 'wholesale') return jt === 'wholesale';
  return true;
}

/** Lead is bucketed into an outreach folder (not shown on main pipeline / working queue). */
function isInOutreachFolder(l) {
  return Boolean(String(l.folderKey || '').trim());
}

function hasUsableContactEmail(l) {
  const e = String(l.email || '').trim();
  return e.length > 0 && e !== 'N/A' && e.includes('@');
}

function hasUsableWebsite(l) {
  const w = String(l.website || '').trim();
  return w.length > 0 && w !== 'N/A' && w !== '—';
}

function hasUsableContactPhone(l) {
  const p = String(l.phone || '').trim();
  return p.length > 0 && p !== 'N/A' && /\d/.test(p);
}

function hasUsableSocialLink(l) {
  const check = (v) => {
    const s = String(v || '').trim();
    return s.length > 3 && s !== 'N/A' && !/^none$/i.test(s);
  };
  return check(l.facebook) || check(l.instagram) || check(l.twitter) || check(l.linkedin);
}

function hasMailableStreetAddress(l) {
  const address = String(l.address || '').trim();
  if (!address || address === 'N/A' || address.length < 5) return false;
  const city = String(l.city || '').trim();
  const state = String(l.state || '').trim();
  if (!city || !state) return false;
  const zip =
    String(l.postalCode || l.zip || '').trim() ||
    ((address.match(/\b(\d{5})(?:-\d{4})?\b/) || [])[1] || '');
  return !!zip;
}

function matchesReachFilter(l, reach) {
  const mode = String(reach || '').trim().toLowerCase();
  if (!mode || mode === 'all') return true;
  if (mode === 'email') return hasUsableContactEmail(l);
  if (mode === 'phone' || mode === 'call') return hasUsableContactPhone(l);
  if (mode === 'double_tap' || mode === 'doubletap') {
    return hasUsableContactEmail(l) && hasUsableContactPhone(l) && hasUsableSocialLink(l);
  }
  if (mode === 'direct_mail' || mode === 'directmail' || mode === 'mail') {
    return hasMailableStreetAddress(l);
  }
  return true;
}

function excludeOutreachFolderLeads(leads) {
  return leads.filter((l) => !isInOutreachFolder(l));
}

const SEARCH_TEXT_MAX_DEPTH = 8;

function appendSearchText(parts, value, depth, seen) {
  if (value == null) return;
  const d = depth || 0;
  if (d > SEARCH_TEXT_MAX_DEPTH) return;
  if (Array.isArray(value)) {
    value.forEach((item) => appendSearchText(parts, item, d + 1, seen));
    return;
  }
  if (typeof value === 'object') {
    const visited = seen || new WeakSet();
    if (visited.has(value)) return;
    visited.add(value);
    Object.values(value).forEach((item) => appendSearchText(parts, item, d + 1, visited));
    return;
  }
  const text = String(value).trim();
  if (text) parts.push(text);
}

function leadActivitySearchParts(lead) {
  const parts = [];
  const updates = Array.isArray(lead && lead.updates) ? lead.updates : [];
  updates.forEach((entry) => {
    appendSearchText(parts, noteEntryBody(entry));
    appendSearchText(parts, entry && entry.message);
    appendSearchText(parts, entry && entry.disposition);
    appendSearchText(parts, entry && entry.channel);
    appendSearchText(parts, entry && entry.statusChange);
    appendSearchText(parts, entry && entry.type);
  });
  const logs = Array.isArray(lead && lead.logs) ? lead.logs : [];
  logs.forEach((entry) => {
    appendSearchText(parts, entry && entry.message);
    appendSearchText(parts, entry && entry.disposition);
    appendSearchText(parts, entry && entry.channel);
    appendSearchText(parts, entry && entry.type);
    appendSearchText(parts, entry && entry.note);
  });
  return parts;
}

function leadContactSearchParts(lead) {
  const parts = [];
  const contacts = Array.isArray(lead && lead.contacts) ? lead.contacts : [];
  contacts.forEach((contact) => {
    if (!contact || typeof contact !== 'object') return;
    appendSearchText(parts, contact.name);
    appendSearchText(parts, contact.email);
    appendSearchText(parts, contact.phone);
    appendSearchText(parts, contact.title);
    appendSearchText(parts, contact.role);
  });
  return parts;
}

function leadTagSearchParts(lead, ctx) {
  const parts = [];
  const tags = Array.isArray(lead && lead.tags) ? lead.tags : [];
  const tagNameByKey =
    ctx && ctx.tagNameByKey instanceof Map ? ctx.tagNameByKey : null;
  tags.forEach((tagKey) => {
    const key = String(tagKey || '').trim();
    if (!key) return;
    parts.push(key);
    if (tagNameByKey && tagNameByKey.has(key)) {
      parts.push(tagNameByKey.get(key));
    }
  });
  appendSearchText(parts, lead && lead.ghlTagNamesForPush);
  appendSearchText(parts, lead && lead.ghlActionTags);
  return parts;
}

/** Build tag/folder lookup maps once per search request. */
function buildLeadSearchContext(tags, folders, options) {
  const tagNameByKey = new Map();
  (tags || []).forEach((tag) => {
    if (!tag || !tag.key) return;
    tagNameByKey.set(String(tag.key), String(tag.name || tag.key));
  });
  const folderNameByKey = new Map();
  (folders || []).forEach((folder) => {
    if (!folder || !folder.key) return;
    folderNameByKey.set(String(folder.key), String(folder.name || folder.key));
  });
  const lowReviewsThreshold = getLowReviewsThresholdFromWorkspace(
    options && options.workspace ? options.workspace : null,
  );
  return { tagNameByKey, folderNameByKey, lowReviewsThreshold };
}

function buildLeadSearchHaystack(l, ctx) {
  if (!l || typeof l !== 'object') return '';
  const folderKey = String(l.folderKey || '').trim();
  const folderNameByKey =
    ctx && ctx.folderNameByKey instanceof Map ? ctx.folderNameByKey : null;
  const parts = [
    l.key,
    l.title,
    l.email,
    l.phone,
    l.website,
    l.address,
    l.city,
    l.state,
    l.zip,
    l.postalCode,
    l.categoryName,
    l.category,
    l.industry,
    l.sourceChannel,
    l.source,
    l.companyDomain,
    l.url,
    l.status,
    displayStatus(l.status),
    l.lastDisposition,
    quickLogLabelForDisposition(l.lastDisposition),
    (() => {
      const statusItem = quickLogItemForStatus(l.status);
      return statusItem ? statusItem.label : '';
    })(),
    l.assignedTo,
    l.pipelineStage,
    l.stageId,
    l.ghlContactId,
    l.importFilename,
    l.auditSummary,
    l.reviewIntel,
    l.facebook,
    l.instagram,
    l.linkedin,
    l.twitter,
    l.yelp,
    l.tiktok,
    folderKey,
    folderNameByKey && folderKey ? folderNameByKey.get(folderKey) : '',
    ...leadTagSearchParts(l, ctx),
    ...leadContactSearchParts(l),
    ...leadActivitySearchParts(l),
  ];
  appendSearchText(parts, l.importFields);
  appendSearchText(parts, l.cqi);
  appendSearchText(parts, l.buyingSignals);
  appendSearchText(parts, l.reviewSnippets);
  appendSearchText(parts, l.chatHistory);
  return parts
    .map((v) => String(v || '').trim())
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function normalizeSearchTokens(q) {
  return String(q || '')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

function leadMatchesSearchQuery(l, q, ctx) {
  const tokens = normalizeSearchTokens(q);
  if (!tokens.length) return true;
  const haystack = buildLeadSearchHaystack(l, ctx);
  return tokens.every((token) => haystack.includes(token));
}

function scoreLeadSearchMatch(l, q, ctx) {
  const tokens = normalizeSearchTokens(q);
  const needle = tokens.join(' ').trim();
  if (!needle) return 99;
  const title = String((l && l.title) || '').trim().toLowerCase();
  if (title.startsWith(needle)) return 0;
  if (title.includes(needle)) return 1;
  const phone = String((l && l.phone) || '').replace(/\D/g, '');
  const needleDigits = needle.replace(/\D/g, '');
  if (needleDigits.length >= 7 && phone.includes(needleDigits)) return 2;
  const tagHay = leadTagSearchParts(l, ctx)
    .map((v) => String(v || '').trim().toLowerCase())
    .join(' ');
  if (tagHay && tokens.every((token) => tagHay.includes(token))) return 3;
  const noteHay = leadActivitySearchParts(l)
    .map((v) => String(v || '').trim().toLowerCase())
    .join(' ');
  if (noteHay && tokens.every((token) => noteHay.includes(token))) return 4;
  return 5;
}

function applyLeadListFilters(leads, filters) {
  let out = leads;
  const q = String(filters.q || '').trim();
  const searchContext = filters.searchContext || null;
  if (q) {
    out = out.filter((l) => leadMatchesSearchQuery(l, q, searchContext));
  }
  const stage = String(filters.stage || '').trim();
  if (stage) {
    if (stage.includes('-') && stage.length >= 32) {
      out = out.filter((l) => String(l.stageId || '').trim() === stage);
    } else {
      const st = parseInt(stage, 10);
      if (!Number.isNaN(st)) out = out.filter((l) => parseInt(l.pipelineStage, 10) === st);
    }
  }
  const folderKey = String(filters.folderKey || '').trim();
  if (folderKey) {
    const keySet =
      filters.folderKeys instanceof Set ? filters.folderKeys : new Set([folderKey]);
    out = out.filter((l) => keySet.has(String(l.folderKey || '').trim()));
  }
  const tagKey = String(filters.tagKey || '').trim();
  if (tagKey) {
    if (isQuickLogFilterTagKey(tagKey)) {
      out = out.filter((l) => leadMatchesQuickLogFilter(l, tagKey));
    } else {
      out = out.filter((l) => {
        const tags = Array.isArray(l.tags) ? l.tags : [];
        return tags.some((t) => String(t) === tagKey);
      });
    }
  } else if (filters.excludeFolderAssigned) {
    out = excludeOutreachFolderLeads(out);
  }

  const statusRaw = String(filters.status || '').trim();
  if (statusRaw && statusRaw.toLowerCase() !== 'all') {
    const want = statusRaw.toLowerCase();
    out = out.filter((l) => displayStatus(l.status).toLowerCase() === want);
  }

  const category = String(filters.category || '').trim();
  if (category && category.toLowerCase() !== 'all') {
    out = out.filter((l) => leadMatchesCategoryFilter(l, category));
  }

  const minRating = parseFloat(filters.minRating);
  if (!Number.isNaN(minRating) && minRating > 0) {
    out = out.filter((l) => parseFloat(l.totalScore) >= minRating);
  }
  const minReviews = parseInt(filters.minReviews, 10);
  if (!Number.isNaN(minReviews) && minReviews > 0) {
    out = out.filter((l) => parseInt(l.reviewsCount, 10) >= minReviews);
  }
  const maxReviews = parseInt(filters.maxReviews, 10);
  if (!Number.isNaN(maxReviews) && maxReviews >= 0) {
    out = out.filter((l) => {
      const n = parseInt(l.reviewsCount, 10);
      const count = Number.isNaN(n) ? 0 : n;
      return count <= maxReviews;
    });
  }

  const bookmarkedRaw = String(filters.bookmarked || '').trim().toLowerCase();
  if (bookmarkedRaw === '1' || bookmarkedRaw === 'true' || bookmarkedRaw === 'yes') {
    out = out.filter((l) => !!l.bookmarked);
  }

  const origin = String(filters.origin || '').trim().toLowerCase();
  if (origin && origin !== 'all') {
    if (origin === 'csv' || origin === 'imported' || origin === 'csv_import') {
      out = out.filter(isCsvImported);
    } else if (origin === 'search' || origin === 'searched') {
      out = out.filter(isSearchedSource);
    } else if (origin === 'maps' || origin === 'maps_business' || origin === 'business') {
      out = out.filter((l) => matchesJobTypeFilter(l, 'maps_business'));
    } else if (origin === 'mobile_homes' || origin === 'mobile') {
      out = out.filter((l) => matchesJobTypeFilter(l, 'real_estate'));
    } else if (origin === 'real_estate' || origin === 'realestate' || origin === 'zillow') {
      out = out.filter((l) => matchesJobTypeFilter(l, 'real_estate'));
    } else if (origin === 'home_owners' || origin === 'homeowners') {
      out = out.filter((l) => matchesJobTypeFilter(l, 'home_owners'));
    } else if (origin === 'products' || origin === 'product') {
      out = out.filter((l) => matchesJobTypeFilter(l, 'products'));
    } else if (origin === 'wholesale') {
      out = out.filter((l) => matchesJobTypeFilter(l, 'wholesale'));
    } else if (origin === 'manual') {
      out = out.filter(isManualSource);
    } else if (origin === 'warm') {
      out = out.filter(isWarmSource);
    }
  }

  const addedFrom = String(filters.addedFrom || '').trim();
  const addedTo = String(filters.addedTo || '').trim();
  const fromMs = localDayStartMs(addedFrom);
  const toMs = localDayEndMs(addedTo);
  if (fromMs != null) {
    out = out.filter((l) => {
      const t = leadCreatedMs(l);
      return t != null && t >= fromMs;
    });
  }
  if (toMs != null) {
    out = out.filter((l) => {
      const t = leadCreatedMs(l);
      return t != null && t <= toMs;
    });
  }

  const reach = String(filters.reach || '').trim();
  if (reach) {
    out = out.filter((l) => matchesReachFilter(l, reach));
  }

  return out;
}

function mapLeadListJson(l) {
  return {
    key: l.key,
    title: l.title,
    email: l.email,
    phone: l.phone,
    website: l.website,
    city: l.city,
    state: l.state,
    pipelineStage: l.pipelineStage,
    status: l.status,
    folderKey: l.folderKey || '',
    tags: Array.isArray(l.tags) ? l.tags : [],
    source: l.source || '',
    jobType: l.jobType || leadJobType(l) || '',
    sourceType: l.sourceType || '',
    reviewsCount: l.reviewsCount ?? 0,
    totalScore: l.totalScore ?? 0,
  };
}

/** Slim client bootstrap — omits heavy audit/chat blobs and activity arrays (loaded via panel-data on demand). */
function mapLeadPipelineBootstrap(l) {
  return {
    key: l.key,
    title: l.title,
    email: l.email,
    phone: l.phone,
    website: l.website,
    address: l.address,
    city: l.city,
    state: l.state,
    categoryName: l.categoryName,
    url: l.url,
    facebook: l.facebook,
    instagram: l.instagram,
    twitter: l.twitter,
    pipelineStage: l.pipelineStage,
    stageId: l.stageId,
    onPipelineBoard: !!l.onPipelineBoard,
    status: l.status,
    folderKey: l.folderKey || '',
    tags: Array.isArray(l.tags) ? l.tags : [],
    source: l.source || '',
    jobType: l.jobType || leadJobType(l) || '',
    sourceType: l.sourceType || '',
    reviewsCount: l.reviewsCount ?? 0,
    totalScore: l.totalScore ?? 0,
    contacts: Array.isArray(l.contacts) ? l.contacts : [],
    buyingSignals: Array.isArray(l.buyingSignals) ? l.buyingSignals : [],
    aiWebsiteAnalysisScore: l.aiWebsiteAnalysisScore,
    ownerSignal: l.ownerSignal,
    sequenceState: l.sequenceState,
    lastTouchChannel: l.lastTouchChannel,
    engagementSignalType:
      (l.engagementSignals && l.engagementSignals.lastSignalType) || '',
    engagementSignalAt:
      (l.engagementSignals && l.engagementSignals.lastSignalAt) || '',
    latitude: l.latitude,
    longitude: l.longitude,
    leadLocations: Array.isArray(l.leadLocations) ? l.leadLocations : [],
    alternateTitles: Array.isArray(l.alternateTitles) ? l.alternateTitles : [],
    bookmarked: !!l.bookmarked,
  };
}

/** Query keys used by GET /leads and /leads/list.json (excluding cold/inbound `source` tab). */
const LEAD_LIST_FILTER_KEYS = [
  'q',
  'stage',
  'status',
  'category',
  'minRating',
  'minReviews',
  'maxReviews',
  'bookmarked',
  'origin',
  'addedFrom',
  'addedTo',
  'folderKey',
  'tagKey',
  'reach',
];

function normalizeLeadListFilters(query) {
  const q = query || {};
  const out = {};
  LEAD_LIST_FILTER_KEYS.forEach((k) => {
    const v = q[k];
    if (v != null && String(v).trim() !== '') out[k] = String(v).trim();
  });
  return out;
}

function leadListFilterQuerySuffix(filtersObj) {
  const u = new URLSearchParams();
  Object.entries(filtersObj || {}).forEach(([k, v]) => {
    if (v != null && String(v).trim() !== '') u.set(k, String(v).trim());
  });
  const s = u.toString();
  return s ? `&${s}` : '';
}

module.exports = {
  displayStatus,
  applyLeadListFilters,
  mapLeadListJson,
  mapLeadPipelineBootstrap,
  isInOutreachFolder,
  excludeOutreachFolderLeads,
  isWarmSource,
  isManualSource,
  isCsvImported,
  isSearchedSource,
  leadJobType,
  isBusinessPipelineLead,
  filterBusinessPipelineLeads,
  matchesJobTypeFilter,
  hasUsableContactEmail,
  hasUsableWebsite,
  hasUsableContactPhone,
  hasUsableSocialLink,
  matchesReachFilter,
  LEAD_LIST_FILTER_KEYS,
  normalizeLeadListFilters,
  leadListFilterQuerySuffix,
  buildLeadSearchHaystack,
  buildLeadSearchContext,
  leadMatchesSearchQuery,
  scoreLeadSearchMatch,
  normalizeSearchTokens,
  leadCategoryLabel,
  buildPipelineCategoryOptions,
  leadMatchesCategoryFilter,
};
