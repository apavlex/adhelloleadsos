const dbService = require('./database');
const { computeOutreachStreak, touchesForRow } = require('./trackerStats');

/**
 * Rich context for AI / rule-based coaching when the user opens the app.
 */
async function buildCoachContext(req) {
  const user = req.user;
  const email = (user && user.emails && user.emails[0] && user.emails[0].value) || '';
  const rawName = (user && user.displayName) || email.split('@')[0] || 'there';
  const firstName = String(rawName).trim().split(/\s+/)[0] || 'there';

  const all = await dbService.getAllLeads();
  const workspace = all.filter((l) => !l.source || !l.source.startsWith('adhello_'));

  const now = Date.now();
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  const newThisWeek = workspace.filter((l) => {
    const t = new Date(l.createdAt || l.savedAt || 0).getTime();
    return t && now - t < weekMs;
  }).length;

  const pipelineCounts = {};
  for (let i = 1; i <= 8; i += 1) pipelineCounts[i] = 0;
  workspace.forEach((l) => {
    const ps = parseInt(l.pipelineStage, 10);
    const n = !Number.isNaN(ps) && ps >= 1 && ps <= 8 ? ps : 1;
    pipelineCounts[n] += 1;
  });

  let maxBacklogStage = null;
  let maxBacklogCount = 0;
  for (let i = 1; i <= 8; i += 1) {
    if (pipelineCounts[i] > maxBacklogCount) {
      maxBacklogCount = pipelineCounts[i];
      maxBacklogStage = i;
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  const todayRow = await dbService.getDailyTracker(email, today);
  const touchesToday = touchesForRow(todayRow);
  const history60 = await dbService.listDailyTrackers(email, 60);
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
    { label: 'Enrich a lead', hint: 'One click to scrape site signals instead of ten browser tabs.' },
    { label: 'Personas & scripts', hint: 'Reusable talk tracks; add OPENAI_API_KEY for custom AI copy later.' },
  ];
}

function ruleBasedCoach(ctx) {
  const nextActions = [];
  const aiTimeSavers = defaultAiTimeSavers();

  if (ctx.totalWorkspace === 0) {
    nextActions.push({ label: 'Run your first niche search', href: '/', priority: 'high' });
    nextActions.push({ label: 'Import a CSV of prospects', href: '/leads', priority: 'normal' });
    nextActions.push({ label: 'See Command Center', href: '/sales', priority: 'normal' });
  } else {
    if (ctx.hasUnreadNotification) {
      nextActions.push({ label: 'Review finished search / notification', href: '/history', priority: 'high' });
    }
    if (ctx.hasActiveSearch) {
      nextActions.push({ label: 'Search still running — check History', href: '/history', priority: 'normal' });
    }
    if (ctx.touchesToday === 0 && ctx.hourUTC >= 13) {
      nextActions.push({ label: 'Log today’s outreach (streak + discipline)', href: '/sales/tracker', priority: 'high' });
    }
    if (ctx.maxBacklogStage === 1 && ctx.maxBacklogCount >= 3) {
      nextActions.push({ label: 'Move prospects to CQI (stage 2)', href: '/sales/workflow', priority: 'high' });
    }
    if (ctx.streak >= 3 && ctx.touchesToday === 0) {
      nextActions.push({ label: `Keep your ${ctx.streak}-day streak — log touches`, href: '/sales/tracker', priority: 'high' });
    }
    nextActions.push({ label: 'Drag cards on the pipeline board', href: '/leads', priority: 'normal' });
    nextActions.push({ label: 'Open scripts (Clay / Paul / Bob)', href: '/sales/personas', priority: 'normal' });
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
  '/leads',
  '/sales',
  '/sales/workflow',
  '/sales/tracker',
  '/sales/personas',
  '/history',
  '/schedules',
  '/analytics',
]);

function normalizeCoachPayload(parsed, ctx, fallback) {
  if (!parsed || typeof parsed !== 'object') return fallback;
  const headline = typeof parsed.headline === 'string' ? parsed.headline : fallback.headline;
  const greeting = typeof parsed.greeting === 'string' ? parsed.greeting : fallback.greeting;
  let nextActions = Array.isArray(parsed.nextActions) ? parsed.nextActions : [];
  nextActions = nextActions
    .filter((a) => a && typeof a.label === 'string' && typeof a.href === 'string')
    .map((a) => {
      let href = a.href.startsWith('/') ? a.href.split('?')[0] : `/${a.href}`.replace(/^\/\//, '/');
      if (!ALLOWED_HREFS.has(href)) href = '/sales';
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
    .map((x) => ({ label: x.label.slice(0, 80), hint: x.hint.slice(0, 200) }))
    .slice(0, 6);
  if (aiTimeSavers.length === 0) aiTimeSavers = fallback.aiTimeSavers;

  const mood = ['focus', 'celebrate', 'light'].includes(parsed.mood) ? parsed.mood : fallback.mood;

  return {
    headline,
    greeting,
    nextActions,
    aiTimeSavers,
    mood,
    source: 'openai',
    generatedAt: new Date().toISOString(),
  };
}

async function tryOpenAICoach(ctx, fallback) {
  const key = process.env.OPENAI_API_KEY;
  if (!key || typeof fetch !== 'function') return null;

  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const userPrompt = `You coach a B2B SaaS founder using Agency OS (lead search, CSV import, pipeline stages 1-8, daily outreach tracker, AI personas/scripts).

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
- href must be one of: /, /leads, /sales, /sales/workflow, /sales/tracker, /sales/personas, /history, /schedules
- Prefer 3-5 nextActions; mark urgent items priority high
- Mention concrete numbers from context when useful
- aiTimeSavers: 3-4 items referencing Apify search, CSV import, enrichment, scripts — not generic life advice`;

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0.45,
        max_tokens: 600,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content:
              'You are a concise sales-ops coach. Output valid JSON only. Never include markdown fences.',
          },
          { role: 'user', content: userPrompt },
        ],
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.warn('[flowCoach] OpenAI HTTP', res.status, errText.slice(0, 200));
      return null;
    }

    const data = await res.json();
    const text = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!text || typeof text !== 'string') return null;
    const parsed = JSON.parse(text);
    return normalizeCoachPayload(parsed, ctx, fallback);
  } catch (e) {
    console.warn('[flowCoach] OpenAI error:', e.message);
    return null;
  }
}

/**
 * @returns {Promise<{ headline: string, greeting: string, nextActions: Array, aiTimeSavers: Array, mood: string, source: string, generatedAt: string }>}
 */
async function getCoachPayload(req) {
  const ctx = await buildCoachContext(req);
  const fallback = ruleBasedCoach(ctx);
  const ai = await tryOpenAICoach(ctx, fallback);
  return ai || fallback;
}

module.exports = {
  buildCoachContext,
  getCoachPayload,
  ruleBasedCoach,
};
