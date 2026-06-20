/** Scheduled scrape job types */

const JOB_TYPES = {
  MAPS_BUSINESS: 'maps_business',
  REAL_ESTATE: 'real_estate',
  /** @deprecated Alias — merged into REAL_ESTATE */
  MOBILE_HOMES: 'mobile_homes',
  HOME_OWNERS: 'home_owners',
  PRODUCTS: 'products',
  WHOLESALE: 'wholesale',
};

const JOB_TYPE_LABELS = {
  [JOB_TYPES.MAPS_BUSINESS]: 'Business',
  [JOB_TYPES.REAL_ESTATE]: 'Real estate',
  [JOB_TYPES.MOBILE_HOMES]: 'Real estate',
  [JOB_TYPES.HOME_OWNERS]: 'Home owners',
  [JOB_TYPES.PRODUCTS]: 'Products',
  [JOB_TYPES.WHOLESALE]: 'Wholesale',
};

const LISTING_JOB_TYPES = new Set([
  JOB_TYPES.REAL_ESTATE,
  JOB_TYPES.MOBILE_HOMES,
  JOB_TYPES.HOME_OWNERS,
  JOB_TYPES.PRODUCTS,
  JOB_TYPES.WHOLESALE,
]);

function normalizeJobType(value) {
  const v = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/-/g, '_');
  if (v === JOB_TYPES.HOME_OWNERS || v === 'homeowners' || v === 'home_owner') {
    return JOB_TYPES.HOME_OWNERS;
  }
  if (v === JOB_TYPES.PRODUCTS || v === 'product') return JOB_TYPES.PRODUCTS;
  if (v === JOB_TYPES.WHOLESALE) return JOB_TYPES.WHOLESALE;
  if (
    v === JOB_TYPES.REAL_ESTATE ||
    v === 'realestate' ||
    v === JOB_TYPES.MOBILE_HOMES ||
    v === 'mobilehomes' ||
    v === 'mobile'
  ) {
    return JOB_TYPES.REAL_ESTATE;
  }
  return JOB_TYPES.MAPS_BUSINESS;
}

function isListingJobType(jobType) {
  const jt = normalizeJobType(jobType);
  return LISTING_JOB_TYPES.has(jt) || jt === JOB_TYPES.MOBILE_HOMES;
}

function scheduleDisplayTitle(schedule) {
  const jobType = normalizeJobType(schedule && schedule.jobType);
  const city = String((schedule && schedule.city) || '').trim();
  const state = String((schedule && schedule.state) || '').trim();
  const locationLabel = [city, state].filter(Boolean).join(', ');

  if (isListingJobType(jobType)) {
    const q = String((schedule && (schedule.query || schedule.keyword)) || '').trim();
    const label =
      jobType === JOB_TYPES.HOME_OWNERS
        ? 'Home owners'
        : jobType === JOB_TYPES.PRODUCTS
          ? 'Products'
          : jobType === JOB_TYPES.WHOLESALE
            ? 'Wholesale'
            : 'Real estate';
    if (q) {
      return locationLabel ? `${q} · ${locationLabel}` : `${label}: ${q}`;
    }
    return locationLabel ? `${label} · ${locationLabel}` : label;
  }
  return String((schedule && schedule.keyword) || 'Search');
}

function scheduleDisplaySubtitle(schedule) {
  const jobType = normalizeJobType(schedule && schedule.jobType);
  const city = String((schedule && schedule.city) || '').trim();
  const state = String((schedule && schedule.state) || '').trim();

  if (isListingJobType(jobType)) {
    const parts = [];
    const sources = Array.isArray(schedule && schedule.sources) ? schedule.sources : [];
    if (sources.length) parts.push(sources.map((s) => s.replace(/_/g, ' ')).join(' + '));
    else parts.push('default scrapers');
    const ff =
      schedule && schedule.flipFilter && schedule.flipFilter.enabled ? schedule.flipFilter : null;
    if (ff) {
      parts.push(`flip ≥${ff.minFlipScore || 7}`);
      if (ff.minRoiPercent) parts.push(`ROI ≥${ff.minRoiPercent}%`);
    }
    if (schedule && schedule.minPrice) parts.push(`min $${Number(schedule.minPrice).toLocaleString()}`);
    if (schedule && schedule.maxPrice) parts.push(`max $${Number(schedule.maxPrice).toLocaleString()}`);
    parts.push(`up to ${(schedule && schedule.maxResults) || 20} results`);
    return parts.join(' · ');
  }

  return `${city}, ${state} · ${(schedule && schedule.maxResults) || 20} leads`;
}

module.exports = {
  JOB_TYPES,
  JOB_TYPE_LABELS,
  LISTING_JOB_TYPES,
  normalizeJobType,
  isListingJobType,
  scheduleDisplayTitle,
  scheduleDisplaySubtitle,
};
