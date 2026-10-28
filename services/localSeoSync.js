/**
 * Run Local SEO research for the workspace business profile and persist it.
 */

const dataForSeo = require('./dataForSeoClient');
const localSeoStore = require('./localSeoStore');
const {
  flattenSerpItems,
  findBusinessInMapsItems,
  extractLocalPackFromOrganic,
  parseGbpInfo,
  parseReviews,
  scoreLocalResearch,
  defaultKeywords,
  hostKey,
} = require('./localSeoParse');

async function syncLocalSeo(workspaceId, { integrationEnv, profilePatch, persist = true } = {}) {
  if (!dataForSeo.isConfigured(integrationEnv)) {
    const err = new Error('Connect DataForSEO in Workspace → Integrations first.');
    err.code = 'DATAFORSEO_NOT_CONFIGURED';
    throw err;
  }

  const current = await localSeoStore.load(workspaceId);
  const profile = localSeoStore.resolveBusinessProfile(current.workspace, {
    ...current.profile,
    ...(profilePatch || {}),
  });

  if (!profile.businessName) {
    const err = new Error('Set a business name on the workspace profile (or here) before updating research.');
    err.code = 'NO_BUSINESS';
    throw err;
  }

  let keywords = profile.keywords && profile.keywords.length
    ? profile.keywords.slice(0, 6)
    : defaultKeywords(profile);
  if (!keywords.length) {
    keywords = [`${profile.businessName}${profile.city ? ' ' + profile.city : ''}`];
  }

  const warnings = [];
  const keywordRanks = [];
  let discoveredPlaceId = profile.placeId || '';
  let discoveredCid = profile.cid || '';

  for (const keyword of keywords) {
    const row = {
      keyword,
      mapsRank: null,
      mapsMatch: null,
      localPackRank: null,
      localPack: [],
      error: null,
    };
    try {
      const mapsJson = await dataForSeo.googleMapsLive({
        keyword,
        locationName: profile.locationName,
        locationCode: profile.locationCode,
        languageCode: profile.languageCode,
        depth: 20,
        integrationEnv,
      });
      const mapsItems = flattenSerpItems(mapsJson);
      const match = findBusinessInMapsItems(mapsItems, {
        businessName: profile.businessName,
        website: profile.website,
      });
      if (match) {
        row.mapsRank = match.rank;
        row.mapsMatch = match;
        if (!discoveredPlaceId && match.placeId) discoveredPlaceId = String(match.placeId);
        if (!discoveredCid && match.cid) discoveredCid = String(match.cid);
      }
    } catch (err) {
      row.error = err && err.message ? err.message : 'maps failed';
      warnings.push(`maps:${keyword}: ${row.error}`);
    }

    try {
      const orgJson = await dataForSeo.googleOrganicLive({
        keyword,
        locationName: profile.locationName,
        locationCode: profile.locationCode,
        languageCode: profile.languageCode,
        depth: 20,
        integrationEnv,
      });
      const pack = extractLocalPackFromOrganic(flattenSerpItems(orgJson), {
        businessName: profile.businessName,
        website: profile.website,
      });
      row.localPack = pack.pack;
      if (pack.you && pack.you.rank != null) row.localPackRank = pack.you.rank;
    } catch (err) {
      warnings.push(`organic:${keyword}: ${err && err.message ? err.message : 'failed'}`);
    }

    keywordRanks.push(row);
  }

  let gbp = null;
  try {
    const gbpJson = await dataForSeo.myBusinessInfoLive({
      keyword: discoveredPlaceId || discoveredCid ? undefined : `${profile.businessName} ${profile.city || ''}`.trim(),
      placeId: discoveredPlaceId || undefined,
      cid: discoveredCid || undefined,
      locationName: profile.locationName,
      locationCode: profile.locationCode,
      languageCode: profile.languageCode,
      integrationEnv,
    });
    gbp = parseGbpInfo(gbpJson);
    if (gbp) {
      if (!discoveredPlaceId && gbp.placeId) discoveredPlaceId = String(gbp.placeId);
      if (!discoveredCid && gbp.cid) discoveredCid = String(gbp.cid);
    }
  } catch (err) {
    warnings.push(`gbp: ${err && err.message ? err.message : 'failed'}`);
  }

  let reviews = null;
  try {
    const revJson = await dataForSeo.googleReviewsLive({
      keyword: discoveredPlaceId || discoveredCid ? undefined : `${profile.businessName} ${profile.city || ''}`.trim(),
      placeId: discoveredPlaceId || undefined,
      cid: discoveredCid || undefined,
      locationName: profile.locationName,
      languageCode: profile.languageCode,
      depth: 25,
      integrationEnv,
    });
    reviews = parseReviews(revJson);
  } catch (err) {
    warnings.push(`reviews: ${err && err.message ? err.message : 'failed'}`);
  }

  const scores = scoreLocalResearch({ keywordRanks, gbp, reviews });
  const research = {
    profileSnapshot: {
      businessName: profile.businessName,
      city: profile.city,
      vertical: profile.vertical,
      website: profile.website ? hostKey(profile.website) : '',
      locationName: profile.locationName,
      keywords,
      placeId: discoveredPlaceId || null,
      cid: discoveredCid || null,
    },
    keywordRanks,
    gbp,
    reviews,
    scores,
    warnings: warnings.slice(0, 40),
    researchedAt: new Date().toISOString(),
  };

  const nextProfile = {
    ...current.profile,
    ...(profilePatch || {}),
    businessName: profile.businessName,
    city: profile.city,
    vertical: profile.vertical,
    website: profile.website,
    locationName: profile.locationName,
    locationCode: profile.locationCode,
    languageCode: profile.languageCode,
    keywords,
    placeId: discoveredPlaceId || profile.placeId || '',
    cid: discoveredCid || profile.cid || '',
  };

  if (!persist) {
    return { profile: nextProfile, research, syncStatus: 'ready', lastSyncedAt: research.researchedAt };
  }

  return localSeoStore.save(workspaceId, {
    profile: nextProfile,
    research,
    syncStatus: 'ready',
    lastSyncedAt: research.researchedAt,
  });
}

module.exports = {
  syncLocalSeo,
};
