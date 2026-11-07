/**
 * Run Local SEO research for the workspace business profile and persist it.
 */

const dataForSeo = require('./dataForSeoClient');
const localSeoStore = require('./localSeoStore');
const { phasePercent } = require('./localSeoProgress');
const {
  flattenSerpItems,
  findBusinessInMapsItems,
  extractLocalPackFromOrganic,
  parseGbpInfo,
  parseReviews,
  scoreLocalResearch,
  enrichKeywords,
  buildLocationName,
  extractMapsCompetitors,
  summarizeCompetitors,
  hostKey,
} = require('./localSeoParse');

const runningJobs = new Set();

async function reportProgress(workspaceId, patch) {
  if (!workspaceId) return null;
  try {
    return await localSeoStore.patchSyncProgress(workspaceId, patch);
  } catch (_) {
    return null;
  }
}

async function syncLocalSeo(workspaceId, { integrationEnv, profilePatch, persist = true, onProgress } = {}) {
  const emit = async (phase, label, keywordIndex, keywordTotal) => {
    const percent = phasePercent(phase, keywordIndex, keywordTotal);
    const payload = { phase, label, percent, active: phase !== 'done', error: null };
    if (typeof onProgress === 'function') {
      try {
        await onProgress(payload);
      } catch (_) {
        /* ignore progress listener errors */
      }
    }
    if (persist && workspaceId) {
      await reportProgress(workspaceId, {
        ...payload,
        active: phase !== 'done',
      });
    }
  };

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
  if (!profile.city) {
    const err = new Error('Set a city (e.g. Camas) so Maps ranks are local — country-wide location will not work.');
    err.code = 'NO_CITY';
    throw err;
  }

  const locationName = buildLocationName(profile);
  const keywords = enrichKeywords({ ...profile, keywords: profile.keywords });

  const warnings = [];
  if (!profile.state) {
    warnings.push(
      'Tip: add a State (e.g. Washington) so DataForSEO uses City,State,United States — more accurate Maps ranks.',
    );
  }
  if (String(profile.locationName || '').toLowerCase() === 'united states') {
    warnings.push(`Using local market “${locationName}” instead of country-wide United States.`);
  }

  const keywordRanks = [];
  let discoveredPlaceId = profile.placeId || '';
  let discoveredCid = profile.cid || '';

  for (let ki = 0; ki < keywords.length; ki += 1) {
    const keyword = keywords[ki];
    await emit('maps', `Maps & local pack · ${keyword}`, ki, keywords.length);
    const row = {
      keyword,
      mapsRank: null,
      mapsMatch: null,
      localPackRank: null,
      localPack: [],
      competitors: [],
      error: null,
    };
    try {
      const mapsJson = await dataForSeo.googleMapsLive({
        keyword,
        locationName,
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
      } else {
        row.error = 'Not found in top Maps results for this keyword + market.';
      }
      row.competitors = extractMapsCompetitors(mapsItems, {
        businessName: profile.businessName,
        website: profile.website,
      });
    } catch (err) {
      row.error = err && err.message ? err.message : 'maps failed';
      warnings.push(`maps:${keyword}: ${row.error}`);
    }

    try {
      const orgJson = await dataForSeo.googleOrganicLive({
        keyword,
        locationName,
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
      if (!row.competitors.length && pack.pack.length) {
        row.competitors = pack.pack
          .filter((p) => p.title && !String(p.title).toLowerCase().includes(String(profile.businessName).toLowerCase().slice(0, 8)))
          .slice(0, 5)
          .map((p) => ({
            title: p.title,
            domain: p.domain,
            rank: p.rank,
            rating: p.rating,
            votes: null,
            category: null,
          }));
      }
    } catch (err) {
      warnings.push(`organic:${keyword}: ${err && err.message ? err.message : 'failed'}`);
    }

    keywordRanks.push(row);
  }

  await emit('volume', 'Local search volumes', keywords.length, keywords.length);
  try {
    const volJson = await dataForSeo.searchVolumeLive({
      keywords,
      locationCode: profile.locationCode,
      languageCode: profile.languageCode,
      integrationEnv,
    });
    const volMap = dataForSeo.parseSearchVolumeMap(volJson);
    for (const row of keywordRanks) {
      const hit = volMap.get(String(row.keyword || '').trim().toLowerCase());
      if (!hit) continue;
      row.searchVolume = hit.searchVolume;
      row.competition = hit.competition;
      row.competitionLevel = hit.competitionLevel;
      row.cpc = hit.cpc;
    }
  } catch (err) {
    warnings.push(`search_volume: ${err && err.message ? err.message : 'failed'}`);
  }

  let categoryKeywords = [];
  const categorySeed = String(profile.vertical || '').trim() || `${profile.businessName} ${profile.city || ''}`.trim();
  await emit('category', 'Category keyword research', keywords.length, keywords.length);
  if (categorySeed) {
    try {
      const relJson = await dataForSeo.relatedKeywordsLive({
        keyword: profile.vertical
          ? `${profile.vertical}${profile.city ? ` ${profile.city}` : ''}`.trim()
          : categorySeed,
        locationCode: profile.locationCode,
        languageCode: profile.languageCode,
        limit: 30,
        depth: 2,
        integrationEnv,
      });
      categoryKeywords = dataForSeo.parseRelatedKeywordRows(relJson, 30);
    } catch (err) {
      warnings.push(`category_keywords: ${err && err.message ? err.message : 'failed'}`);
    }
  }

  let gbp = null;
  await emit('gbp', 'Google Business Profile', keywords.length, keywords.length);
  try {
    const gbpJson = await dataForSeo.myBusinessInfoLive({
      keyword:
        discoveredPlaceId || discoveredCid
          ? undefined
          : `${profile.businessName} ${profile.city || ''}`.trim(),
      placeId: discoveredPlaceId || undefined,
      cid: discoveredCid || undefined,
      locationName,
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
  await emit('reviews', 'Reviews snapshot', keywords.length, keywords.length);
  try {
    const revJson = await dataForSeo.googleReviewsLive({
      keyword:
        discoveredPlaceId || discoveredCid
          ? undefined
          : `${profile.businessName} ${profile.city || ''}`.trim(),
      placeId: discoveredPlaceId || undefined,
      cid: discoveredCid || undefined,
      locationName,
      languageCode: profile.languageCode,
      depth: 25,
      integrationEnv,
    });
    reviews = parseReviews(revJson);
  } catch (err) {
    warnings.push(`reviews: ${err && err.message ? err.message : 'failed'}`);
  }

  await emit('score', 'Scoring ranks', keywords.length, keywords.length);
  const scores = scoreLocalResearch({ keywordRanks, gbp, reviews });
  const competitors = summarizeCompetitors(keywordRanks);
  const research = {
    profileSnapshot: {
      businessName: profile.businessName,
      city: profile.city,
      state: profile.state,
      vertical: profile.vertical,
      website: profile.website ? hostKey(profile.website) : '',
      locationName,
      keywords,
      placeId: discoveredPlaceId || null,
      cid: discoveredCid || null,
    },
    keywordRanks,
    competitors,
    categoryKeywords,
    categorySeed: profile.vertical || categorySeed || null,
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
    state: profile.state,
    vertical: profile.vertical,
    website: profile.website,
    locationName,
    locationCode: profile.locationCode,
    languageCode: profile.languageCode,
    keywords,
    placeId: discoveredPlaceId || profile.placeId || '',
    cid: discoveredCid || profile.cid || '',
  };

  if (!persist) {
    await emit('done', 'Ready', keywords.length, keywords.length);
    return { profile: nextProfile, research, syncStatus: 'ready', lastSyncedAt: research.researchedAt };
  }

  await emit('save', 'Saving research', keywords.length, keywords.length);
  const saved = await localSeoStore.save(workspaceId, {
    profile: nextProfile,
    research,
    syncStatus: 'ready',
    lastSyncedAt: research.researchedAt,
    syncProgress: {
      active: false,
      percent: 100,
      phase: 'done',
      label: 'Ready',
      error: null,
      startedAt: null,
    },
  });
  return saved;
}

/**
 * Kick off a background sync so the UI can poll progress.
 * Returns immediately if a job is already running for this workspace.
 */
async function startLocalSeoSyncAsync(workspaceId, { integrationEnv, profilePatch } = {}) {
  const wid = String(workspaceId || '').trim();
  if (!wid) {
    const err = new Error('workspaceId required');
    err.code = 'NO_WORKSPACE';
    throw err;
  }

  const current = await localSeoStore.load(wid);
  if (runningJobs.has(wid) || (current.syncProgress && current.syncProgress.active)) {
    return {
      started: false,
      alreadyRunning: true,
      syncProgress: current.syncProgress || localSeoStore.emptySyncProgress(),
    };
  }

  const startedAt = new Date().toISOString();
  runningJobs.add(wid);
  await localSeoStore.save(wid, {
    syncStatus: 'syncing',
    profile: profilePatch || undefined,
    syncProgress: {
      active: true,
      percent: 1,
      phase: 'maps',
      label: 'Starting update…',
      error: null,
      startedAt,
      updatedAt: startedAt,
    },
  });

  setImmediate(() => {
    (async () => {
      try {
        const updated = await syncLocalSeo(wid, {
          integrationEnv,
          profilePatch,
          persist: true,
        });
        let actionPlan = null;
        try {
          await reportProgress(wid, {
            active: true,
            percent: 97,
            phase: 'plan',
            label: 'Building action plan…',
            error: null,
          });
          const { generateLocalActionPlan } = require('./localSeoPlanner');
          actionPlan = await generateLocalActionPlan(updated.research, { integrationEnv });
          await localSeoStore.save(wid, { actionPlan });
        } catch (_) {
          /* non-fatal */
        }
        await reportProgress(wid, {
          active: false,
          percent: 100,
          phase: 'done',
          label: 'Ready',
          error: null,
          startedAt: null,
        });
        await localSeoStore.save(wid, { syncStatus: 'ready' });
      } catch (err) {
        const message = err && err.message ? err.message : 'Update failed';
        try {
          await localSeoStore.save(wid, {
            syncStatus: 'error',
            syncProgress: {
              active: false,
              percent: 0,
              phase: 'error',
              label: message,
              error: message,
              startedAt: null,
            },
          });
        } catch (_) {
          /* ignore */
        }
      } finally {
        runningJobs.delete(wid);
      }
    })();
  });

  return {
    started: true,
    alreadyRunning: false,
    syncProgress: {
      active: true,
      percent: 1,
      phase: 'maps',
      label: 'Starting update…',
      error: null,
      startedAt,
    },
  };
}

module.exports = {
  syncLocalSeo,
  startLocalSeoSyncAsync,
  phasePercent,
};

// Re-export for callers that imported from sync historically.
