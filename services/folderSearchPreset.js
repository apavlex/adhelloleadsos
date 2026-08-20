/**
 * Saved search configuration on outreach folders — run Find with preset params.
 */

const { JOB_TYPES, JOB_TYPE_LABELS, normalizeJobType, isListingJobType } = require('./scrapeJobTypes');
const { parseFlipFilter, DEFAULT_FLIP_FILTER } = require('./listingFlipScore');
const listingSearch = require('./listingSearch');
const {
  findTabForJobType,
  defaultSourcesForJobType,
  configForJobType,
  jobTypeRequiresLocation,
} = require('./searchTypeConfig');
const { matchFolderToTrade, normalizeFolderName } = require('./folderTradeMatcher');
const { BY_SLUG } = require('./tradeFoldersCatalog');

const LAND_MODE_LABELS = {
  any: 'Any tenure',
  exclude_park: 'Exclude park / lot rent',
  prefer_own_land: 'Prefer land-owned',
  own_land_only: 'Own land only',
};

const MAPS_PROVIDER_LABELS = {
  auto: 'Auto (best available)',
  rapidapi: 'RapidAPI',
  searchapi: 'SearchAPI.io',
  serpapi: 'SerpAPI',
  oxylabs: 'Oxylabs',
  outscraper: 'Outscraper',
  monid: 'Monid (Google Maps)',
  apify: 'Apify',
};

const REAL_ESTATE_SCRAPER_LABELS = {
  apify_zillow: 'Apify Zillow',
  oxylabs: 'Oxylabs',
  auto: 'Auto (Apify → Oxylabs fallback)',
  listings: 'Multi-source listings',
};

function parseAutoTags(raw) {
  if (Array.isArray(raw)) {
    return raw.map((s) => String(s || '').trim()).filter(Boolean);
  }
  if (typeof raw === 'string' && raw.trim()) {
    return raw
      .split(/[,|]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

function normalizeMapsProvider(raw) {
  const v = String(raw || 'auto').toLowerCase().trim();
  return MAPS_PROVIDER_LABELS[v] ? v : 'auto';
}

function formatPriceRange(min, max) {
  const lo = min != null && min !== '' ? parseInt(min, 10) : null;
  const hi = max != null && max !== '' ? parseInt(max, 10) : null;
  const fmt = (n) => '$' + Number(n).toLocaleString('en-US');
  if (Number.isFinite(lo) && Number.isFinite(hi)) return `${fmt(lo)} – ${fmt(hi)}`;
  if (Number.isFinite(lo)) return `${fmt(lo)}+`;
  if (Number.isFinite(hi)) return `Up to ${fmt(hi)}`;
  return null;
}

function normalizeListingFields(raw, jobType) {
  const typeConfig = configForJobType(jobType);
  const out = {};
  out.query =
    String(raw.query || raw.keyword || typeConfig.defaultQuery || 'listings').trim() ||
    typeConfig.defaultQuery ||
    'listings';
  out.minPrice = raw.minPrice != null && raw.minPrice !== '' ? parseInt(raw.minPrice, 10) : null;
  out.maxPrice = raw.maxPrice != null && raw.maxPrice !== '' ? parseInt(raw.maxPrice, 10) : null;
  const hadExplicitSources =
    (Array.isArray(raw.sources) && raw.sources.length) ||
    (typeof raw.sources === 'string' && raw.sources.trim());
  const parsedSources = hadExplicitSources ? listingSearch.parseSourcesList(raw.sources) : [];
  out.sources = parsedSources.length ? parsedSources : defaultSourcesForJobType(jobType);

  if (jobType === JOB_TYPES.REAL_ESTATE) {
    const scraper = String(raw.scraper || 'listings').trim().toLowerCase();
    out.scraper = REAL_ESTATE_SCRAPER_LABELS[scraper] ? scraper : 'listings';
    const flip = parseFlipFilter({ flipFilter: raw.flipFilter || raw });
    out.flipFilter = flip.enabled
      ? {
          enabled: true,
          minFlipScore: flip.minFlipScore,
          minRoiPercent: flip.minRoiPercent,
          onlyUnique: flip.onlyUnique,
          landMode: flip.landMode,
          requireOwnLand: flip.requireOwnLand,
          excludeParkRent: flip.excludeParkRent,
          requireNoHoa: flip.requireNoHoa,
          requirePhrases: flip.requirePhrases,
          excludePhrases: flip.excludePhrases,
        }
      : null;
  }

  return out;
}

function normalizeLocationPart(city, state) {
  const loc = {
    city: String(city || '').trim(),
    state: String(state || '')
      .trim()
      .slice(0, 2)
      .toUpperCase(),
  };
  return loc;
}

function attachLocationFields(out, raw) {
  const loc = normalizeLocationPart(raw && raw.city, raw && raw.state);
  if (loc.city) out.city = loc.city;
  if (loc.state) out.state = loc.state;
  const lastSearchKey = String((raw && (raw.lastSearchKey || raw.lastSearchId)) || '').trim();
  if (lastSearchKey) out.lastSearchKey = lastSearchKey;
  return out;
}

function normalizeSearchPreset(raw, opts = {}) {
  if (!raw || typeof raw !== 'object') return null;
  const jobType = normalizeJobType(raw.jobType || JOB_TYPES.MAPS_BUSINESS);
  const out = {
    jobType,
    maxResults: Math.min(100, Math.max(1, parseInt(raw.maxResults, 10) || 25)),
  };

  if (isListingJobType(jobType)) {
    Object.assign(out, normalizeListingFields(raw, jobType));
  } else {
    const defaultKeyword = Object.prototype.hasOwnProperty.call(opts, 'defaultKeyword')
      ? opts.defaultKeyword
      : 'plumber';
    const keyword = String(raw.keyword || raw.query || defaultKeyword || '').trim();
    out.keyword = keyword || String(defaultKeyword || '').trim();
    out.mapsProvider = normalizeMapsProvider(raw.mapsProvider);
    out.directorySupplement = raw.directorySupplement !== false && raw.directorySupplement !== 'off';
    out.minRating =
      raw.minRating != null && raw.minRating !== '' ? parseFloat(raw.minRating) : null;
    out.minReviews =
      raw.minReviews != null && raw.minReviews !== '' ? parseInt(raw.minReviews, 10) : null;
    out.autoTags = parseAutoTags(raw.autoTags);
    out.searchNotes = String(raw.searchNotes || '').trim();
  }

  return attachLocationFields(out, raw);
}

function describeSearchPreset(preset) {
  const p = normalizeSearchPreset(preset);
  if (!p) return null;

  const rows = [{ label: 'Search type', value: JOB_TYPE_LABELS[p.jobType] || p.jobType }];
  rows.push({ label: 'Max results', value: String(p.maxResults) });

  if (isListingJobType(p.jobType)) {
    rows.push({ label: 'Search terms', value: p.query });
    const price = formatPriceRange(p.minPrice, p.maxPrice);
    if (price) rows.push({ label: 'Price range', value: price });
    if (p.sources && p.sources.length) {
      rows.push({
        label: 'Scrapers',
        value: p.sources.map((id) => listingSearch.sourceLabel(id)).join(', '),
      });
    }
    if (p.jobType === JOB_TYPES.REAL_ESTATE) {
      rows.push({
        label: 'Property scraper',
        value: REAL_ESTATE_SCRAPER_LABELS[p.scraper] || REAL_ESTATE_SCRAPER_LABELS.listings,
      });
      if (p.flipFilter && p.flipFilter.enabled) {
        rows.push({ label: 'Flip filter', value: 'On — AI scoring enabled' });
        rows.push({
          label: 'Min flip score / ROI',
          value: `${p.flipFilter.minFlipScore} / ${p.flipFilter.minRoiPercent}%`,
        });
        if (p.flipFilter.landMode) {
          rows.push({
            label: 'Land mode',
            value: LAND_MODE_LABELS[p.flipFilter.landMode] || p.flipFilter.landMode,
          });
        }
      } else {
        rows.push({ label: 'Flip filter', value: 'Off' });
      }
    }
    const hint = configForJobType(p.jobType).scraperHint;
    if (hint) rows.push({ label: 'Recommended scrapers', value: hint });
  } else {
    rows.push({ label: 'Business keyword', value: p.keyword });
    rows.push({
      label: 'Maps scraper',
      value: MAPS_PROVIDER_LABELS[p.mapsProvider] || MAPS_PROVIDER_LABELS.auto,
    });
    if (p.minRating != null) rows.push({ label: 'Min rating', value: String(p.minRating) });
    if (p.minReviews != null) rows.push({ label: 'Min reviews', value: String(p.minReviews) });
    if (p.autoTags && p.autoTags.length) {
      rows.push({ label: 'Auto tags', value: p.autoTags.join(', ') });
    }
    if (p.searchNotes) rows.push({ label: 'Custom criteria', value: p.searchNotes });
    rows.push({
      label: 'Directory supplement',
      value: p.directorySupplement ? 'Yelp, Angi, YP, Zillow agents, BBB' : 'Off',
    });
  }

  if (p.city || p.state) {
    rows.push({ label: 'Area', value: [p.city, p.state].filter(Boolean).join(', ') });
  }

  return {
    jobType: p.jobType,
    typeLabel: JOB_TYPE_LABELS[p.jobType] || p.jobType,
    rows,
    preset: p,
  };
}

function searchPresetToFindContext(preset) {
  const p = normalizeSearchPreset(preset);
  if (!p) return null;

  return {
    searchType: findTabForJobType(p.jobType),
    searchPrefill: {
      keyword: p.keyword || p.query || '',
      city: p.city || '',
      state: p.state || '',
      qty: p.maxResults,
    },
    searchPreset: p,
  };
}

function parseSearchPresetFromForm(body) {
  const jobType = normalizeJobType(body.jobType);
  const raw = {
    jobType,
    maxResults: body.maxResults,
    city: body.city,
    state: body.state,
  };

  if (isListingJobType(jobType)) {
    raw.query = body.query;
    raw.minPrice = body.minPrice;
    raw.maxPrice = body.maxPrice;
    raw.sources = listingSearch.parseSourcesFromBody(body);
    if (jobType === JOB_TYPES.REAL_ESTATE) {
      raw.scraper = body.scraper || body.realEstateScraper || 'listings';
      raw.flipFilter = parseFlipFilter(body);
    }
  } else {
    raw.keyword = body.keyword || body.query;
    raw.mapsProvider = body.mapsProvider;
    raw.directorySupplement = String(body.directorySupplement || '').toLowerCase() === 'on';
    raw.minRating = body.minRating;
    raw.minReviews = body.minReviews;
    raw.autoTags = body.autoTags;
    raw.searchNotes = body.searchNotes;
  }

  return normalizeSearchPreset(raw);
}

function schedulePayloadFromFolder(folder, location = {}) {
  const preset = normalizeSearchPreset(folder && folder.searchPreset);
  if (!preset) return null;

  const loc = normalizeLocationPart(location.city || preset.city, location.state || preset.state);
  const base = {
    jobType: preset.jobType,
    city: loc.city,
    state: loc.state,
    maxResults: preset.maxResults,
    targetFolderKey: folder.key,
    targetFolderName: folder.name,
  };

  if (isListingJobType(preset.jobType)) {
    const payload = {
      ...base,
      query: preset.query,
      sources: preset.sources,
      minPrice: preset.minPrice,
      maxPrice: preset.maxPrice,
    };
    if (preset.jobType === JOB_TYPES.REAL_ESTATE) {
      payload.flipFilter = preset.flipFilter;
      payload.scraper = preset.scraper;
    }
    return payload;
  }

  return {
    ...base,
    keyword: preset.keyword,
    mapsProvider: preset.mapsProvider,
    directorySupplement: preset.directorySupplement,
    minRating: preset.minRating,
    minReviews: preset.minReviews,
    autoTags: preset.autoTags,
    searchNotes: preset.searchNotes,
  };
}

async function resolveAutoTagKeys(workspaceId, autoTags) {
  const labels = parseAutoTags(autoTags);
  if (!labels.length) return [];
  const dbService = require('./database');
  const catalog = await dbService.listTags(workspaceId || 'default');
  const byName = new Map(
    (catalog || []).map((t) => [String(t.name || '').trim().toLowerCase(), t.key])
  );
  const keys = [];
  for (const label of labels) {
    const key = byName.get(String(label).trim().toLowerCase());
    if (key) keys.push(key);
  }
  return [...new Set(keys)];
}

const GENERIC_FOLDER_KEYWORDS = new Set([
  'businesses',
  'business',
  'real estate',
  'home owners',
  'products',
  'wholesale',
  'permits',
  'new formations',
  'mobile homes',
]);

function keywordFromFolderName(name) {
  const cleaned = normalizeFolderName(name);
  if (!cleaned) return '';
  const stripped = cleaned
    .replace(
      /\b(companies|company|contractors|contractor|businesses|business|leads|lead|folder|clients|prospects)\b/gi,
      ' '
    )
    .replace(/\s+/g, ' ')
    .trim();
  const candidate = stripped || cleaned;
  if (GENERIC_FOLDER_KEYWORDS.has(candidate.toLowerCase())) return '';
  return candidate;
}

function inferKeywordForFolder(folder) {
  if (!folder) return '';
  const slug = String(folder.tradeSlug || '').trim();
  if (slug && BY_SLUG[slug] && BY_SLUG[slug].keyword) return BY_SLUG[slug].keyword;
  const match = matchFolderToTrade(folder.name);
  if (match && match.trade && match.trade.keyword) return match.trade.keyword;
  return keywordFromFolderName(folder.name);
}

function firstNonEmpty(...vals) {
  for (const v of vals) {
    const s = String(v == null ? '' : v).trim();
    if (s) return s;
  }
  return '';
}

/**
 * Child folder keyword/query wins. Parent SEARCH SETUP fills scraper/filters/location.
 * Never silently default Maps keyword to "plumber".
 */
function resolveEffectiveSearchPreset(folder, ctx = {}) {
  const parent = ctx.parent || null;
  const lastSearch = ctx.lastSearch || null;
  const icp = ctx.icp || {};
  const sampleLocation = ctx.sampleLocation || {};

  const ownRaw = folder && folder.searchPreset && typeof folder.searchPreset === 'object' ? folder.searchPreset : null;
  const inheritedRaw =
    parent && parent.searchPreset && typeof parent.searchPreset === 'object' ? parent.searchPreset : null;
  const jobType = normalizeJobType(
    (ownRaw && ownRaw.jobType) ||
      (folder && folder.jobType) ||
      (inheritedRaw && inheritedRaw.jobType) ||
      JOB_TYPES.MAPS_BUSINESS
  );
  const own = normalizeSearchPreset(ownRaw ? { ...ownRaw, jobType } : { jobType }, { defaultKeyword: '' });
  const inherited = normalizeSearchPreset(
    inheritedRaw ? { ...inheritedRaw, jobType: inheritedRaw.jobType || jobType } : null,
    { defaultKeyword: '' }
  );

  const merged = {
    jobType,
    maxResults:
      (ownRaw && ownRaw.maxResults) ||
      (own && own.maxResults) ||
      (inherited && inherited.maxResults) ||
      25,
  };

  const city = firstNonEmpty(
    own && own.city,
    inherited && inherited.city,
    lastSearch && lastSearch.city,
    sampleLocation.city,
    icp.city
  );
  const state = firstNonEmpty(
    own && own.state,
    inherited && inherited.state,
    lastSearch && lastSearch.state,
    sampleLocation.state,
    icp.state
  );
  if (city) merged.city = city;
  if (state) merged.state = String(state).slice(0, 2).toUpperCase();
  if (own && own.lastSearchKey) merged.lastSearchKey = own.lastSearchKey;

  if (isListingJobType(jobType)) {
    const listingSrc = own && isListingJobType(own.jobType) ? own : inherited;
    Object.assign(merged, normalizeListingFields(listingSrc || { jobType }, jobType));
    if (own && own.query) merged.query = own.query;
    else if (!(listingSrc && listingSrc.query)) {
      const inferred = inferKeywordForFolder(folder);
      if (inferred) merged.query = inferred;
    }
  } else {
    merged.mapsProvider = normalizeMapsProvider(
      (ownRaw && ownRaw.mapsProvider) || (inherited && inherited.mapsProvider) || 'auto'
    );
    merged.directorySupplement =
      ownRaw && Object.prototype.hasOwnProperty.call(ownRaw, 'directorySupplement')
        ? ownRaw.directorySupplement !== false && ownRaw.directorySupplement !== 'off'
        : inherited && inherited.directorySupplement != null
          ? inherited.directorySupplement
          : true;
    merged.minRating =
      own && own.minRating != null
        ? own.minRating
        : inherited && inherited.minRating != null
          ? inherited.minRating
          : null;
    merged.minReviews =
      own && own.minReviews != null
        ? own.minReviews
        : inherited && inherited.minReviews != null
          ? inherited.minReviews
          : null;
    merged.autoTags = (own && own.autoTags && own.autoTags.length ? own.autoTags : null) ||
      (inherited && inherited.autoTags) ||
      [];
    merged.searchNotes = firstNonEmpty(own && own.searchNotes, inherited && inherited.searchNotes);
    merged.keyword = firstNonEmpty(
      own && own.keyword,
      inferKeywordForFolder(folder),
      folder && folder.isPipelineDefault ? inherited && inherited.keyword : '',
      lastSearch && lastSearch.keyword
    );
  }

  const preset = normalizeSearchPreset(merged, { defaultKeyword: '' });
  const needsLocation = jobTypeRequiresLocation(jobType);
  const hasKeyword = isListingJobType(jobType)
    ? !!(preset && String(preset.query || '').trim())
    : !!(preset && String(preset.keyword || '').trim());
  const hasLocation = !!(preset && preset.city && preset.state);

  if (!hasKeyword) {
    return {
      ok: false,
      needSetup: true,
      error: `No saved search for "${(folder && folder.name) || 'this folder'}". Save Search setup (keyword and area), then Run search.`,
      preset,
    };
  }
  if (needsLocation && !hasLocation) {
    return {
      ok: false,
      needSetup: true,
      needLocation: true,
      error: `Add city and state in Search setup for "${(folder && folder.name) || 'this folder'}" so Run search can refresh leads.`,
      preset,
    };
  }

  return { ok: true, preset, needSetup: false };
}

function rememberFieldsFromSearchRecord(searchRecord = {}) {
  const jobType = normalizeJobType(searchRecord.jobType || JOB_TYPES.MAPS_BUSINESS);
  return normalizeSearchPreset(
    {
      jobType,
      keyword: searchRecord.keyword,
      query: searchRecord.query || searchRecord.keyword,
      city: searchRecord.city,
      state: searchRecord.state,
      maxResults: searchRecord.maxResults,
      mapsProvider: searchRecord.mapsProvider,
      directorySupplement: searchRecord.directorySupplement,
      minRating: searchRecord.minRating,
      minReviews: searchRecord.minReviews,
      autoTags: searchRecord.autoTags,
      searchNotes: searchRecord.searchNotes,
      sources: searchRecord.sources,
      minPrice: searchRecord.minPrice,
      maxPrice: searchRecord.maxPrice,
      scraper: searchRecord.scraper,
      flipFilter: searchRecord.flipFilter,
      lastSearchKey: searchRecord.searchKey || searchRecord.key,
    },
    { defaultKeyword: '' }
  );
}

async function rememberFolderSearchFromRun(workspaceId, folderKey, searchRecord) {
  const dbService = require('./database');
  const wid = workspaceId || 'default';
  const folder = await dbService.getFolder(wid, folderKey);
  if (!folder) return null;
  const remembered = rememberFieldsFromSearchRecord(searchRecord);
  if (!remembered) return folder;
  const prev = normalizeSearchPreset(folder.searchPreset, { defaultKeyword: '' }) || {};
  const searchPreset = normalizeSearchPreset(
    {
      ...prev,
      ...remembered,
      keyword: remembered.keyword || prev.keyword,
      query: remembered.query || prev.query,
    },
    { defaultKeyword: remembered.keyword || prev.keyword || '' }
  );
  return dbService.updateFolder(wid, folderKey, { searchPreset });
}

module.exports = {
  normalizeSearchPreset,
  describeSearchPreset,
  searchPresetToFindContext,
  parseSearchPresetFromForm,
  schedulePayloadFromFolder,
  parseAutoTags,
  resolveAutoTagKeys,
  formatPriceRange,
  resolveEffectiveSearchPreset,
  inferKeywordForFolder,
  keywordFromFolderName,
  rememberFolderSearchFromRun,
  rememberFieldsFromSearchRecord,
  MAPS_PROVIDER_LABELS,
  REAL_ESTATE_SCRAPER_LABELS,
  DEFAULT_FLIP_FILTER,
};
