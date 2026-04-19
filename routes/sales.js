const express = require('express');
const router = express.Router();
const dbService = require('../services/database');
const { PIPELINE_STAGES, SCRIPT_LIBRARY, SCRIPT_LIBRARY_KEYS, PERSONAS } = require('../services/salesConstants');
const { chatCompletion } = require('../services/llmClient');
const { computeOutreachStreak, buildDailyChartSeries, buildDayRollup } = require('../services/trackerStats');
const activationService = require('../services/activationService');
const { filterLeadsForRequest, userEmail } = require('../services/workspaceService');
const { buildOutreachCoachSnapshot } = require('../services/outreachCoachSnapshot');

// Legacy Command Center URL → Today (hub lives at GET /today)
router.get('/', (req, res) => {
  res.redirect(302, '/today');
});

router.get('/workflow', async (req, res, next) => {
  try {
    const all = await dbService.getAllLeads();
    const leads = filterLeadsForRequest(req, all);
    const counts = {};
    for (let i = 1; i <= 10; i += 1) counts[i] = 0;
    leads.forEach((l) => {
      const ps =
        typeof l.pipelineStage === 'number' && l.pipelineStage >= 1 && l.pipelineStage <= 10
          ? l.pipelineStage
          : 1;
      counts[ps] += 1;
    });
    res.render('sales-workflow', {
      title: '10-Stage Workflow',
      activePage: 'sales',
      activeSales: 'workflow',
      stages: PIPELINE_STAGES,
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
    const stage = Math.min(10, Math.max(1, parseInt(pipelineStage, 10) || 1));
    await dbService.updateLead(key, {
      pipelineStage: stage,
      pipelineStageUpdatedAt: new Date().toISOString(),
    });
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
    const todayRow = await dbService.getDailyTracker(email, today);
    const history = await dbService.listDailyTrackers(email, 14);
    const history60 = await dbService.listDailyTrackers(email, 62);
    const chartSeries = buildDailyChartSeries(today, history, 14);
    const streak = computeOutreachStreak(history60, today);
    const checklistWeek = buildDayRollup(today, history60, 7);
    const checklistMonth = buildDayRollup(today, history60, 30);
    const outreachCoach = await buildOutreachCoachSnapshot(req);
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
        notes: '',
        callNotes: '',
      },
      history,
      chartSeries,
      streak,
      checklistWeek,
      checklistMonth,
      outreachCoach,
    });
  } catch (e) {
    next(e);
  }
});

router.post('/tracker', express.urlencoded({ extended: true }), async (req, res, next) => {
  try {
    const email = userEmail(req);
    const dateStr = (req.body.date || new Date().toISOString().slice(0, 10)).slice(0, 10);
    await dbService.saveDailyTracker(email, dateStr, {
      coldEmails: parseInt(req.body.coldEmails, 10) || 0,
      coldDms: parseInt(req.body.coldDms, 10) || 0,
      coldCalls: parseInt(req.body.coldCalls, 10) || 0,
      upworkBids: parseInt(req.body.upworkBids, 10) || 0,
      notes: req.body.notes || '',
      callNotes: req.body.callNotes || '',
    });
    const touches =
      (parseInt(req.body.coldEmails, 10) || 0) +
      (parseInt(req.body.coldDms, 10) || 0) +
      (parseInt(req.body.coldCalls, 10) || 0) +
      (parseInt(req.body.upworkBids, 10) || 0);
    if (touches > 0) {
      await activationService.recordEvent(email, 'outreach_logged');
    }
    const returnTo = (req.body.returnTo || '').toString().trim();
    const allowed = new Set(['/sales/tracker', '/outreach?tab=touches']);
    const dest = allowed.has(returnTo) ? returnTo : '/sales/tracker';
    res.redirect(302, dest);
  } catch (e) {
    next(e);
  }
});

router.get('/personas', (req, res) => {
  const scriptServiceLabels = Object.fromEntries(
    SCRIPT_LIBRARY_KEYS.map((k) => [k, SCRIPT_LIBRARY[k].label])
  );
  res.render('sales-personas', {
    title: 'AI Personas & Scripts',
    activePage: 'sales',
    activeSales: 'personas',
    SCRIPT_LIBRARY,
    SCRIPT_LIBRARY_KEYS,
    scriptServiceLabels,
    PERSONAS,
  });
});

const SCRIPT_SECTIONS = ['opening', 'discovery', 'valueProp', 'close'];
const SECTION_LABELS = {
  opening: 'Opening',
  discovery: 'Discovery',
  valueProp: 'Value proposition',
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

/** POST JSON: AI prospecting coach from live pipeline + tracker snapshot. */
router.post('/outreach-coach', async (req, res, next) => {
  try {
    const snapshot = await buildOutreachCoachSnapshot(req);
    const { entrepreneurQuote, firstName, stageBreakdown } = snapshot;

    const ai = await chatCompletion({
      messages: [
        {
          role: 'system',
          content: `You are an energetic but professional sales coach for an agency founder using Agency OS. Your job is to motivate daily prospecting using ONLY the JSON snapshot provided — pipeline stage counts, opportunity tiers, streak, touches vs goal, warm inbound count, overdue sequences, and reply signals.

Rules:
- Reference real numbers from the snapshot (e.g. leads in New/Contacted, high-opportunity count). Do not invent metrics.
- Tie the message to growth: pipeline hygiene, booking calls, working high-opportunity leads first, clearing overdue follow-ups.
- In "body", write 2 short paragraphs (plain text, no markdown). Paragraph 1: situational coaching from the data. Paragraph 2: connect the spirit of the provided entrepreneur quote to today's work (name the author once).
- Do not fabricate additional famous quotes — only discuss the one given in entrepreneurQuote.
- Tone: direct, optimistic, anti-procrastination.

Respond with JSON only:
{"headline":"max 8 words","body":"two paragraphs separated by \\n\\n","focusToday":"one imperative sentence","actions":["three very short next steps, max 8 words each"]}`,
        },
        {
          role: 'user',
          content: JSON.stringify({
            coachFor: firstName,
            snapshot,
            entrepreneurQuote,
            stageNamesForReference: stageBreakdown.map((s) => `${s.id}. ${s.name}: ${s.count}`),
          }),
        },
      ],
      jsonObject: true,
      max_tokens: 650,
      temperature: 0.5,
    });

    if (!ai.content || ai.error) {
      return res.json({
        success: false,
        error:
          'No AI provider configured (set KIE_AI_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY) or request failed.',
        snapshot,
      });
    }

    let parsed;
    try {
      parsed = JSON.parse(ai.content);
    } catch {
      return res.json({ success: false, error: 'Invalid AI response', snapshot });
    }

    const headline = typeof parsed.headline === 'string' ? parsed.headline.trim() : '';
    const body = typeof parsed.body === 'string' ? parsed.body.trim() : '';
    const focusToday = typeof parsed.focusToday === 'string' ? parsed.focusToday.trim() : '';
    let actions = Array.isArray(parsed.actions) ? parsed.actions.filter((x) => typeof x === 'string') : [];
    actions = actions.slice(0, 3);

    return res.json({
      success: true,
      headline: headline || 'Keep the pipeline moving',
      body: body || '',
      focusToday,
      actions,
      provider: ai.provider || 'unknown',
      snapshot,
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
