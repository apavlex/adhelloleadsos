/**
 * Saved search configuration on outreach folders — run Find with preset params.
 */

const { JOB_TYPES, normalizeJobType } = require('./scrapeJobTypes');
const { parseFlipFilter, DEFAULT_FLIP_FILTER } = require('./listingFlipScore');
const listingSearch = require('./listingSearch');

const JOB_TYPE_LABELS = {
  [JOB_TYPES.MAPS_BUSINESS]: 'Business (Google Maps)',
  [JOB_TYPES.MOBILE_HOMES]: 'Mobile homes',
  [JOB_TYPES.REAL_ESTATE]: 'Real estate (Zillow / Apify)',
};

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
  apify: 'Apify',
};

const REAL_ESTATE_SCRAPER_LABELS = {
  apify_zillow: 'Apify Zillow',
  oxylabs: 'Oxylabs',
  auto: 'Auto (Apify → Oxylabs fallback)',
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

function normalizeSearchPreset(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const jobType = normalizeJobType(raw.jobType || JOB_TYPES.MAPS_BUSINESS);
  const out = {
    jobType,
    maxResults: Math.min(100, Math.max(1, parseInt(raw.maxResults, 10) || 25)),
  };

  if (jobType === JOB_TYPES.MOBILE_HOMES) {
    out.query = String(raw.query || 'mobile home').trim() || 'mobile home';
    out.minPrice = raw.minPrice != null && raw.minPrice !== '' ? parseInt(raw.minPrice, 10) : null;
    out.maxPrice = raw.maxPrice != null && raw.maxPrice !== '' ? parseInt(raw.maxPrice, 10) : null;
    out.sources = listingSearch.parseSourcesList(raw.sources);
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
  } else if (jobType === JOB_TYPES.REAL_ESTATE) {
    out.minPrice = raw.minPrice != null && raw.minPrice !== '' ? parseInt(raw.minPrice, 10) : null;
    out.maxPrice = raw.maxPrice != null && raw.maxPrice !== '' ? parseInt(raw.maxPrice, 10) : null;
    const scraper = String(raw.scraper || 'auto').trim().toLowerCase();
    out.scraper = REAL_ESTATE_SCRAPER_LABELS[scraper] ? scraper : 'auto';
  } else {
    out.keyword = String(raw.keyword || raw.query || 'plumber').trim() || 'plumber';
    out.mapsProvider = normalizeMapsProvider(raw.mapsProvider);
    out.directorySupplement = raw.directorySupplement !== false && raw.directorySupplement !== 'off';
    out.minRating =
      raw.minRating != null && raw.minRating !== '' ? parseFloat(raw.minRating) : null;
    out.minReviews =
      raw.minReviews != null && raw.minReviews !== '' ? parseInt(raw.minReviews, 10) : null;
    out.autoTags = parseAutoTags(raw.autoTags);
    out.searchNotes = String(raw.searchNotes || '').trim();
  }

  return out;
}

function describeSearchPreset(preset) {
  const p = normalizeSearchPreset(preset);
  if (!p) return null;

  const rows = [{ label: 'Search type', value: JOB_TYPE_LABELS[p.jobType] || p.jobType }];
  rows.push({ label: 'Max results', value: String(p.maxResults) });

  if (p.jobType === JOB_TYPES.MOBILE_HOMES) {
    rows.push({ label: 'Search terms', value: p.query });
    const price = formatPriceRange(p.minPrice, p.maxPrice);
    if (price) rows.push({ label: 'Price range', value: price });
    if (p.sources && p.sources.length) {
      rows.push({
        label: 'Scrapers',
        value: p.sources.map((id) => listingSearch.sourceLabel(id)).join(', '),
      });
    }
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
  } else if (p.jobType === JOB_TYPES.REAL_ESTATE) {
    const price = formatPriceRange(p.minPrice, p.maxPrice);
    if (price) rows.push({ label: 'Price range', value: price });
    rows.push({
      label: 'Scraper',
      value: REAL_ESTATE_SCRAPER_LABELS[p.scraper] || REAL_ESTATE_SCRAPER_LABELS.auto,
    });
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
      value: p.directorySupplement ? 'Yelp, Yellow Pages, BBB' : 'Off',
    });
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

  const ctx = {
    searchType:
      p.jobType === JOB_TYPES.MOBILE_HOMES
        ? 'mobile_homes'
        : p.jobType === JOB_TYPES.REAL_ESTATE
          ? 'real_estate'
          : 'maps',
    searchPrefill: {
      keyword: p.keyword || p.query || '',
      city: '',
      state: '',
      qty: p.maxResults,
    },
    searchPreset: p,
  };

  return ctx;
}

function parseSearchPresetFromForm(body) {
  const jobType = normalizeJobType(body.jobType);
  const raw = {
    jobType,
    maxResults: body.maxResults,
  };

  if (jobType === JOB_TYPES.MOBILE_HOMES) {
    raw.query = body.query;
    raw.minPrice = body.minPrice;
    raw.maxPrice = body.maxPrice;
    raw.sources = listingSearch.parseSourcesFromBody(body);
    raw.flipFilter = parseFlipFilter(body);
  } else if (jobType === JOB_TYPES.REAL_ESTATE) {
    raw.minPrice = body.minPrice;
    raw.maxPrice = body.maxPrice;
    raw.scraper = body.scraper || body.realEstateScraper || 'auto';
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

  const base = {
    jobType: preset.jobType,
    city: location.city,
    state: location.state,
    maxResults: preset.maxResults,
    targetFolderKey: folder.key,
    targetFolderName: folder.name,
  };

  if (preset.jobType === JOB_TYPES.MOBILE_HOMES) {
    return {
      ...base,
      query: preset.query,
      sources: preset.sources,
      minPrice: preset.minPrice,
      maxPrice: preset.maxPrice,
      flipFilter: preset.flipFilter,
    };
  }
  if (preset.jobType === JOB_TYPES.REAL_ESTATE) {
    return { ...base, minPrice: preset.minPrice, maxPrice: preset.maxPrice, scraper: preset.scraper };
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

module.exports = {
  normalizeSearchPreset,
  describeSearchPreset,
  searchPresetToFindContext,
  parseSearchPresetFromForm,
  schedulePayloadFromFolder,
  parseAutoTags,
  resolveAutoTagKeys,
  formatPriceRange,
  MAPS_PROVIDER_LABELS,
  REAL_ESTATE_SCRAPER_LABELS,
  DEFAULT_FLIP_FILTER,
};
