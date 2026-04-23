const dbService = require('./database');
const { computeOutreachStreak, countUniqueLeadsTouchedOnUtcDate } = require('./trackerStats');
const { chatCompletion } = require('./llmClient');
const { filterLeadsForRequest } = require('./workspaceService');

/**
 * Rich context for AI / rule-based coaching when the user opens the app.
 */
async function buildCoachContext(req) {
  const user = req.user;
  const email = (user && user.emails && user.emails[0] && user.emails[0].value) || '';
  const rawName = (user && user.displayName) || email.split('@')[0] || 'there';
  const firstName = String(rawName).trim().split(/\s+/)[0] || 'there';

  const wid = req.workspaceId;
  if (!wid) throw new Error('buildCoachContext requires req.workspaceId');
  const all = await dbService.getAllLeads(wid);
  const workspace =
    req && typeof req.workspaceRole === 'string'
      ? filterLeadsForRequest(req, all)
      : all;

  const now = Date.now();
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  const newThisWeek = workspace.filter((l) => {
    const t = new Date(l.createdAt || l.savedAt || 0).getTime();
    return t && now - t < weekMs;
  }).length;

  const pipelineCounts = {};
  for (let i = 1; i <= 10; i += 1) pipelineCounts[i] = 0;
  workspace.forEach((l) => {
    const ps = parseInt(l.pipelineStage, 10);
    const n = !Number.isNaN(ps) && ps >= 1 && ps <= 10 ? ps : 1;
    pipelineCounts[n] += 1;
  });

  let maxBacklogStage = null;
  let maxBacklogCount = 0;
  for (let i = 1; i <= 10; i += 1) {
    if (pipelineCounts[i] > maxBacklogCount) {
      maxBacklogCount = pipelineCounts[i];
      maxBacklogStage = i;
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  const touchesToday = countUniqueLeadsTouchedOnUtcDate(workspace, today);
  const history60 = await dbService.listDailyTrackers(wid, email, 60);
  const streak = computeOutreachStreak(history60, today);

  const activeJob = await dbService.getActiveJob();
  const latestJob = await dbService.getLatestFinishedJob();

  return {
    firstName,
    email,
    totalWorkspace: workspace.length,
    newThisWeek,
    pipelineCounts,
    maxBacklogStage: maxBacklogCount > 0 ? maxBacklogStage : null,
    maxBacklogCount,
    touchesToday,
    streak,
    hourUTC: new Date().getUTCHours(),
    hasActiveSearch: !!(activeJob && activeJob.status === 'processing'),
    hasUnreadNotification: !!(latestJob && latestJob.isRead === false),
  };
}

function defaultAiTimeSavers() {
  return [
    { label: 'Maps + Apify search', hint: 'Pulls businesses into saved leads — no manual spreadsheet.' },
    { label: 'CSV import', hint: 'Drop a list; we map columns and merge duplicates by email.' },
    {
      label: 'Enrich a lead',
      hint: 'Firecrawl + HTML tech detection (CMS/chat widgets) — beyond Maps-only SMB lists.',
    },
    {
      label: 'Claude / GPT-4–class = reasoning work',
      hint:
        'Best for one-line email openers, ICP fit scores 1–10 with a short why, two-sentence site blurbs for SDRs, inbound-reply triage, follow-ups that reference their business, and pulling structured fields (decision-maker, pains) from noisy scraped text. Set GEMINI_API_KEY, KIE_AI_API_KEY, or OPENAI_API_KEY — rules stay as backup.',
    },
  ];
}

function ruleBasedCoach(ctx) {
  const nextActions = [];
  const aiTimeSavers = defaultAiTimeSavers();

  if (ctx.totalWorkspace === 0) {
    nextActions.push({ label: 'Run your first lead search', href: '/', priority: 'high' });
    nextActions.push({ label: 'Import a CSV of prospects', href: '/prospecting?tab=pipeline', priority: 'normal' });
    nextActions.push({ label: 'Open Today', href: '/today', priority: 'normal' });
  } else {
    if (ctx.hasUnreadNotification) {
      nextActions.push({ label: 'Review finished search / notification', href: '/history', priority: 'high' });
    }
    if (ctx.hasActiveSearch) {
      nextActions.push({ label: 'Search still running — check History', href: '/history', priority: 'normal' });
    }
    if (ctx.touchesToday === 0 && ctx.hourUTC >= 13) {
      nextActions.push({ label: 'Log today’s touches (streak + discipline)', href: '/reports?tab=tracker', priority: 'high' });
    }
    if (ctx.maxBacklogStage === 1 && ctx.maxBacklogCount >= 3) {
      nextActions.push({
        label: 'Clear New-stage backlog — outreach or drag to Contacted',
        href: '/prospecting?tab=pipeline',
        priority: 'high',
      });
    }
    if (ctx.streak >= 3 && ctx.touchesToday === 0) {
      nextActions.push({ label: `Keep your ${ctx.streak}-day streak — log touches`, href: '/reports?tab=tracker', priority: 'high' });
    }
    nextActions.push({ label: 'Drag cards on the Pipeline board', href: '/prospecting?tab=pipeline', priority: 'normal' });
    nextActions.push({ label: 'Open sales scripts', href: '/sales/personas', priority: 'normal' });
  }

  const seen = new Set();
  const deduped = nextActions.filter((a) => {
    if (seen.has(a.label)) return false;
    seen.add(a.label);
    return true;
  }).slice(0, 5);

  let headline = `${ctx.firstName}, here’s your flow`;
  let greeting = 'Pick one next action and execute — small wins compound.';
  let mood = 'focus';

  if (ctx.totalWorkspace === 0) {
    headline = `${ctx.firstName}, let’s generate leads`;
    greeting = 'Start with a search or a CSV — your pipeline stays in one place.';
  } else if (ctx.touchesToday > 0) {
    headline = `Nice momentum, ${ctx.firstName}`;
    greeting = 'You logged outreach today. Triage pipeline or prep tomorrow’s list.';
    mood = 'celebrate';
  } else if (ctx.streak >= 5) {
    headline = `${ctx.streak}-day streak — stay in the flow`;
    greeting = 'Consistency beats intensity. One more touch today.';
    mood = 'light';
  }

  return {
    headline,
    greeting,
    nextActions: deduped,
    aiTimeSavers,
    mood,
    source: 'rules',
    generatedAt: new Date().toISOString(),
  };
}

const ALLOWED_HREFS = new Set([
  '/',
  '/today',
  '/leads/find',
  '/pipeline',
  '/prospecting',
  '/outreach',
  '/tasks',
  '/resources',
  '/leads',
  '/sales',
  '/sales/workflow',
  '/sales/tracker',
  '/sales/personas',
  '/history',
  '/schedules',
  '/reports',
  '/sequences',
  '/activation',
  '/workspace',
]);

function normalizeCoachPayload(parsed, ctx, fallback, coachSource = 'openai') {
  if (!parsed || typeof parsed !== 'object') return fallback;
  const headline = typeof parsed.headline === 'string' ? parsed.headline : fallback.headline;
  const greeting = typeof parsed.greeting === 'string' ? parsed.greeting : fallback.greeting;
  let nextActions = Array.isArray(parsed.nextActions) ? parsed.nextActions : [];
  nextActions = nextActions
    .filter((a) => a && typeof a.label === 'string' && typeof a.href === 'string')
    .map((a) => {
      let raw = String(a.href || '').trim();
      if (!raw.startsWith('/')) raw = '/' + raw.replace(/^\/+/, '');
      const pathOnly = raw.split(/[?#]/)[0];
      const href =
        ALLOWED_HREFS.has(pathOnly) || pathOnly.startsWith('/workspace/')
          ? raw
          : '/today';
      return {
        label: a.label.slice(0, 160),
        href,
        priority: a.priority === 'high' ? 'high' : 'normal',
      };
    })
    .slice(0, 6);
  if (nextActions.length === 0) nextActions = fallback.nextActions;

  let aiTimeSavers = Array.isArray(parsed.aiTimeSavers) ? parsed.aiTimeSavers : [];
  aiTimeSavers = aiTimeSavers
    .filter((x) => x && typeof x.label === 'string' && typeof x.hint === 'string')
    .map((x) => ({ label: x.label.slice(0, 80), hint: x.hint.slice(0, 320) }))
    .slice(0, 6);
  if (aiTimeSavers.length === 0) aiTimeSavers = fallback.aiTimeSavers;

  const mood = ['focus', 'celebrate', 'light'].includes(parsed.mood) ? parsed.mood : fallback.mood;

  return {
    headline,
    greeting,
    nextActions,
    aiTimeSavers,
    mood,
    source: ['kie', 'openai', 'gemini'].includes(coachSource) ? coachSource : 'openai',
    generatedAt: new Date().toISOString(),
  };
}

async function tryLlmCoach(ctx, fallback) {
  const userPrompt = `You coach a B2B SaaS founder using Agency OS (lead search, CSV import, pipeline stages 1–10 including Contacted → CQI → trial → retainer → referral, daily outreach tracker, personas/scripts).

User context (JSON):
${JSON.stringify(ctx, null, 2)}

Respond with JSON only (no markdown):
{
  "headline": "short punchy title, max 12 words",
  "greeting": "2 sentences max, friendly, actionable",
  "nextActions": [ { "label": "verb + object", "href": "/path", "priority": "high" | "normal" } ],
  "aiTimeSavers": [ { "label": "short", "hint": "how AI saves time in this app" } ],
  "mood": "focus" | "celebrate" | "light"
}

Rules:
- href paths must match app routes: /, /today, /leads/find, /prospecting (tabs: queue, pipeline, folders), /pipeline, /outreach, /tasks, /resources, /leads, /sales/workflow, /sales/tracker, /sales/personas, /scripts (→ personas), /history, /schedules (redirects to prospecting queue), /reports (optional ?tab=tracker), /sequences, /activation, /workspace and /workspace/* (settings sections)
- Prefer 3-5 nextActions; mark urgent items priority high
- Mention concrete numbers from context when useful
- Prefer warm inbound leads when pipelineCounts show inbound-heavy stages
- aiTimeSavers: 3-5 items; tie to this product. Include at least one item that explains frontier models (Claude / GPT-4 class) are ideal for: one-line email personalization, ICP 1-10 scoring with rationale, 2-sentence website summaries for SDRs, classifying inbound replies, contextual follow-ups, structured extraction from messy scrapes. Other items: Apify search, CSV import, enrichment — not generic life advice`;

  try {
    const result = await chatCompletion({
      messages: [
        {
          role: 'system',
          content:
            'You are a concise sales-ops coach. Output valid JSON only. Never include markdown fences.',
        },
        { role: 'user', content: userPrompt },
      ],
      jsonObject: true,
      max_tokens: 700,
      temperature: 0.42,
    });

    if (!result.content || result.error) return null;

    const parsed = JSON.parse(result.content);
    const coachSource = ['kie', 'openai', 'gemini'].includes(result.provider)
      ? result.provider
      : 'openai';
    return normalizeCoachPayload(parsed, ctx, fallback, coachSource);
  } catch (e) {
    console.warn('[flowCoach] LLM coach error:', e.message);
    return null;
  }
}

/**
 * @returns {Promise<{ headline: string, greeting: string, nextActions: Array, aiTimeSavers: Array, mood: string, source: string, generatedAt: string }>}
 */
async function getCoachPayload(req) {
  const ctx = await buildCoachContext(req);
  const fallback = ruleBasedCoach(ctx);
  const ai = await tryLlmCoach(ctx, fallback);
  return ai || fallback;
}

module.exports = {
  buildCoachContext,
  getCoachPayload,
  ruleBasedCoach,
};
