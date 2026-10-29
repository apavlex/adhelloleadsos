/**
 * Pull DataForSEO Backlinks API into a saved project (own site + competitors).
 */

const dataForSeo = require('./dataForSeoClient');
const backlinksStore = require('./backlinksStore');
const {
  hostKey,
  isDirectoryOrPlatformDomain,
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

  // Competitors are user-selected (local Maps / manual). Never auto-pick Labs
  // "competitors_domain" — that returns Facebook/Yelp-style giants, not local rivals.
  let competitors = Array.isArray(project.competitors)
    ? project.competitors
        .map((c) => ({
          domain: hostKey(c.domain || c),
          source: c.source || 'manual',
          title: c.title || null,
        }))
        .filter(
          (c) =>
            c.domain &&
            c.domain !== seedDomain &&
            !isDirectoryOrPlatformDomain(c.domain)
        )
    : [];

  if (project.autoDiscoverCompetitors === true && project.rediscoverCompetitors === true) {
    warnings.push(
      'competitors: Labs auto-discover is disabled — pick local Google Maps competitors instead.'
    );
  }

  const droppedDirs = (Array.isArray(project.competitors) ? project.competitors : [])
    .map((c) => hostKey(c.domain || c))
    .filter((d) => d && isDirectoryOrPlatformDomain(d));
  if (droppedDirs.length) {
    warnings.push(
      `competitors: skipped directories/platforms (${droppedDirs.slice(0, 5).join(', ')}) — pick local businesses.`
    );
  }

  if (!competitors.length) {
    warnings.push(
      'competitors: none selected — syncing your domain only. Search local Google results and select rivals.'
    );
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
