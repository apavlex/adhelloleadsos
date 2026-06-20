/**
 * Saved search configuration on outreach folders — run Find with preset params.
 */

const { JOB_TYPES, normalizeJobType } = require('./scrapeJobTypes');
const { parseFlipFilter, DEFAULT_FLIP_FILTER } = require('./listingFlipScore');
const listingSearch = require('./listingSearch');

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
  } else {
    out.keyword = String(raw.keyword || raw.query || 'plumber').trim() || 'plumber';
  }

  return out;
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
    raw.sources = body.sources;
    raw.flipFilter = parseFlipFilter(body);
  } else if (jobType === JOB_TYPES.REAL_ESTATE) {
    raw.minPrice = body.minPrice;
    raw.maxPrice = body.maxPrice;
  } else {
    raw.keyword = body.keyword || body.query;
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
    return { ...base, minPrice: preset.minPrice, maxPrice: preset.maxPrice };
  }
  return { ...base, keyword: preset.keyword };
}

module.exports = {
  normalizeSearchPreset,
  searchPresetToFindContext,
  parseSearchPresetFromForm,
  schedulePayloadFromFolder,
  DEFAULT_FLIP_FILTER,
};
