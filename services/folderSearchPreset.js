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
    out.scraper = String(raw.scraper || 'apify_zillow').trim() || 'apify_zillow';
  } else {
    out.keyword = String(raw.keyword || raw.query || 'plumber').trim() || 'plumber';
    out.directorySupplement = raw.directorySupplement !== false && raw.directorySupplement !== 'off';
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
    rows.push({ label: 'Scraper', value: 'Apify Zillow (Oxylabs fallback when configured)' });
  } else {
    rows.push({ label: 'Business keyword', value: p.keyword });
    rows.push({
      label: 'Directory supplement',
      value: p.directorySupplement ? 'Yelp, Yellow Pages, BBB' : 'Off',
    });
    rows.push({ label: 'Scraper', value: 'Google Maps + enrichment' });
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
    raw.scraper = body.scraper || 'apify_zillow';
  } else {
    raw.keyword = body.keyword || body.query;
    raw.directorySupplement = String(body.directorySupplement || '').toLowerCase() === 'on';
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
  return {
    ...base,
    keyword: preset.keyword,
    directorySupplement: preset.directorySupplement,
  };
}

module.exports = {
  normalizeSearchPreset,
  describeSearchPreset,
  searchPresetToFindContext,
  parseSearchPresetFromForm,
  schedulePayloadFromFolder,
  formatPriceRange,
  DEFAULT_FLIP_FILTER,
};
