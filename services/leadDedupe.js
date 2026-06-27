/**
 * Lead identity normalization and duplicate detection for ingest paths.
 */

function normalizeEmail(email) {
  if (!email || email === 'N/A') return '';
  return String(email).trim().toLowerCase();
}

const AGGREGATOR_LISTING_HOST_RE =
  /(?:^|\.)facebook\.com$|(?:^|\.)craigslist\.org$|(?:^|\.)offerup\.com$|(?:^|\.)ebay\.com$|(?:^|\.)zillow\.com$|(?:^|\.)realtor\.com$|(?:^|\.)redfin\.com$|(?:^|\.)mhvillage\.com$/i;

function normalizeDomain(website) {
  if (!website || website === 'N/A') return '';
  const raw = String(website).trim();
  if (!raw) return '';
  try {
    const u = new URL(raw.includes('://') ? raw : `https://${raw}`);
    const host = u.hostname.replace(/^www\./i, '').toLowerCase();
    if (AGGREGATOR_LISTING_HOST_RE.test(host)) {
      const path = (u.pathname || '/').replace(/\/+$/, '') || '/';
      return `${host}${path}`.toLowerCase();
    }
    return host;
  } catch {
    let s = raw.replace(/^https?:\/\//i, '').replace(/^www\./i, '');
    s = s.split(/[/?#]/)[0] || '';
    return s.trim().toLowerCase();
  }
}

function normalizePhone(phone) {
  if (!phone || phone === 'N/A') return '';
  const digits = String(phone).replace(/\D+/g, '');
  if (!digits) return '';
  return digits.length > 10 ? digits.slice(-10) : digits;
}

function normalizeName(name) {
  if (!name) return '';
  return String(name)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\b(llc|inc|corp|co|company|ltd|pllc|pc|group|studio)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeGeo(city, state) {
  const c = city ? String(city).trim().toLowerCase() : '';
  const st = state ? String(state).trim().toLowerCase() : '';
  if (!c || !st) return '';
  return `${c}|${st}`;
}

function normalizeGoogleMapsPlaceKey(rawUrl) {
  const s = String(rawUrl || '').trim();
  if (!s) return '';
  if (!/google\.com\/maps|maps\.app\.goo\.gl|goo\.gl\/maps|maps\.google\.com/i.test(s)) {
    return '';
  }

  const chij = s.match(/(ChIJ[A-Za-z0-9_-]{20,})/);
  if (chij) return `gmaps:chij:${chij[1]}`;

  const gid = s.match(/\/g\/([A-Za-z0-9_-]+)/i) || s.match(/%2Fg%2F([A-Za-z0-9_-]+)/i);
  if (gid) return `gmaps:gid:${gid[1]}`;

  const hex = s.match(/1s(0x[a-f0-9]+:0x[a-f0-9]+)/i);
  if (hex) return `gmaps:hex:${hex[1].toLowerCase()}`;

  try {
    const u = new URL(s.includes('://') ? s : `https://${s}`);
    const decoded = decodeURIComponent(`${u.pathname}${u.search}`).toLowerCase();
    const place = decoded.match(/\/maps\/place\/([^/?]+)/);
    if (place) {
      return `gmaps:name:${place[1].replace(/\+/g, ' ').slice(0, 160)}`;
    }
  } catch {
    /* ignore */
  }
  return '';
}

function leadMapsPlaceKey(lead) {
  const direct = normalizeGoogleMapsPlaceKey(lead?.url);
  if (direct) return direct;
  const importUrl =
    lead?.importFields &&
    (lead.importFields.google_maps_url ||
      lead.importFields.maps_url ||
      lead.importFields.gbp_url ||
      lead.importFields.place_url);
  return normalizeGoogleMapsPlaceKey(importUrl);
}

function computeDedupeKey(lead) {
  const maps = leadMapsPlaceKey(lead);
  if (maps) return maps;

  const em = normalizeEmail(lead?.email);
  if (em) return `email:${em}`;

  const dom = normalizeDomain(lead?.website);
  if (dom) return `domain:${dom}`;

  const ph = normalizePhone(lead?.phone);
  if (ph) return `phone:${ph}`;

  const nm = normalizeName(lead?.title);
  const geo = normalizeGeo(lead?.city, lead?.state);
  if (nm && geo) return `namegeo:${nm}|${geo}`;

  if (nm && ph) return `namephone:${nm}|${ph}`;

  return '';
}

function sameWorkspace(lead, workspaceId) {
  return (lead?.workspaceId || 'default') === (workspaceId || 'default');
}

/**
 * Find an existing lead in the workspace that matches incoming ingest data.
 * @param {object[]} leads
 * @param {object} incoming — normalized fields optional (emailNorm, etc.)
 * @param {string} workspaceId
 */
function findExistingLead(leads, incoming, workspaceId) {
  const wid = workspaceId || 'default';
  const list = (leads || []).filter((l) => l && sameWorkspace(l, wid));

  const mapsKey = leadMapsPlaceKey(incoming);
  const emailNorm = incoming.emailNorm || normalizeEmail(incoming.email);
  const domainNorm = incoming.domainNorm || normalizeDomain(incoming.website);
  const phoneNorm = incoming.phoneNorm || normalizePhone(incoming.phone);
  const nameNorm = incoming.nameNorm || normalizeName(incoming.title);
  const geoNorm = incoming.geoNorm || normalizeGeo(incoming.city, incoming.state);
  const dedupeKey = incoming.dedupeKey || computeDedupeKey(incoming);

  const findBy = (pred) => list.find(pred) || null;

  if (mapsKey) {
    const byMaps = findBy((l) => leadMapsPlaceKey(l) === mapsKey);
    if (byMaps) return byMaps;
  }

  if (emailNorm) {
    const byEmail = findBy((l) => normalizeEmail(l.email) === emailNorm);
    if (byEmail) return byEmail;
  }

  if (domainNorm) {
    const byDomain = findBy((l) => normalizeDomain(l.website) === domainNorm);
    if (byDomain) return byDomain;
  }

  if (phoneNorm) {
    const byPhone = findBy((l) => normalizePhone(l.phone) === phoneNorm);
    if (byPhone) return byPhone;
  }

  if (dedupeKey) {
    const byKey = findBy((l) => String(l.dedupeKey || '') === dedupeKey);
    if (byKey) return byKey;
  }

  if (nameNorm && geoNorm) {
    const byNameGeo = findBy(
      (l) => normalizeName(l.title) === nameNorm && normalizeGeo(l.city, l.state) === geoNorm
    );
    if (byNameGeo) return byNameGeo;
  }

  if (nameNorm && phoneNorm) {
    const byNamePhone = findBy(
      (l) => normalizeName(l.title) === nameNorm && normalizePhone(l.phone) === phoneNorm
    );
    if (byNamePhone) return byNamePhone;
  }

  if (incoming.ip) {
    const byIp = findBy((l) => l.ip === incoming.ip);
    if (byIp) return byIp;
  }

  return null;
}

function shouldResyncIngestSource(source) {
  const s = String(source || '').trim();
  return (
    s === 'chrome_extension' ||
    s === 'csv_import' ||
    s === 'autonomous' ||
    s === 'maps_search' ||
    s.endsWith('_search')
  );
}

/**
 * Whether an incoming lead save should move an already-foldered lead.
 * Single extension re-saves must not pull leads out of bulk/import folders.
 */
function shouldApplyIncomingFolderKey(existing, incoming) {
  const incomingFolder = incoming?.folderKey != null ? String(incoming.folderKey).trim() : '';
  if (!incomingFolder) return false;
  const existingFolder = existing ? String(existing.folderKey || '').trim() : '';
  if (!existingFolder) return true;
  if (incoming.forceFolderKey === true) return true;

  const importFilename = String(incoming?.importFilename || '').trim();
  if (importFilename) return true;

  const src = String(incoming?.source || '').trim();
  if (src === 'csv_import' || src === 'chrome_extension_maps_bulk') return true;

  return false;
}

function upsertLeadInMemoryList(list, lead) {
  if (!lead || !lead.key) return;
  const idx = (list || []).findIndex((l) => l && l.key === lead.key);
  if (idx >= 0) list[idx] = { ...list[idx], ...lead };
  else list.push(lead);
}

module.exports = {
  normalizeEmail,
  normalizeDomain,
  normalizePhone,
  normalizeName,
  normalizeGeo,
  normalizeGoogleMapsPlaceKey,
  leadMapsPlaceKey,
  computeDedupeKey,
  findExistingLead,
  shouldResyncIngestSource,
  shouldApplyIncomingFolderKey,
  upsertLeadInMemoryList,
};
