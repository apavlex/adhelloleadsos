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
  return s === 'csv_import' || s === 'google_drive';
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

/** Lead is bucketed into an outreach folder (not shown on main pipeline / working queue). */
function isInOutreachFolder(l) {
  return Boolean(String(l.folderKey || '').trim());
}

function hasUsableContactEmail(l) {
  const e = String(l.email || '').trim();
  return e.length > 0 && e !== 'N/A' && e.includes('@');
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

function matchesReachFilter(l, reach) {
  const mode = String(reach || '').trim().toLowerCase();
  if (!mode || mode === 'all') return true;
  if (mode === 'email') return hasUsableContactEmail(l);
  if (mode === 'phone' || mode === 'call') return hasUsableContactPhone(l);
  if (mode === 'double_tap' || mode === 'doubletap') {
    return hasUsableContactEmail(l) && hasUsableContactPhone(l) && hasUsableSocialLink(l);
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
    out = out.filter((l) => String(l.folderKey || '') === folderKey);
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
    } else if (origin === 'search' || origin === 'searched' || origin === 'maps') {
      out = out.filter(isSearchedSource);
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
    reviewsCount: l.reviewsCount ?? 0,
    totalScore: l.totalScore ?? 0,
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
  isInOutreachFolder,
  excludeOutreachFolderLeads,
  hasUsableContactEmail,
  hasUsableContactPhone,
  hasUsableSocialLink,
  matchesReachFilter,
  LEAD_LIST_FILTER_KEYS,
  normalizeLeadListFilters,
  leadListFilterQuerySuffix,
};
