/**
 * Pull DataForSEO Labs data into a project warehouse (no crawling).
 */

const crypto = require('crypto');
const dataForSeo = require('./dataForSeoClient');
const { buildGapRows, summarizeGaps } = require('./seoGapEngine');
const seoGapStore = require('./seoGapStore');
const {
  cleanDomain,
  parseCompetitorDomainItems,
  parseKeywordsForSite,
  parseIntersectionAsCompetitorRanks,
} = require('./seoGapParse');

/**
 * Sync a project from DataForSEO. Mutates/returns updated project document.
 */
async function syncProjectFromDataForSeo(project, opts) {
  const options = opts || {};
  const integrationEnv = options.integrationEnv || {};
  const fetchImpl = options.fetchImpl;
  if (!dataForSeo.isConfigured(integrationEnv)) {
    const err = new Error(
      'DataForSEO is not configured. Add login + API password under Workspace → Integrations.',
    );
    err.code = 'DATAFORSEO_NOT_CONFIGURED';
    throw err;
  }

  const seed = cleanDomain(project.seedDomain);
  if (!seed) {
    const err = new Error('Project needs a seed domain.');
    err.code = 'NO_DOMAIN';
    throw err;
  }

  const locationCode = Number(project.locationCode) || 2840;
  const languageCode = String(project.languageCode || 'en').slice(0, 8);
  const keywordLimit = Math.min(200, Math.max(20, Number(project.keywordLimit) || 100));
  const maxCompetitors = Math.min(5, Math.max(1, Number(project.maxCompetitors) || 3));
  const warnings = [];
  const rawPayloads = [];

  const syncId = `sync_${Date.now().toString(36)}_${crypto.randomBytes(2).toString('hex')}`;

  let competitors = Array.isArray(project.competitors) ? project.competitors.slice() : [];
  if (!competitors.length || options.rediscoverCompetitors) {
    try {
      const compJson = await dataForSeo.competitorsDomainLive({
        target: seed,
        locationCode,
        languageCode,
        limit: maxCompetitors + 5,
        integrationEnv,
        fetchImpl,
      });
      rawPayloads.push({ endpoint: 'competitors_domain', fetchedAt: new Date().toISOString(), preview: true });
      competitors = parseCompetitorDomainItems(compJson)
        .filter((c) => c.domain !== seed)
        .slice(0, maxCompetitors)
        .map((c) => ({
          domain: c.domain,
          source: 'dfs',
          similarityScore: Math.round(c.similarity || 0),
          intersections: c.intersections,
          etv: c.etv,
        }));
    } catch (err) {
      warnings.push(`competitors_domain: ${err && err.message ? err.message : 'failed'}`);
    }
  } else {
    competitors = competitors
      .map((c) => ({
        domain: cleanDomain(c.domain || c),
        source: c.source || 'manual',
        similarityScore: c.similarityScore || 0,
      }))
      .filter((c) => c.domain && c.domain !== seed)
      .slice(0, maxCompetitors);
  }

  let youRankings = [];
  try {
    const youJson = await dataForSeo.keywordsForSiteLive({
      target: seed,
      locationCode,
      languageCode,
      limit: keywordLimit,
      integrationEnv,
      fetchImpl,
    });
    rawPayloads.push({ endpoint: 'keywords_for_site', fetchedAt: new Date().toISOString() });
    youRankings = parseKeywordsForSite(youJson, seed);
  } catch (err) {
    warnings.push(`keywords_for_site: ${err && err.message ? err.message : 'failed'}`);
  }

  const competitorRankings = [];
  for (const rival of competitors) {
    try {
      const gapJson = await dataForSeo.domainIntersectionLive({
        target1: rival.domain,
        target2: seed,
        intersections: false,
        locationCode,
        languageCode,
        limit: keywordLimit,
        integrationEnv,
        fetchImpl,
      });
      rawPayloads.push({
        endpoint: 'domain_intersection',
        rival: rival.domain,
        fetchedAt: new Date().toISOString(),
      });
      competitorRankings.push(...parseIntersectionAsCompetitorRanks(gapJson, rival.domain));
    } catch (err) {
      warnings.push(`domain_intersection(${rival.domain}): ${err && err.message ? err.message : 'failed'}`);
    }
  }

  const gapRows = buildGapRows({
    youRankings,
    competitorRankings,
    limit: Math.min(500, keywordLimit * maxCompetitors),
  });
  const summary = summarizeGaps(gapRows);

  const next = {
    ...project,
    seedDomain: seed,
    locationCode,
    languageCode,
    competitors,
    youRankings: youRankings.slice(0, keywordLimit),
    competitorRankings: competitorRankings.slice(0, keywordLimit * maxCompetitors),
    gapRows,
    gapSummary: summary,
    rawPayloads: rawPayloads.slice(-20),
    warnings,
    lastSyncId: syncId,
    lastSyncedAt: new Date().toISOString(),
    syncStatus: warnings.length && !gapRows.length ? 'partial_error' : 'ready',
    actionPlan: null,
    actionPlanAt: null,
  };

  if (options.persist !== false && project.workspaceId && project.id) {
    return seoGapStore.upsertProject(project.workspaceId, next);
  }
  return next;
}

module.exports = {
  syncProjectFromDataForSeo,
  parseKeywordMetrics: require('./seoGapParse').parseKeywordMetrics,
  parseCompetitorDomainItems,
  parseKeywordsForSite,
  parseIntersectionAsCompetitorRanks,
};
