/** Scheduled scrape job types — extend here for cars, SOS filings, etc. */

const JOB_TYPES = {
  MAPS_BUSINESS: 'maps_business',
  REAL_ESTATE: 'real_estate',
  MOBILE_HOMES: 'mobile_homes',
};

const JOB_TYPE_LABELS = {
  [JOB_TYPES.MAPS_BUSINESS]: 'Business (Maps)',
  [JOB_TYPES.REAL_ESTATE]: 'Real estate (Zillow)',
  [JOB_TYPES.MOBILE_HOMES]: 'Mobile homes (multi-source)',
};

function normalizeJobType(value) {
  const v = String(value || '').trim().toLowerCase();
  if (v === JOB_TYPES.MOBILE_HOMES) return JOB_TYPES.MOBILE_HOMES;
  if (v === JOB_TYPES.REAL_ESTATE) return JOB_TYPES.REAL_ESTATE;
  return JOB_TYPES.MAPS_BUSINESS;
}

function scheduleDisplayTitle(schedule) {
  const jobType = normalizeJobType(schedule && schedule.jobType);
  if (jobType === JOB_TYPES.MOBILE_HOMES) {
    const city = String((schedule && schedule.city) || '').trim();
    const state = String((schedule && schedule.state) || '').trim();
    const loc = [city, state].filter(Boolean).join(', ') || 'Area TBD';
    const q = String((schedule && schedule.query) || 'mobile home').trim();
    return `${q} · ${loc}`;
  }
  if (jobType === JOB_TYPES.REAL_ESTATE) {
    const city = String((schedule && schedule.city) || '').trim();
    const state = String((schedule && schedule.state) || '').trim();
    const loc = [city, state].filter(Boolean).join(', ') || 'Area TBD';
    const maxP = schedule && schedule.maxPrice ? `$${Number(schedule.maxPrice).toLocaleString()} max` : null;
    return maxP ? `${loc} · ${maxP}` : `${loc} listings`;
  }
  return String((schedule && schedule.keyword) || 'Search');
}

function scheduleDisplaySubtitle(schedule) {
  const jobType = normalizeJobType(schedule && schedule.jobType);
  if (jobType === JOB_TYPES.MOBILE_HOMES) {
    const parts = [];
    const sources = Array.isArray(schedule && schedule.sources) ? schedule.sources : [];
    if (sources.length) parts.push(sources.map((s) => s.replace(/_/g, ' ')).join(' + '));
    else parts.push('all configured sources');
    const ff =
      schedule && schedule.flipFilter && schedule.flipFilter.enabled
        ? schedule.flipFilter
        : null;
    if (ff) {
      parts.push(`flip ≥${ff.minFlipScore || 7}`);
      if (ff.minRoiPercent) parts.push(`ROI ≥${ff.minRoiPercent}%`);
      if (ff.onlyUnique) parts.push('unique only');
      const landMode = String(ff.landMode || 'any');
      if (landMode === 'own_land_only') parts.push('own land only');
      else if (landMode === 'exclude_park') parts.push('no park rent');
      else if (landMode === 'prefer_own_land') parts.push('prefer land');
      if (ff.requireNoHoa) parts.push('no HOA');
    }
    if (schedule && schedule.maxPrice) parts.push(`max $${Number(schedule.maxPrice).toLocaleString()}`);
    parts.push(`up to ${(schedule && schedule.maxResults) || 20} listings`);
    return parts.join(' · ');
  }
  if (jobType === JOB_TYPES.REAL_ESTATE) {
    const parts = [];
    const city = String((schedule && schedule.city) || '').trim();
    const state = String((schedule && schedule.state) || '').trim();
    if (city || state) parts.push([city, state].filter(Boolean).join(', '));
    if (schedule && schedule.minPrice) parts.push(`min $${Number(schedule.minPrice).toLocaleString()}`);
    parts.push(`up to ${schedule && schedule.maxResults ? schedule.maxResults : 20} listings`);
    return parts.join(' · ');
  }
  const city = String((schedule && schedule.city) || '').trim();
  const state = String((schedule && schedule.state) || '').trim();
  return `${city}, ${state} · ${(schedule && schedule.maxResults) || 20} leads`;
}

module.exports = {
  JOB_TYPES,
  JOB_TYPE_LABELS,
  normalizeJobType,
  scheduleDisplayTitle,
  scheduleDisplaySubtitle,
};
