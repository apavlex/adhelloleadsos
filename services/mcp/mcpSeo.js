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
          maps_rank: k.mapsRank,
          local_pack_rank: k.localPackRank,
        }))
      : undefined,
    competitors: includeCompetitors
      ? (research.competitors || []).slice(0, 10).map((c) => ({
          title: c.title,
          domain: c.domain,
          best_rank: c.bestRank,
          appearances: c.appearances,
          avg_rating: c.avgRating,
        }))
      : undefined,
    gbp: research.gbp
      ? {
          title: research.gbp.title || null,
          category: research.gbp.category || null,
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
      'Detailed Local SEO research for the workspace business profile: Maps ranks, competitors, GBP completeness, reviews, scores, and the Ways to improve action plan (with Do-this steps). Use for Map Pack advice, GBP fixes, or local competition.',
    schema: z.object({
      include_keywords: z.boolean().optional().describe('Include keyword rank rows (default true).'),
      include_competitors: z.boolean().optional().describe('Include competitor summary (default true).'),
      max_steps: z.number().int().min(1).max(12).optional().describe('Max action-plan steps (default 8).'),
    }),
    run: getLocalSeo,
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
  READ_ONLY_SEO_TOOLS: SEO_TOOL_NAMES.slice(),
  DESTRUCTIVE_SEO_TOOLS: [],
  OPEN_WORLD_SEO_TOOLS: [],
  executeSeoTool,
  openAiFunctionTools,
  buildSeoFocusSnapshot,
};
