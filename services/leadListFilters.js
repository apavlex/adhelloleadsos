/**
 * Shared filtering for outreach queue / folders fetch and pipeline GET filters.
 */

function displayStatus(s) {
  const raw = s || 'Not Contacted';
  return raw === 'Needs Video' ? 'Not Contacted' : raw;
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

function applyLeadListFilters(leads, filters) {
  let out = leads;
  const q = String(filters.q || '').trim().toLowerCase();
  if (q) {
    out = out.filter((l) => {
      const blob = `${l.title || ''} ${l.email || ''} ${l.phone || ''} ${l.website || ''} ${l.city || ''} ${l.state || ''}`.toLowerCase();
      return blob.includes(q);
    });
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
    out = out.filter((l) => {
      const tags = Array.isArray(l.tags) ? l.tags : [];
      return tags.some((t) => String(t) === tagKey);
    });
  } else if (filters.excludeFolderAssigned) {
    out = excludeOutreachFolderLeads(out);
  }

  const statusRaw = String(filters.status || '').trim();
  if (statusRaw && statusRaw.toLowerCase() !== 'all') {
    const want = statusRaw.toLowerCase();
    out = out.filter((l) => displayStatus(l.status).toLowerCase() === want);
  }

  const minRating = parseFloat(filters.minRating);
  if (!Number.isNaN(minRating) && minRating > 0) {
    out = out.filter((l) => parseFloat(l.totalScore) >= minRating);
  }
  const minReviews = parseInt(filters.minReviews, 10);
  if (!Number.isNaN(minReviews) && minReviews > 0) {
    out = out.filter((l) => parseInt(l.reviewsCount, 10) >= minReviews);
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

/** Slim client bootstrap — omits heavy audit/chat blobs (loaded via panel-data on demand). */
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
    latitude: l.latitude,
    longitude: l.longitude,
  };
}

/** Query keys used by GET /leads and /leads/list.json (excluding cold/inbound `source` tab). */
const LEAD_LIST_FILTER_KEYS = [
  'q',
  'stage',
  'status',
  'minRating',
  'minReviews',
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
};
