/**
 * SEO / Local Rank tools for MCP clients and in-app Alex/Pavlex.
 * Read-only access to Local SEO, SEO Gap, Backlinks, and Business Reviews
 * so the assistant can recommend what to focus on.
 */
const { z } = require('zod/v3');
const { zodToJsonSchema } = require('zod-to-json-schema');
const localSeoStore = require('../localSeoStore');
const seoGapStore = require('../seoGapStore');
const backlinksStore = require('../backlinksStore');
const businessReviews = require('../businessReviews');
const dataForSeo = require('../dataForSeoClient');
const workspaceIntegrations = require('../workspaceIntegrations');
const {
  flattenSerpItems,
  findBusinessInMapsItems,
  parseGbpInfo,
  parseReviews,
  buildLocationName,
} = require('../localSeoParse');

function toolError(message, code = 'SEO_ERROR') {
  const err = new Error(message);
  err.code = code;
  return err;
}

function compactSteps(plan, limit = 6) {
  const steps = Array.isArray(plan && plan.steps) ? plan.steps : [];
  return steps.slice(0, limit).map((s, i) => ({
    rank: s.rank || i + 1,
    impact: s.impact || null,
    effort: s.effort || null,
    title: s.title || '',
    why: s.why || '',
    how: s.how || '',
  }));
}

function focusPrioritiesFromLocal(research, actionPlan) {
  const scores = (research && research.scores) || {};
  const steps = compactSteps(actionPlan, 3);
  const weak = (Array.isArray(research && research.keywordRanks) ? research.keywordRanks : [])
    .filter((k) => k.mapsRank == null || k.mapsRank > 3)
    .slice(0, 5)
    .map((k) => ({
      keyword: k.keyword,
      maps_rank: k.mapsRank == null ? null : k.mapsRank,
    }));
  return {
    local_score: scores.overall != null ? scores.overall : null,
    maps_score: scores.mapsScore != null ? scores.mapsScore : null,
    gbp_score: scores.gbpScore != null ? scores.gbpScore : null,
    review_score: scores.reviewScore != null ? scores.reviewScore : null,
    top_actions: steps,
    weak_maps_keywords: weak,
    has_gbp: !!(research && research.gbp),
    unanswered_reviews:
      research && research.reviews && research.reviews.unanswered != null
        ? research.reviews.unanswered
        : null,
  };
}

/** Compact SEO block for get_workspace_overview / get_seo_overview. */
async function buildSeoFocusSnapshot(workspaceId) {
  const wid = String(workspaceId || '').trim();
  const local = await localSeoStore.load(wid);
  const research = local.research || null;
  const actionPlan = local.actionPlan || null;
  const seoProjects = await seoGapStore.listProjects(wid);
  const blProjects = await backlinksStore.listProjects(wid);
  const reviewStore = businessReviews.getStore(wid);
  const reviewSummary = businessReviews.inboxSummary(reviewStore);
  const reviewSettings = businessReviews.getSettings(wid);

  const focus = research
    ? focusPrioritiesFromLocal(research, actionPlan)
    : {
        local_score: null,
        maps_score: null,
        gbp_score: null,
        review_score: null,
        top_actions: [],
        weak_maps_keywords: [],
        has_gbp: false,
        unanswered_reviews: null,
      };

  const suggestions = [];
  if (!research) {
    suggestions.push({
      area: 'local_seo',
      priority: 'high',
      suggestion: 'Run Local SEO Update ranks (set city/state + keywords) so Maps/GBP/reviews data exists.',
      href: '/local-seo',
    });
  } else if (focus.top_actions[0]) {
    suggestions.push({
      area: 'local_seo',
      priority: String(focus.top_actions[0].impact || 'high').toLowerCase(),
      suggestion: focus.top_actions[0].title,
      why: focus.top_actions[0].why || '',
      how: focus.top_actions[0].how || '',
      href: '/local-seo',
    });
  }
  if ((reviewSummary.unreplied || 0) > 0) {
    suggestions.push({
      area: 'business_reviews',
      priority: 'high',
      suggestion: `Reply to ${reviewSummary.unreplied} unreplied Google review${reviewSummary.unreplied === 1 ? '' : 's'}.`,
      href: '/business-reviews',
    });
  } else if (!reviewSummary.total && !reviewSettings.query) {
    suggestions.push({
      area: 'business_reviews',
      priority: 'med',
      suggestion: 'Connect a Google listing and sync Business Reviews.',
      href: '/business-reviews',
    });
  }
  const gapNeedingSync = seoProjects.filter((p) => !p.lastSyncedAt).length;
  if (!seoProjects.length) {
    suggestions.push({
      area: 'seo_gap',
      priority: 'med',
      suggestion: 'Create an SEO Gap project for your domain to find keyword opportunities.',
      href: '/seo-gap',
    });
  } else if (gapNeedingSync) {
    suggestions.push({
      area: 'seo_gap',
      priority: 'med',
      suggestion: `Sync ${gapNeedingSync} SEO Gap project${gapNeedingSync === 1 ? '' : 's'} that have never been synced.`,
      href: '/seo-gap',
    });
  }
  const blNeedingCompetitors = blProjects.filter(
    (p) => !Array.isArray(p.competitors) || !p.competitors.length
  ).length;
  if (blProjects.length && blNeedingCompetitors) {
    suggestions.push({
      area: 'backlinks',
      priority: 'med',
      suggestion: 'Pick local Maps competitors on Backlinks (not Facebook/Yelp), then sync.',
      href: '/backlinks',
    });
  } else if (!blProjects.length) {
    suggestions.push({
      area: 'backlinks',
      priority: 'low',
      suggestion: 'Add a Backlinks project for your domain to research referring domains and gaps.',
      href: '/backlinks',
    });
  }

  return {
    local_seo: {
      sync_status: local.syncStatus || 'new',
      last_synced_at: local.lastSyncedAt || null,
      profile: localSeoStore.resolveBusinessProfile(local.workspace || { id: wid }, local.profile),
      scores: research && research.scores ? research.scores : null,
      focus,
      action_plan_source: actionPlan && actionPlan.source ? actionPlan.source : null,
      pages: { app: '/local-seo' },
    },
    seo_gap: {
      project_count: seoProjects.length,
      projects: seoProjects.slice(0, 8).map((p) => ({
        id: p.id,
        domain: p.seedDomain || p.domain || '',
        last_synced_at: p.lastSyncedAt || null,
        sync_status: p.syncStatus || null,
        gap_count: Array.isArray(p.gaps) ? p.gaps.length : (p.summary && p.summary.gapCount) || 0,
        has_action_plan: !!(p.actionPlan && Array.isArray(p.actionPlan.steps) && p.actionPlan.steps.length),
      })),
      pages: { app: '/seo-gap' },
    },
    backlinks: {
      project_count: blProjects.length,
      projects: blProjects.slice(0, 8).map((p) => ({
        id: p.id,
        domain: p.seedDomain || '',
        last_synced_at: p.lastSyncedAt || null,
        sync_status: p.syncStatus || null,
        competitor_count: Array.isArray(p.competitors) ? p.competitors.length : 0,
        your_backlinks: (p.summary && p.summary.yourBacklinks) || null,
        link_gap_count: (p.summary && p.summary.linkGapCount) || (Array.isArray(p.linkGaps) ? p.linkGaps.length : 0),
      })),
      pages: { app: '/backlinks' },
    },
    business_reviews: {
      query: reviewSettings.query || '',
      business_name: reviewSettings.businessName || '',
      total: reviewSummary.total || 0,
      new_count: reviewSummary.newCount || 0,
      unreplied: reviewSummary.unreplied || 0,
      with_draft: reviewSummary.withDraft || 0,
      rating: reviewSummary.placeRating,
      last_synced_at: reviewSummary.lastSyncedAt || null,
      last_error: reviewSummary.lastError || null,
      sync_state: reviewSummary.syncState || null,
      pages: { app: '/business-reviews' },
    },
    focus_suggestions: suggestions.slice(0, 6),
  };
}

async function getSeoOverview(ctx) {
  const snapshot = await buildSeoFocusSnapshot(ctx.workspaceId);
  return {
    message:
      'SEO / Local Rank snapshot for this workspace. Use focus_suggestions first when advising what to work on.',
    ...snapshot,
  };
}

async function getLocalSeo(ctx, input) {
  const local = await localSeoStore.load(ctx.workspaceId);
  const research = local.research || null;
  if (!research) {
    return {
      message: 'No Local SEO research yet. Ask the user to open /local-seo, set city/state + keywords, and click Update ranks.',
      has_research: false,
      profile: localSeoStore.resolveBusinessProfile(local.workspace || { id: ctx.workspaceId }, local.profile),
      pages: { app: '/local-seo' },
    };
  }
  const includeCompetitors = input.include_competitors !== false;
  const includeKeywords = input.include_keywords !== false;
  return {
    has_research: true,
    sync_status: local.syncStatus || null,
    last_synced_at: local.lastSyncedAt || null,
    profile: research.profileSnapshot || localSeoStore.resolveBusinessProfile(local.workspace || {}, local.profile),
    scores: research.scores || null,
    keyword_ranks: includeKeywords
      ? (research.keywordRanks || []).slice(0, 20).map((k) => ({
          keyword: k.keyword,
          search_volume: k.searchVolume != null ? k.searchVolume : null,
          competition: k.competition != null ? k.competition : null,
          cpc: k.cpc != null ? k.cpc : null,
          maps_rank: k.mapsRank,
          local_pack_rank: k.localPackRank,
          your_rating: k.mapsMatch && k.mapsMatch.rating != null ? k.mapsMatch.rating : null,
          your_reviews: k.mapsMatch && k.mapsMatch.votes != null ? k.mapsMatch.votes : null,
        }))
      : undefined,
    competitors: includeCompetitors
      ? (research.competitors || []).slice(0, 10).map((c) => ({
          title: c.title,
          domain: c.domain,
          best_rank: c.bestRank,
          appearances: c.appearances,
          avg_rating: c.avgRating,
          reviews: c.reviews != null ? c.reviews : null,
          category: c.category || null,
        }))
      : undefined,
    category_keywords: (research.categoryKeywords || []).slice(0, 20).map((ck) => ({
      keyword: ck.keyword,
      search_volume: ck.searchVolume,
      competition: ck.competition,
      cpc: ck.cpc,
      keyword_difficulty: ck.keywordDifficulty,
    })),
    category_seed: research.categorySeed || null,
    gbp: research.gbp
      ? {
          title: research.gbp.title || null,
          category: research.gbp.category || null,
          address: research.gbp.address || null,
          phone: research.gbp.phone || null,
          website: research.gbp.website || null,
          completeness: research.gbp.completeness,
          photos: research.gbp.photos,
          rating: research.gbp.rating,
          votes: research.gbp.votes,
          checks: research.gbp.checks || null,
        }
      : null,
    reviews: research.reviews
      ? {
          rating: research.reviews.rating,
          votes: research.reviews.votes,
          unanswered: research.reviews.unanswered,
          fetched: research.reviews.fetched,
        }
      : null,
    action_plan: local.actionPlan
      ? {
          source: local.actionPlan.source,
          summary: local.actionPlan.summary,
          steps: compactSteps(local.actionPlan, input.max_steps || 8),
        }
      : null,
    focus: focusPrioritiesFromLocal(research, local.actionPlan),
    warnings: Array.isArray(research.warnings) ? research.warnings.slice(0, 12) : [],
    pages: { app: '/local-seo' },
  };
}

async function resolveDfsEnv(ctx) {
  const integrationEnv = await workspaceIntegrations.getResolvedIntegrationEnv(ctx.workspaceId);
  if (!dataForSeo.isConfigured(integrationEnv)) {
    throw toolError(
      'DataForSEO is not connected for this workspace. Ask the user to add login + API password under Workspace → Integrations.',
      'DATAFORSEO_NOT_CONFIGURED'
    );
  }
  return integrationEnv;
}

async function profileForResearch(ctx) {
  const local = await localSeoStore.load(ctx.workspaceId);
  const profile = localSeoStore.resolveBusinessProfile(local.workspace || { id: ctx.workspaceId }, local.profile);
  return { local, profile, locationName: buildLocationName(profile) };
}

/** Live DataForSEO keyword research (search volume + optional Maps rank). */
async function researchKeyword(ctx, input) {
  const integrationEnv = await resolveDfsEnv(ctx);
  const { profile, locationName } = await profileForResearch(ctx);
  const keywords = (Array.isArray(input.keywords) && input.keywords.length
    ? input.keywords
    : [input.keyword]
  )
    .map((k) => String(k || '').trim())
    .filter(Boolean)
    .slice(0, 20);
  if (!keywords.length) throw toolError('Provide keyword or keywords.', 'INVALID_ARGUMENTS');

  const locationCode = Number(input.location_code) || profile.locationCode || 2840;
  const languageCode = String(input.language_code || profile.languageCode || 'en').slice(0, 8);
  const locName = input.location_name || locationName;

  const volJson = await dataForSeo.searchVolumeLive({
    keywords,
    locationCode,
    languageCode,
    integrationEnv,
  });
  const volMap = dataForSeo.parseSearchVolumeMap(volJson);
  const rows = [];
  for (const keyword of keywords) {
    const vol = volMap.get(keyword.toLowerCase()) || null;
    const row = {
      keyword,
      search_volume: vol ? vol.searchVolume : null,
      competition: vol ? vol.competition : null,
      competition_level: vol ? vol.competitionLevel : null,
      cpc: vol ? vol.cpc : null,
      maps_rank: null,
      maps_match: null,
    };
    if (input.include_maps !== false && (profile.city || locName)) {
      try {
        const mapsJson = await dataForSeo.googleMapsLive({
          keyword,
          locationName: locName,
          locationCode,
          languageCode,
          depth: 15,
          integrationEnv,
        });
        const match = findBusinessInMapsItems(flattenSerpItems(mapsJson), {
          businessName: profile.businessName,
          website: profile.website,
        });
        if (match) {
          row.maps_rank = match.rank;
          row.maps_match = {
            title: match.title,
            rating: match.rating,
            reviews: match.votes,
            category: match.category,
          };
        }
      } catch (err) {
        row.maps_error = err && err.message ? err.message : 'maps failed';
      }
    }
    rows.push(row);
  }
  return {
    message: 'Live DataForSEO keyword research for this workspace.',
    location_name: locName || null,
    location_code: locationCode,
    results: rows,
    pages: { app: '/local-seo', integrations: '/workspace/integrations#integration-dataforseo' },
  };
}

/** Live GBP + reviews lookup via DataForSEO Business Data. */
async function researchBusiness(ctx, input) {
  const integrationEnv = await resolveDfsEnv(ctx);
  const { profile, locationName } = await profileForResearch(ctx);
  const query =
    String(input.query || '').trim() ||
    [profile.businessName, profile.city, profile.state].filter(Boolean).join(' ').trim();
  if (!query && !input.place_id && !input.cid) {
    throw toolError('Provide query, place_id, or cid (or set the Local SEO business profile).', 'INVALID_ARGUMENTS');
  }
  const locationCode = Number(input.location_code) || profile.locationCode || 2840;
  const languageCode = String(input.language_code || profile.languageCode || 'en').slice(0, 8);
  const locName = input.location_name || locationName;

  let gbp = null;
  let reviews = null;
  const warnings = [];
  try {
    const gbpJson = await dataForSeo.myBusinessInfoLive({
      keyword: input.place_id || input.cid ? undefined : query,
      placeId: input.place_id || profile.placeId || undefined,
      cid: input.cid || profile.cid || undefined,
      locationName: locName,
      locationCode,
      languageCode,
      integrationEnv,
    });
    gbp = parseGbpInfo(gbpJson);
  } catch (err) {
    warnings.push(`gbp: ${err && err.message ? err.message : 'failed'}`);
  }
  if (input.include_reviews !== false) {
    try {
      const revJson = await dataForSeo.googleReviewsLive({
        keyword: input.place_id || input.cid || (gbp && (gbp.placeId || gbp.cid)) ? undefined : query,
        placeId: input.place_id || (gbp && gbp.placeId) || profile.placeId || undefined,
        cid: input.cid || (gbp && gbp.cid) || profile.cid || undefined,
        locationName: locName,
        languageCode,
        depth: Math.min(40, Math.max(5, Number(input.max_reviews) || 15)),
        integrationEnv,
      });
      reviews = parseReviews(revJson);
    } catch (err) {
      warnings.push(`reviews: ${err && err.message ? err.message : 'failed'}`);
    }
  }
  return {
    message: 'Live DataForSEO business info / reviews.',
    query: query || null,
    business: gbp
      ? {
          title: gbp.title,
          category: gbp.category,
          address: gbp.address,
          phone: gbp.phone,
          website: gbp.website,
          rating: gbp.rating,
          reviews: gbp.votes,
          photos: gbp.photos,
          completeness: gbp.completeness,
          place_id: gbp.placeId,
          cid: gbp.cid,
        }
      : null,
    reviews_summary: reviews
      ? {
          rating: reviews.rating,
          votes: reviews.votes,
          unanswered: reviews.unanswered,
          fetched: reviews.fetched,
          sample: Array.isArray(reviews.sample)
            ? reviews.sample.slice(0, 5).map((r) => ({
                rating: r.rating,
                text: String(r.snippet || '').slice(0, 200),
                has_owner_reply: !!r.hasReply,
              }))
            : [],
        }
      : null,
    warnings,
    pages: { app: '/local-seo', integrations: '/workspace/integrations#integration-dataforseo' },
  };
}

/** Live related / category keyword volumes around a seed phrase or workspace vertical. */
async function researchCategoryKeywords(ctx, input) {
  const integrationEnv = await resolveDfsEnv(ctx);
  const { profile } = await profileForResearch(ctx);
  const seed =
    String(input.seed || input.category || input.vertical || '').trim() ||
    String(profile.vertical || '').trim() ||
    String(profile.businessName || '').trim();
  if (!seed) throw toolError('Provide a seed/category/vertical to research.', 'INVALID_ARGUMENTS');
  const locationCode = Number(input.location_code) || profile.locationCode || 2840;
  const languageCode = String(input.language_code || profile.languageCode || 'en').slice(0, 8);
  const limit = Math.min(50, Math.max(5, Number(input.limit) || 25));
  const relJson = await dataForSeo.relatedKeywordsLive({
    keyword: seed,
    locationCode,
    languageCode,
    limit,
    depth: 2,
    integrationEnv,
  });
  const rows = dataForSeo.parseRelatedKeywordRows(relJson, limit);
  return {
    message: 'Live DataForSEO related / category keyword volumes.',
    seed,
    location_code: locationCode,
    keywords: rows.map((r) => ({
      keyword: r.keyword,
      search_volume: r.searchVolume,
      competition: r.competition,
      cpc: r.cpc,
      keyword_difficulty: r.keywordDifficulty,
    })),
    pages: { app: '/local-seo', integrations: '/workspace/integrations#integration-dataforseo' },
  };
}

async function getSeoGap(ctx, input) {
  const projects = await seoGapStore.listProjects(ctx.workspaceId);
  if (!projects.length) {
    return {
      message: 'No SEO Gap projects yet. Create one at /seo-gap for the business domain.',
      projects: [],
      pages: { app: '/seo-gap' },
    };
  }
  let project = null;
  if (input.project_id) {
    project = await seoGapStore.getProject(ctx.workspaceId, input.project_id);
    if (!project) throw toolError('SEO Gap project not found.', 'NOT_FOUND');
  } else if (input.domain) {
    const needle = String(input.domain).toLowerCase().replace(/^www\./, '');
    project =
      projects.find((p) => String(p.seedDomain || p.domain || '').toLowerCase().replace(/^www\./, '') === needle) ||
      null;
    if (!project) throw toolError(`No SEO Gap project for domain "${input.domain}".`, 'NOT_FOUND');
  } else {
    project = projects[0];
  }

  const gaps = Array.isArray(project.gaps) ? project.gaps : [];
  const plan = project.actionPlan || null;
  return {
    project: {
      id: project.id,
      domain: project.seedDomain || project.domain || '',
      location_code: project.locationCode || null,
      last_synced_at: project.lastSyncedAt || null,
      sync_status: project.syncStatus || null,
      summary: project.summary || null,
    },
    top_gaps: gaps.slice(0, input.max_gaps || 15).map((g) => ({
      keyword: g.keyword || g.query || '',
      your_rank: g.yourRank != null ? g.yourRank : g.rank ?? null,
      competitor_rank: g.competitorRank != null ? g.competitorRank : null,
      search_volume: g.searchVolume != null ? g.searchVolume : g.volume ?? null,
      opportunity: g.opportunityScore != null ? g.opportunityScore : g.score ?? null,
    })),
    action_plan: plan
      ? {
          source: plan.source,
          summary: plan.summary,
          steps: compactSteps(plan, input.max_steps || 8),
        }
      : null,
    all_projects: projects.map((p) => ({
      id: p.id,
      domain: p.seedDomain || p.domain || '',
      last_synced_at: p.lastSyncedAt || null,
    })),
    pages: { app: `/seo-gap/${encodeURIComponent(project.id)}`, list: '/seo-gap' },
  };
}

async function getBacklinks(ctx, input) {
  const projects = await backlinksStore.listProjects(ctx.workspaceId);
  if (!projects.length) {
    return {
      message: 'No Backlinks projects yet. Create one at /backlinks and pick local Maps competitors.',
      projects: [],
      pages: { app: '/backlinks' },
    };
  }
  let project = null;
  if (input.project_id) {
    project = await backlinksStore.getProject(ctx.workspaceId, input.project_id);
    if (!project) throw toolError('Backlinks project not found.', 'NOT_FOUND');
  } else if (input.domain) {
    const needle = String(input.domain).toLowerCase().replace(/^www\./, '');
    project =
      projects.find((p) => String(p.seedDomain || '').toLowerCase().replace(/^www\./, '') === needle) || null;
    if (!project) throw toolError(`No Backlinks project for domain "${input.domain}".`, 'NOT_FOUND');
  } else {
    project = projects[0];
  }

  const you = project.you || {};
  return {
    project: {
      id: project.id,
      domain: project.seedDomain || '',
      last_synced_at: project.lastSyncedAt || null,
      sync_status: project.syncStatus || null,
      summary: project.summary || null,
    },
    competitors: (Array.isArray(project.competitors) ? project.competitors : []).map((c) => ({
      domain: c.domain,
      source: c.source || null,
      title: c.title || null,
    })),
    comparison: Array.isArray(project.comparison) ? project.comparison.slice(0, 10) : [],
    your_referring_domains: Array.isArray(you.referringDomains)
      ? you.referringDomains.slice(0, input.max_referring || 20).map((r) => ({
          domain: r.domain,
          rank: r.rank,
          backlinks: r.backlinks,
        }))
      : [],
    link_gaps: Array.isArray(project.linkGaps)
      ? project.linkGaps.slice(0, input.max_gaps || 15).map((g) => ({
          domain: g.domain,
          competitors: g.competitors,
          opportunity_score: g.opportunityScore,
        }))
      : [],
    warnings: Array.isArray(project.warnings) ? project.warnings.slice(0, 10) : [],
    pages: { app: `/backlinks/${encodeURIComponent(project.id)}`, list: '/backlinks' },
  };
}

async function getBusinessReviewsSeo(ctx, input) {
  const settings = businessReviews.getSettings(ctx.workspaceId);
  const store = businessReviews.getStore(ctx.workspaceId);
  const summary = businessReviews.inboxSummary(store);
  const limit = Math.min(30, Math.max(1, Number(input.max_reviews) || 10));
  const unrepliedOnly = input.unreplied_only !== false;
  let reviews = Array.isArray(store.reviews) ? store.reviews.slice() : [];
  if (unrepliedOnly) reviews = reviews.filter((r) => !r.ownerResponse);
  reviews = reviews.slice(0, limit).map((r) => ({
    id: r.id,
    rating: r.rating,
    author: r.author,
    text: String(r.text || '').slice(0, 280),
    reviewed_at: r.reviewedAt || null,
    is_new: !!r.isNew,
    has_owner_response: !!r.ownerResponse,
    has_draft: !!r.replyDraft,
  }));
  return {
    settings: {
      query: settings.query || '',
      business_name: settings.businessName || '',
      auto_sync: settings.autoSync !== false,
    },
    summary: {
      total: summary.total,
      new_count: summary.newCount,
      unreplied: summary.unreplied,
      with_draft: summary.withDraft,
      rating: summary.placeRating,
      place_name: summary.placeName || '',
      last_synced_at: summary.lastSyncedAt || null,
      last_error: summary.lastError || null,
      sync_state: summary.syncState || null,
    },
    reviews,
    focus:
      summary.unreplied > 0
        ? `Reply to ${summary.unreplied} unreplied review(s) first — highest trust ROI.`
        : summary.total
          ? 'Inbox is caught up on replies; keep auto-sync on for new reviews.'
          : 'No reviews synced yet — save a Maps query and run background sync.',
    pages: { app: '/business-reviews' },
  };
}

const SEO_TOOLS = [
  {
    name: 'get_seo_overview',
    description:
      'One-call SEO / Local Rank snapshot for this workspace: Local SEO scores + top improve actions, SEO Gap projects, Backlinks projects, Business Reviews inbox counts, and ranked focus_suggestions (what to work on first). Use when the user asks what to focus on for SEO, rankings, Maps, GBP, reviews, or backlinks.',
    schema: z.object({}),
    run: getSeoOverview,
  },
  {
    name: 'get_local_seo',
    description:
      'Detailed Local SEO research for the workspace business profile: Maps ranks, local search volumes, category keyword volumes, competitors (ratings/reviews), GBP completeness, reviews, scores, and the Ways to improve action plan. Use for Map Pack advice, GBP fixes, or local competition.',
    schema: z.object({
      include_keywords: z.boolean().optional().describe('Include keyword rank rows (default true).'),
      include_competitors: z.boolean().optional().describe('Include competitor summary (default true).'),
      max_steps: z.number().int().min(1).max(12).optional().describe('Max action-plan steps (default 8).'),
    }),
    run: getLocalSeo,
  },
  {
    name: 'research_seo_keyword',
    description:
      'Live DataForSEO research for one or more keywords: local search volume, competition, CPC, and optional Google Maps rank for the workspace business. Use when the user asks about search volume, demand, or ranking for a phrase that may not be in saved Local SEO data yet.',
    schema: z.object({
      keyword: z.string().optional().describe('Single keyword (or use keywords[]).'),
      keywords: z.array(z.string()).max(20).optional(),
      include_maps: z.boolean().optional().describe('Also check Maps rank (default true).'),
      location_name: z.string().optional().describe('Override market, e.g. Camas,Washington,United States'),
      location_code: z.number().int().optional(),
      language_code: z.string().optional(),
    }),
    run: researchKeyword,
  },
  {
    name: 'research_local_business',
    description:
      'Live DataForSEO Google Business Profile + reviews lookup (business info, category, rating, review sample). Defaults to the workspace Local SEO profile; pass query/place_id/cid to research any business.',
    schema: z.object({
      query: z.string().optional().describe('Business name + city, or leave blank to use workspace profile.'),
      place_id: z.string().optional(),
      cid: z.string().optional(),
      include_reviews: z.boolean().optional().describe('Fetch reviews sample (default true).'),
      max_reviews: z.number().int().min(5).max(40).optional(),
      location_name: z.string().optional(),
      location_code: z.number().int().optional(),
      language_code: z.string().optional(),
    }),
    run: researchBusiness,
  },
  {
    name: 'research_category_keywords',
    description:
      'Live DataForSEO related/category keyword volumes around a seed phrase (trade, vertical, or topic). Use for category research volume tables and content ideas. Defaults to the workspace vertical if seed omitted.',
    schema: z.object({
      seed: z.string().optional().describe('Category / vertical / phrase seed.'),
      category: z.string().optional(),
      vertical: z.string().optional(),
      limit: z.number().int().min(5).max(50).optional(),
      location_code: z.number().int().optional(),
      language_code: z.string().optional(),
    }),
    run: researchCategoryKeywords,
  },
  {
    name: 'get_seo_gap',
    description:
      'SEO Gap project details: keyword gaps vs competitors and the AI/rules action plan. Pass project_id or domain; defaults to the most recently updated project.',
    schema: z.object({
      project_id: z.string().optional(),
      domain: z.string().optional().describe('Seed domain, e.g. tprflooring.com'),
      max_gaps: z.number().int().min(1).max(40).optional(),
      max_steps: z.number().int().min(1).max(12).optional(),
    }),
    run: getSeoGap,
  },
  {
    name: 'get_backlinks',
    description:
      'Backlinks project details: your referring domains, selected local competitors, comparison, and link gaps. Pass project_id or domain; defaults to the newest project.',
    schema: z.object({
      project_id: z.string().optional(),
      domain: z.string().optional(),
      max_referring: z.number().int().min(1).max(50).optional(),
      max_gaps: z.number().int().min(1).max(40).optional(),
    }),
    run: getBacklinks,
  },
  {
    name: 'get_business_reviews_inbox',
    description:
      'Google Business Reviews inbox (Outscraper): counts, sync status, and recent unreplied reviews for reply prioritization. Separate from member review-page stats (get_review_stats).',
    schema: z.object({
      unreplied_only: z.boolean().optional().describe('Default true — only reviews needing a reply.'),
      max_reviews: z.number().int().min(1).max(30).optional(),
    }),
    run: getBusinessReviewsSeo,
  },
];

const BY_NAME = Object.fromEntries(SEO_TOOLS.map((t) => [t.name, t]));
const SEO_TOOL_NAMES = SEO_TOOLS.map((t) => t.name);
const OPEN_WORLD_SEO_TOOLS = [
  'research_seo_keyword',
  'research_local_business',
  'research_category_keywords',
];
const READ_ONLY_SEO_TOOLS = SEO_TOOL_NAMES.filter((n) => !OPEN_WORLD_SEO_TOOLS.includes(n));

async function executeSeoTool(ctx, name, input) {
  const tool = BY_NAME[name];
  if (!tool) throw toolError(`Unknown tool: ${name}`, 'UNKNOWN_TOOL');
  const parsed = tool.schema.safeParse(input || {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw toolError(`${issue.path.join('.') || 'input'}: ${issue.message}`, 'INVALID_ARGUMENTS');
  }
  return tool.run(ctx, parsed.data);
}

function openAiFunctionTools() {
  return SEO_TOOLS.map((tool) => {
    const { $schema, ...parameters } = zodToJsonSchema(tool.schema, { target: 'openApi3' });
    return { type: 'function', function: { name: tool.name, description: tool.description, parameters } };
  });
}

module.exports = {
  SEO_TOOLS,
  SEO_TOOL_NAMES,
  READ_ONLY_SEO_TOOLS,
  DESTRUCTIVE_SEO_TOOLS: [],
  OPEN_WORLD_SEO_TOOLS,
  executeSeoTool,
  openAiFunctionTools,
  buildSeoFocusSnapshot,
};
