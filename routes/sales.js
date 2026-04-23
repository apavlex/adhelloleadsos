const express = require('express');
const router = express.Router();
const dbService = require('../services/database');
const { SCRIPT_LIBRARY, SCRIPT_LIBRARY_KEYS, PERSONAS } = require('../services/salesConstants');
const pipelineStagesService = require('../services/pipelineStagesService');
const { chatCompletion } = require('../services/llmClient');
const { buildDayRollup } = require('../services/trackerStats');
const {
  inferDailyTouchCountsFromLeads,
  displayTouchTotalsForDay,
  buildDailyChartDisplaySeries,
  enrichRollupWithLeadInference,
  computeOutreachStreakWithLeads,
} = require('../services/trackerAutoFill');
const activationService = require('../services/activationService');
const { filterLeadsForRequest, userEmail } = require('../services/workspaceService');
const {
  buildOutreachCoachSnapshot,
  buildNamedCoachActions,
} = require('../services/outreachCoachSnapshot');
const { generateOutreachCoachPayload } = require('../services/outreachCoachAi');
const { workspaceTodayYmd } = require('../services/workspaceTimezone');
const salesScriptsStorage = require('../services/salesScriptsStorage');
const {
  getCoachBriefForToday,
  persistCoachBrief,
  clearCoachBrief,
} = require('../services/prospectingCoachCache');

// Legacy Command Center URL → Today (hub lives at GET /today)
router.get('/', (req, res) => {
  res.redirect(302, '/today');
});

router.get('/workflow', async (req, res, next) => {
  try {
    const all = await dbService.getAllLeads(req.workspaceId);
    const leads = filterLeadsForRequest(req, all);
    const stageRows = await pipelineStagesService.ensureWorkspaceStagesSeeded(req.workspaceId);
    const sorted = [...stageRows].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
    const stages = sorted.map((s, i) => ({
      id: i + 1,
      key: s.key,
      name: s.name,
      color: s.color,
      stageUuid: s.id,
      summary: (s.description && String(s.description).trim()) || '—',
    }));
    const counts = {};
    for (let i = 1; i <= sorted.length; i += 1) counts[i] = 0;
    leads.forEach((l) => {
      const ps =
        typeof l.pipelineStage === 'number' && l.pipelineStage >= 1 && l.pipelineStage <= sorted.length
          ? l.pipelineStage
          : 1;
      counts[ps] += 1;
    });
    res.render('sales-workflow', {
      title: 'Pipeline workflow',
      activePage: 'sales',
      activeSales: 'workflow',
      stages,
      leads,
      counts,
    });
  } catch (e) {
    next(e);
  }
});

router.post('/workflow/stage', express.urlencoded({ extended: true }), async (req, res, next) => {
  try {
    const { leadKey, pipelineStage } = req.body;
    if (!leadKey) return res.redirect('/sales/workflow');
    const key = leadKey.startsWith('lead:') ? leadKey : `lead:${leadKey}`;
    const wid = req.workspaceId;
    const stageRows = await pipelineStagesService.listStages(wid);
    const sorted = [...stageRows].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
    const n = sorted.length || 1;
    const stage = Math.min(n, Math.max(1, parseInt(pipelineStage, 10) || 1));
    const existing = await dbService.getLead(key);
    const sid = sorted[stage - 1] ? sorted[stage - 1].id : null;
    const patch = sid && existing ? pipelineStagesService.patchLeadStageFields(existing, sorted, sid) : { pipelineStage: stage };
    await dbService.updateLead(
      key,
      {
        ...patch,
        pipelineStageUpdatedAt: new Date().toISOString(),
      },
      wid
    );
    if (stage >= 2) {
      await activationService.recordEvent(userEmail(req), 'pipeline_advanced');
    }
    res.redirect('/sales/workflow');
  } catch (e) {
    next(e);
  }
});

router.post('/workflow/cqi', express.urlencoded({ extended: true }), async (req, res, next) => {
  try {
    const { leadKey, monthlyRevenue, marketingSpend, cqiNotes } = req.body;
    if (!leadKey) return res.redirect('/sales/workflow');
    const key = leadKey.startsWith('lead:') ? leadKey : `lead:${leadKey}`;
    await dbService.updateLead(key, {
      cqi: {
        monthlyRevenue: (monthlyRevenue || '').trim(),
        marketingSpend: (marketingSpend || '').trim(),
        notes: (cqiNotes || '').trim(),
        recordedAt: new Date().toISOString(),
      },
    });
    res.redirect('/sales/workflow');
  } catch (e) {
    next(e);
  }
});

router.get('/tracker', async (req, res, next) => {
  try {
    const email = userEmail(req);
    const today = new Date().toISOString().slice(0, 10);
    const todayRow = await dbService.getDailyTracker(req.workspaceId, email, today);
    const history = await dbService.listDailyTrackers(req.workspaceId, email, 14);
    const history60 = await dbService.listDailyTrackers(req.workspaceId, email, 62);
    const allLeads = await dbService.getAllLeads(req.workspaceId);
    const leadsScoped = filterLeadsForRequest(req, allLeads);
    const chartSeries = buildDailyChartDisplaySeries(today, history, 14, leadsScoped);
    const streak = computeOutreachStreakWithLeads(history60, today, leadsScoped);
    const checklistWeek = enrichRollupWithLeadInference(buildDayRollup(today, history60, 7), leadsScoped);
    const checklistMonth = enrichRollupWithLeadInference(buildDayRollup(today, history60, 30), leadsScoped);
    const outreachCoach = await buildOutreachCoachSnapshot(req);
    const trackerInferred = inferDailyTouchCountsFromLeads(leadsScoped, today);
    const trackerDisplayToday = displayTouchTotalsForDay(todayRow || null, leadsScoped, today);
    res.render('sales-tracker', {
      title: 'Daily Action Tracker',
      activePage: 'sales',
      activeSales: 'tracker',
      trackerReturnTo: '/sales/tracker',
      today,
      todayRow: todayRow || {
        coldEmails: 0,
        coldDms: 0,
        coldCalls: 0,
        upworkBids: 0,
        socialPosts: 0,
        adCreatives: 0,
        notes: '',
        callNotes: '',
      },
      history,
      chartSeries,
      streak,
      checklistWeek,
      checklistMonth,
      outreachCoach,
      trackerInferred,
      trackerDisplayToday,
    });
  } catch (e) {
    next(e);
  }
});

router.post('/tracker', express.urlencoded({ extended: true }), async (req, res, next) => {
  try {
    const email = userEmail(req);
    const dateStr = (req.body.date || new Date().toISOString().slice(0, 10)).slice(0, 10);
    const allLeads = await dbService.getAllLeads(req.workspaceId);
    const leadsScoped = filterLeadsForRequest(req, allLeads);
    const inferred = inferDailyTouchCountsFromLeads(leadsScoped, dateStr);
    const safeNum = (v) => parseInt(v, 10) || 0;
    const merged = {
      coldEmails: Math.max(safeNum(req.body.coldEmails), inferred.coldEmails || 0),
      coldDms: Math.max(safeNum(req.body.coldDms), inferred.coldDms || 0),
      coldCalls: Math.max(safeNum(req.body.coldCalls), inferred.coldCalls || 0),
      upworkBids: Math.max(safeNum(req.body.upworkBids), inferred.upworkBids || 0),
      socialPosts: Math.max(safeNum(req.body.socialPosts), inferred.socialPosts || 0),
      adCreatives: Math.max(safeNum(req.body.adCreatives), inferred.adCreatives || 0),
    };
    await dbService.saveDailyTracker(req.workspaceId, email, dateStr, {
      coldEmails: merged.coldEmails,
      coldDms: merged.coldDms,
      coldCalls: merged.coldCalls,
      upworkBids: merged.upworkBids,
      socialPosts: merged.socialPosts,
      adCreatives: merged.adCreatives,
      notes: req.body.notes || '',
      callNotes: req.body.callNotes || '',
    });
    const touches =
      merged.coldEmails +
      merged.coldDms +
      merged.coldCalls +
      merged.upworkBids +
      merged.socialPosts +
      merged.adCreatives;
    if (touches > 0) {
      await activationService.recordEvent(email, 'outreach_logged');
    }
    const returnTo = (req.body.returnTo || '').toString().trim();
    const dest = (() => {
      if (['/sales/tracker', '/reports', '/analytics', '/outreach?tab=touches', '/prospecting?tab=queue'].includes(returnTo)) return returnTo;
      if (returnTo.startsWith('/reports?') || returnTo.startsWith('/analytics?')) {
        try {
          const u = new URL(returnTo, 'http://localhost');
          if (u.pathname === '/reports' || u.pathname === '/analytics') return returnTo.replace(/^\/analytics/, '/reports');
        } catch {
          /* fall through */
        }
      }
      return '/sales/tracker';
    })();
    res.redirect(302, dest);
  } catch (e) {
    next(e);
  }
});

router.get('/personas', async (req, res, next) => {
  try {
    const ws = await dbService.getWorkspace(req.workspaceId);
    const scriptServiceLabels = Object.fromEntries(
      SCRIPT_LIBRARY_KEYS.map((k) => [k, SCRIPT_LIBRARY[k].label])
    );
    const SCRIPT_LIBRARY_MERGED = salesScriptsStorage.buildMergedScriptLibrary(ws, SCRIPT_LIBRARY);
    const initialScriptLibraryItems = salesScriptsStorage.getInitialLibraryItemsFromWorkspace(ws);
    res.render('sales-personas', {
      title: 'Sales scripts',
      activePage: 'sales',
      activeSales: 'personas',
      SCRIPT_LIBRARY: SCRIPT_LIBRARY_MERGED,
      SCRIPT_LIBRARY_KEYS,
      scriptServiceLabels,
      initialScriptLibraryItems,
      PERSONAS,
    });
  } catch (e) {
    next(e);
  }
});

const SCRIPT_SECTIONS = ['opening', 'discovery', 'valueProp', 'objectionHandling', 'close'];
const SECTION_LABELS = {
  opening: 'Opening',
  discovery: 'Discovery',
  valueProp: 'Value proposition',
  objectionHandling: 'Objection handling',
  close: 'Close',
};

/** POST JSON: refine script via LLM (multi-turn optional). */
router.post('/scripts/refine', async (req, res, next) => {
  try {
    const body = req.body || {};
    const serviceKey = typeof body.serviceKey === 'string' ? body.serviceKey.trim() : '';
    const section = typeof body.section === 'string' ? body.section.trim() : '';
    const scriptText = typeof body.scriptText === 'string' ? body.scriptText : '';
    const userMessage = typeof body.userMessage === 'string' ? body.userMessage.trim() : '';
    const history = Array.isArray(body.chatHistory) ? body.chatHistory : [];

    if (!SCRIPT_LIBRARY_KEYS.includes(serviceKey)) {
      return res.status(400).json({ success: false, error: 'Invalid serviceKey' });
    }
    if (!SCRIPT_SECTIONS.includes(section)) {
      return res.status(400).json({ success: false, error: 'Invalid section' });
    }
    if (!userMessage) {
      return res.status(400).json({ success: false, error: 'userMessage is required' });
    }

    const meta = SCRIPT_LIBRARY[serviceKey];
    const sectionLabel = SECTION_LABELS[section];

    const trimmedHistory = history
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .slice(-12)
      .map((m) => ({ role: m.role, content: m.content.slice(0, 8000) }));

    const messages = [
      {
        role: 'system',
        content: `You are a sales script coach for an agency selling: ${meta.label}.

The rep is editing the "${sectionLabel}" part of a call or email script. Preserve merge tags like {{name}}, {{city}}, {{company}} when they appear unless the user asks to change them.

Respond with JSON only, no markdown:
{"reply":"1-3 sentences: coaching, questions, or confirmation","refinedScript":null or "full replacement script text for this section only"}

Rules:
- Put a complete rewritten script in refinedScript only when the user asked for a rewrite, new version, shorter/longer version, tone change, or similar. Otherwise refinedScript must be null.
- Escape any double quotes inside refinedScript as \\" in the JSON string.
- Keep refinedScript as plain prose the rep can paste — no bullet labels like "OPENING:" unless the user asked.`,
      },
    ];

    const scriptCtx = `Current script (${sectionLabel}) — this is the latest text for this section:\n\n${scriptText.slice(0, 12000)}`;
    if (trimmedHistory.length === 0) {
      messages.push({
        role: 'user',
        content: `${scriptCtx}\n\n---\nRequest:\n${userMessage.slice(0, 4000)}`,
      });
    } else {
      messages.push({ role: 'user', content: scriptCtx });
      for (const turn of trimmedHistory) {
        messages.push({ role: turn.role, content: turn.content });
      }
      messages.push({ role: 'user', content: userMessage.slice(0, 4000) });
    }

    const ai = await chatCompletion({
      messages,
      jsonObject: true,
      max_tokens: 900,
      temperature: 0.45,
    });

    if (!ai.content || ai.error) {
      return res.json({
        success: false,
        error:
          'No AI provider configured (set KIE_AI_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY) or request failed.',
      });
    }

    let parsed;
    try {
      parsed = JSON.parse(ai.content);
    } catch {
      return res.json({ success: false, error: 'Invalid AI response' });
    }

    const reply = typeof parsed.reply === 'string' ? parsed.reply : '';
    let refinedScript = parsed.refinedScript;
    if (refinedScript != null && typeof refinedScript !== 'string') refinedScript = null;

    return res.json({
      success: true,
      reply: reply || 'Here is an updated take.',
      refinedScript: refinedScript && refinedScript.trim() ? refinedScript.trim() : null,
      provider: ai.provider || 'unknown',
    });
  } catch (e) {
    next(e);
  }
});

/** GET SSE: prospecting coach stream (EventSource). Cached brief returns instantly. ?force=1 skips cache. */
router.get('/outreach-coach/stream', async (req, res, next) => {
  try {
    const force = req.query.force === '1';
    const wid = req.workspaceId;
    const ws = await dbService.getWorkspace(wid);
    const ymd = workspaceTodayYmd(ws);

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    if (typeof res.flushHeaders === 'function') res.flushHeaders();

    const writeEv = (event, data) => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    writeEv('ping', { t: Date.now() });

    if (!force) {
      const cached = await getCoachBriefForToday(dbService, wid, ymd);
      if (cached) {
        writeEv('complete', {
          success: true,
          headline: cached.headline,
          body: cached.body,
          focusToday: cached.focusToday,
          actions: cached.actions,
          provider: cached.provider,
          snapshot: cached.snapshot,
          cached: true,
        });
        res.end();
        return;
      }
    } else {
      await clearCoachBrief(dbService, wid, ymd);
    }

    const result = await generateOutreachCoachPayload(req);
    if (!result.success) {
      writeEv('error', {
        success: false,
        error: result.error || 'Coach failed',
        actions: result.actions || [],
        snapshot: result.snapshot,
      });
      res.end();
      return;
    }

    const bodyText = result.body || '';
    const parts = bodyText.split(/(\s+)/);
    for (const p of parts) {
      if (p) writeEv('token', { d: p });
    }

    const payload = {
      success: true,
      headline: result.headline,
      body: result.body,
      focusToday: result.focusToday,
      actions: result.actions,
      provider: result.provider,
      snapshot: result.snapshot,
      cached: false,
    };
    await persistCoachBrief(dbService, wid, ymd, payload);
    writeEv('complete', payload);
    res.end();
  } catch (e) {
    next(e);
  }
});

/** POST JSON: AI prospecting coach (non-streaming). Fills daily cache if empty. */
router.post('/outreach-coach', async (req, res, next) => {
  try {
    const accept = String(req.headers.accept || '');
    if (accept.includes('text/event-stream')) {
      res.setHeader('Content-Type', 'application/json');
      return res.status(400).json({
        success: false,
        error: 'Use GET /sales/outreach-coach/stream for Server-Sent Events.',
      });
    }

    const wid = req.workspaceId;
    const ws = await dbService.getWorkspace(wid);
    const ymd = workspaceTodayYmd(ws);

    const result = await generateOutreachCoachPayload(req);
    if (result.success) {
      const existing = await getCoachBriefForToday(dbService, wid, ymd);
      if (!existing) {
        await persistCoachBrief(dbService, wid, ymd, {
          success: true,
          headline: result.headline,
          body: result.body,
          focusToday: result.focusToday,
          actions: result.actions,
          provider: result.provider,
          snapshot: result.snapshot,
        });
      }
    }

    if (!result.success) {
      return res.json({
        success: false,
        error: result.error,
        snapshot: result.snapshot,
        actions: result.actions,
      });
    }

    return res.json({
      success: true,
      headline: result.headline,
      body: result.body,
      focusToday: result.focusToday,
      actions: result.actions,
      provider: result.provider,
      snapshot: result.snapshot,
    });
  } catch (e) {
    next(e);
  }
});

/** POST /sales/draft-outreach — Focus Mode copy (stub templates; replace with LLM later). */
router.post('/draft-outreach', async (req, res, next) => {
  try {
    const rawId = String((req.body && req.body.leadId) || '')
      .trim()
      .replace(/^lead:/i, '');
    let channel = String((req.body && req.body.channel) || 'email')
      .trim()
      .toLowerCase();
    if (!rawId) {
      return res.status(400).json({ success: false, error: 'leadId required' });
    }
    const allowed = new Set(['email', 'dm', 'call-script', 'objection-handling']);
    if (!allowed.has(channel)) channel = 'email';

    const all = await dbService.getAllLeads(req.workspaceId);
    const visible = filterLeadsForRequest(req, all);
    const lead = visible.find((l) => {
      const k = String(l.key || '').trim();
      const short = k.startsWith('lead:') ? k.slice(5) : k;
      return short === rawId || k === `lead:${rawId}` || k === rawId;
    });
    if (!lead) {
      return res.status(404).json({ success: false, error: 'Lead not found' });
    }

    // TODO: wire to LLM
    const company = String(lead.title || 'your team').trim() || 'your team';
    const em = String(lead.email || '').trim();
    const contact =
      String(lead.contactName || '').trim() ||
      (em && em.includes('@') ? em.split('@')[0].replace(/[._]+/g, ' ') : '') ||
      'there';
    const city = [lead.city, lead.state].filter(Boolean).join(', ');
    const loc = city ? ` in ${city}` : '';
    const ws = await dbService.getWorkspace(req.workspaceId);
    const mergedLibrary = salesScriptsStorage.buildMergedScriptLibrary(ws, SCRIPT_LIBRARY);
    const leadServiceKey = String(lead.primaryServiceKey || '').trim();
    const fallbackServiceKey = SCRIPT_LIBRARY_KEYS[0];
    const serviceKey = SCRIPT_LIBRARY_KEYS.includes(leadServiceKey) ? leadServiceKey : fallbackServiceKey;
    const objectionText =
      mergedLibrary &&
      mergedLibrary[serviceKey] &&
      typeof mergedLibrary[serviceKey].objectionHandling === 'string'
        ? mergedLibrary[serviceKey].objectionHandling.trim()
        : '';

    let subject = '';
    let body = '';
    if (channel === 'email') {
      subject = `Quick idea for ${company}`;
      body = `Hi ${contact},\n\nI noticed ${company}${loc} and wanted to reach out with a quick thought on how you're getting in front of local demand.\n\nIf you're open to it, reply with the best email for your team and I'll share one concrete suggestion.\n\nThanks,\n`;
    } else if (channel === 'dm') {
      body = `Hey ${contact} — ${company} caught my eye${loc}. Open to a quick DM swap? Happy to share one thing that's working for similar shops (no pitch dump).`;
    } else if (channel === 'objection-handling') {
      body =
        objectionText ||
        `Objection: "We're good for now."\nResponse: Totally fair. Most teams we help were already getting leads, but wanted better consistency week to week.\n\nObjection: "No budget."\nResponse: Understood. If helpful, I can outline a low-lift starting point so you can gauge ROI before committing.`;
    } else {
      body = `[Opener] Hi, this is ___ calling for ${contact} at ${company}. Did I catch you at an okay time?\n\n[Bridge] I work with local businesses on filling the calendar — noticed you online${loc}.\n\n[Ask] If it makes sense, who handles marketing day-to-day?`;
    }

    res.json({ success: true, subject, body });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
