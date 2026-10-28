/**
 * Pull DataForSEO Backlinks API into a saved project (own site + competitors).
 */

const dataForSeo = require('./dataForSeoClient');
const backlinksStore = require('./backlinksStore');
const {
  hostKey,
  parseSummaryResult,
  parseReferringDomainItems,
  parseAnchorItems,
  parseTimeseriesItems,
  computeCompetitorLinkGaps,
} = require('./backlinksParse');

function monthsAgoIso(months) {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - (Number(months) || 6));
  return d.toISOString().slice(0, 10);
}

async function fetchDomainProfile(domain, { integrationEnv, referringLimit, anchorLimit }) {
  const warnings = [];
  let summary = parseSummaryResult(null);
  let referringDomains = [];
  let anchors = [];
  let timeseries = [];

  try {
    const sumJson = await dataForSeo.backlinksSummaryLive({ target: domain, integrationEnv });
    summary = parseSummaryResult(dataForSeo.firstTaskResult(sumJson));
  } catch (err) {
    warnings.push(`summary:${domain}: ${err && err.message ? err.message : 'failed'}`);
  }

  try {
    const refJson = await dataForSeo.referringDomainsLive({
      target: domain,
      limit: referringLimit,
      integrationEnv,
    });
    const result = dataForSeo.firstTaskResult(refJson);
    referringDomains = parseReferringDomainItems(result && result.items);
  } catch (err) {
    warnings.push(`referring:${domain}: ${err && err.message ? err.message : 'failed'}`);
  }

  try {
    const ancJson = await dataForSeo.backlinksAnchorsLive({
      target: domain,
      limit: anchorLimit,
      integrationEnv,
    });
    const result = dataForSeo.firstTaskResult(ancJson);
    anchors = parseAnchorItems(result && result.items);
  } catch (err) {
    warnings.push(`anchors:${domain}: ${err && err.message ? err.message : 'failed'}`);
  }

  try {
    const tsJson = await dataForSeo.backlinksTimeseriesNewLostLive({
      target: domain,
      dateFrom: monthsAgoIso(6),
      groupRange: 'month',
      integrationEnv,
    });
    const result = dataForSeo.firstTaskResult(tsJson);
    timeseries = parseTimeseriesItems(result && result.items);
  } catch (err) {
    warnings.push(`timeseries:${domain}: ${err && err.message ? err.message : 'failed'}`);
  }

  return {
    domain: hostKey(domain),
    summary,
    referringDomains,
    anchors,
    timeseries,
    syncedAt: new Date().toISOString(),
    warnings,
  };
}

async function syncBacklinksProject(project, { integrationEnv, persist = true } = {}) {
  if (!dataForSeo.isConfigured(integrationEnv)) {
    const err = new Error('Connect DataForSEO in Workspace → Integrations first.');
    err.code = 'DATAFORSEO_NOT_CONFIGURED';
    throw err;
  }
  const seedDomain = hostKey(project.seedDomain);
  if (!seedDomain) {
    const err = new Error('Seed domain required');
    err.code = 'NO_DOMAIN';
    throw err;
  }

  const referringLimit = Math.min(200, Math.max(20, Number(project.referringLimit) || 80));
  const anchorLimit = Math.min(100, Math.max(10, Number(project.anchorLimit) || 40));
  const warnings = [];

  let competitors = Array.isArray(project.competitors)
    ? project.competitors
        .map((c) => ({ domain: hostKey(c.domain || c), source: c.source || 'manual' }))
        .filter((c) => c.domain && c.domain !== seedDomain)
    : [];

  if ((!competitors.length || project.autoDiscoverCompetitors) && project.rediscoverCompetitors !== false) {
    try {
      const disc = await dataForSeo.competitorsDomainLive({
        target: seedDomain,
        limit: Math.min(5, Math.max(1, Number(project.maxCompetitors) || 3)),
        locationCode: Number(project.locationCode) || 2840,
        languageCode: String(project.languageCode || 'en').slice(0, 8),
        integrationEnv,
      });
      const items = dataForSeo.extractLabsItems(disc);
      const discovered = items
        .map((it) => hostKey(it.domain || it.target || (it.competitor && it.competitor.domain)))
        .filter((d) => d && d !== seedDomain)
        .slice(0, Math.min(5, Math.max(1, Number(project.maxCompetitors) || 3)))
        .map((domain) => ({ domain, source: 'dataforseo_labs' }));
      const byDomain = new Map(competitors.map((c) => [c.domain, c]));
      for (const d of discovered) if (!byDomain.has(d.domain)) byDomain.set(d.domain, d);
      competitors = Array.from(byDomain.values()).slice(0, 5);
    } catch (err) {
      warnings.push(`competitors: ${err && err.message ? err.message : 'discover failed'}`);
    }
  }

  const you = await fetchDomainProfile(seedDomain, { integrationEnv, referringLimit, anchorLimit });
  warnings.push(...(you.warnings || []));

  const competitorProfiles = [];
  for (const c of competitors.slice(0, 5)) {
    const profile = await fetchDomainProfile(c.domain, {
      integrationEnv,
      referringLimit: Math.min(referringLimit, 60),
      anchorLimit: Math.min(anchorLimit, 25),
    });
    warnings.push(...(profile.warnings || []));
    competitorProfiles.push({
      domain: profile.domain,
      source: c.source,
      summary: profile.summary,
      referringDomains: profile.referringDomains,
      anchors: profile.anchors.slice(0, 15),
      timeseries: profile.timeseries,
      syncedAt: profile.syncedAt,
    });
  }

  const linkGaps = computeCompetitorLinkGaps({
    yourReferring: you.referringDomains,
    competitorProfiles,
  }).slice(0, 100);

  const comparison = competitorProfiles.map((p) => ({
    domain: p.domain,
    backlinks: p.summary.backlinks,
    referringDomains: p.summary.referringDomains,
    rank: p.summary.rank,
    spamScore: p.summary.spamScore,
    vsYouBacklinks: (p.summary.backlinks || 0) - (you.summary.backlinks || 0),
    vsYouReferring: (p.summary.referringDomains || 0) - (you.summary.referringDomains || 0),
  }));

  const next = {
    ...project,
    seedDomain,
    competitors,
    syncStatus: 'ready',
    lastSyncedAt: new Date().toISOString(),
    you: {
      domain: you.domain,
      summary: you.summary,
      referringDomains: you.referringDomains,
      anchors: you.anchors,
      timeseries: you.timeseries,
    },
    competitorProfiles,
    comparison,
    linkGaps,
    warnings: warnings.slice(0, 40),
    summary: {
      yourBacklinks: you.summary.backlinks,
      yourReferringDomains: you.summary.referringDomains,
      yourRank: you.summary.rank,
      competitorCount: competitorProfiles.length,
      linkGapCount: linkGaps.length,
    },
  };

  if (persist) {
    return backlinksStore.upsertProject(project.workspaceId, next);
  }
  return next;
}

module.exports = {
  syncBacklinksProject,
  fetchDomainProfile,
};
