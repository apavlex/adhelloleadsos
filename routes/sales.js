const express = require('express');
const router = express.Router();
const dbService = require('../services/database');
const { SCRIPT_LIBRARY, SCRIPT_LIBRARY_KEYS, PERSONAS } = require('../services/salesConstants');
const pipelineStagesService = require('../services/pipelineStagesService');
const { chatCompletion, parseLlmJson } = require('../services/llmClient');
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
const { filterBusinessPipelineLeads } = require('../services/leadListFilters');
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
const {
  ARMS_REACH_FACEBOOK_SEEDS,
  ARMS_REACH_REFERRAL_SEED,
  ARMS_REACH_DEFAULT_OWNER_PLACEHOLDER,
  ARMS_REACH_DEFAULT_REFERRER_PLACEHOLDER,
} = require('../config/armsReachScripts');
const {
  regenerateArmsReachFacebookPost,
  regenerateArmsReachReferralMessage,
} = require('../services/armsReachScriptAi');
const { UPWORK_PROPOSAL_SERVICES } = require('../config/upworkProposalServices');
const { generateUpworkProposal } = require('../services/upworkProposalAi');
const {
  normalizeUpworkProposal,
  getUpworkProposalsFromWorkspace,
  trimProposalList,
} = require('../services/upworkProposalStorage');
const { CARS_REACH_SPECIALTIES } = require('../config/carsReachScripts');
const { generateCarsReachScript } = require('../services/carsReachScriptAi');

async function buildPersonasViewData(req) {
  const ws = await dbService.getWorkspace(req.workspaceId);
  const scriptServiceLabels = Object.fromEntries(
    SCRIPT_LIBRARY_KEYS.map((k) => [k, SCRIPT_LIBRARY[k].label]),
  );
  const SCRIPT_LIBRARY_MERGED = salesScriptsStorage.buildMergedScriptLibrary(ws, SCRIPT_LIBRARY);
  const initialScriptLibraryItems = salesScriptsStorage.getInitialLibraryItemsFromWorkspace(ws);
  const upworkSavedProposals = getUpworkProposalsFromWorkspace(ws);
  return {
    SCRIPT_LIBRARY: SCRIPT_LIBRARY_MERGED,
    SCRIPT_LIBRARY_KEYS,
    scriptServiceLabels,
    initialScriptLibraryItems,
    PERSONAS,
    armsReachFacebookSeeds: ARMS_REACH_FACEBOOK_SEEDS,
    armsReachReferralSeed: ARMS_REACH_REFERRAL_SEED,
    armsReachDefaultOwner: ARMS_REACH_DEFAULT_OWNER_PLACEHOLDER,
    armsReachDefaultReferrer: ARMS_REACH_DEFAULT_REFERRER_PLACEHOLDER,
    upworkProposalServices: UPWORK_PROPOSAL_SERVICES,
    upworkSavedProposals,
    carsReachSpecialties: CARS_REACH_SPECIALTIES,
  };
}

async function renderPersonasTab(req, res, activeScriptsTab) {
  const data = await buildPersonasViewData(req);
  res.render('sales-personas', {
    title: 'Sales scripts',
    activePage: 'sales',
    activeSales: 'personas',
    activeScriptsTab,
    ...data,
  });
}

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
      if (['/sales/tracker', '/reports', '/analytics', '/today', '/outreach?tab=touches', '/prospecting?tab=queue'].includes(returnTo)) {
        return returnTo === '/today' ? '/today?trackerSaved=1' : returnTo;
      }
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

router.get('/personas', (req, res) => {
  res.type('html').send(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Redirecting…</title></head><body><script>
(function(){var m={'arms-reach':1,'computers-reach':1,'cars-reach':1,'offers':1};var h=(location.hash||'').replace(/^#/,'');location.replace('/sales/personas/'+(m[h]?h:'arms-reach'));})();
</script></body></html>`);
});

router.get('/personas/arms-reach', async (req, res, next) => {
  try {
    await renderPersonasTab(req, res, 'arms-reach');
  } catch (e) {
    next(e);
  }
});

router.get('/personas/computers-reach', async (req, res, next) => {
  try {
    await renderPersonasTab(req, res, 'computers-reach');
  } catch (e) {
    next(e);
  }
});

router.get('/personas/cars-reach', async (req, res, next) => {
  try {
    await renderPersonasTab(req, res, 'cars-reach');
  } catch (e) {
    next(e);
  }
});

router.get('/personas/offers', async (req, res, next) => {
  try {
    await renderPersonasTab(req, res, 'offers');
  } catch (e) {
    next(e);
  }
});

router.get('/personas/:tab', (req, res) => {
  res.redirect(302, '/sales/personas/arms-reach');
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
          'No AI provider configured (set OPENROUTER_API_KEY) or request failed.',
      });
    }

    const parsed = parseLlmJson(ai.content);
    if (!parsed) {
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

/** POST JSON: regenerate Arm's Reach Facebook post variation. */
router.post('/arms-reach/regenerate-facebook', express.json({ limit: '64kb' }), async (req, res, next) => {
  try {
    const body = req.body || {};
    const currentText = typeof body.currentText === 'string' ? body.currentText : '';
    const versionLabel = typeof body.versionLabel === 'string' ? body.versionLabel.trim() : '';
    const result = await regenerateArmsReachFacebookPost(currentText, versionLabel);
    return res.json(result);
  } catch (e) {
    next(e);
  }
});

/** POST JSON: regenerate Arm's Reach referral follow-up message. */
router.post('/arms-reach/regenerate-referral', express.json({ limit: '64kb' }), async (req, res, next) => {
  try {
    const body = req.body || {};
    const ownerName = typeof body.ownerName === 'string' ? body.ownerName : '';
    const referrerName = typeof body.referrerName === 'string' ? body.referrerName : '';
    const currentText = typeof body.currentText === 'string' ? body.currentText : '';
    const result = await regenerateArmsReachReferralMessage(ownerName, referrerName, currentText);
    return res.json(result);
  } catch (e) {
    next(e);
  }
});

/** POST JSON: generate Upwork proposal (Computer's Reach). */
router.post('/computers-reach/upwork/generate', express.json({ limit: '128kb' }), async (req, res, next) => {
  try {
    const body = req.body || {};
    const result = await generateUpworkProposal({
      jobTitle: body.jobTitle,
      jobDescription: body.jobDescription,
      serviceKey: body.serviceKey,
      experience: body.experience,
      regenerate: !!body.regenerate,
      currentProposal: body.currentProposal,
    });
    return res.json(result);
  } catch (e) {
    next(e);
  }
});

/** POST JSON: save Upwork proposal to workspace. */
router.post('/computers-reach/upwork/save', express.json({ limit: '256kb' }), async (req, res, next) => {
  try {
    const wid = req.workspaceId;
    let ws = (await dbService.getWorkspace(wid)) || { id: wid, members: {} };
    const item = normalizeUpworkProposal(req.body || {});
    if (!item) return res.status(400).json({ success: false, error: 'Proposal text required.' });
    const cur = trimProposalList([...(getUpworkProposalsFromWorkspace(ws)), item]);
    ws.upworkSavedProposals = cur;
    ws.upworkProposalsUpdatedAt = new Date().toISOString();
    await dbService.saveWorkspace(wid, ws);
    res.json({ success: true, item, proposals: cur });
  } catch (e) {
    next(e);
  }
});

/** DELETE: remove saved Upwork proposal. */
router.delete('/computers-reach/upwork/saved/:id', async (req, res, next) => {
  try {
    const wid = req.workspaceId;
    let ws = (await dbService.getWorkspace(wid)) || { id: wid, members: {} };
    const id = String(req.params.id || '').trim();
    const cur = getUpworkProposalsFromWorkspace(ws);
    const nextItems = cur.filter((x) => x && String(x.id) !== id);
    if (nextItems.length === cur.length) {
      return res.status(404).json({ success: false, error: 'Not found.' });
    }
    ws.upworkSavedProposals = nextItems;
    ws.upworkProposalsUpdatedAt = new Date().toISOString();
    await dbService.saveWorkspace(wid, ws);
    res.json({ success: true, proposals: nextItems });
  } catch (e) {
    next(e);
  }
});

/** POST JSON: generate Car's Reach networking script (elevator, follow-up, appointment). */
router.post('/cars-reach/generate', express.json({ limit: '64kb' }), async (req, res, next) => {
  try {
    const body = req.body || {};
    const result = await generateCarsReachScript({
      scriptType: body.scriptType,
      yourName: body.yourName,
      specialtyKey: body.specialtyKey,
      theirName: body.theirName,
      theirBusinessType: body.theirBusinessType,
      whereMet: body.whereMet,
      suggestedTime: body.suggestedTime,
      regenerate: !!body.regenerate,
      currentScript: body.currentScript,
    });
    return res.json(result);
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
        const snapshot = await buildOutreachCoachSnapshot(req, { businessesOnly: true });
        const allLeads = await dbService.getAllLeads(wid);
        const businessLeads = filterBusinessPipelineLeads(filterLeadsForRequest(req, allLeads));
        const actions = buildNamedCoachActions(businessLeads, snapshot);
        writeEv('complete', {
          success: true,
          headline: cached.headline,
          body: cached.body,
          focusToday: cached.focusToday,
          actions,
          provider: cached.provider,
          snapshot,
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

const FOCUS_SCRIPT_VARIANTS = [
  { id: 'default', label: 'First touch / default' },
  { id: 'followup', label: 'Follow-up' },
  { id: 'reengage', label: 'Re-engagement' },
  { id: 'short', label: 'Short & punchy' },
];

function normalizeFocusScriptVariant(v) {
  const id = String(v || 'default')
    .trim()
    .toLowerCase();
  return FOCUS_SCRIPT_VARIANTS.some((x) => x.id === id) ? id : 'default';
}

function normalizeFocusTone(v) {
  const t = String(v || 'coffee-chat').trim().toLowerCase();
  return t === 'pro' ? 'pro' : 'coffee-chat';
}

function normalizeIncludeCouponLine(v) {
  if (typeof v === 'boolean') return v;
  const s = String(v || '').trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

function applyScriptPlaceholders(text, { contact, company, cityState }) {
  return String(text || '')
    .replace(/\{\{name\}\}/gi, contact)
    .replace(/\{\{company\}\}/gi, company)
    .replace(/\{\{city\}\}/gi, cityState || 'your area');
}

function buildFocusOutreachDraft({
  channel,
  scriptVariant,
  company,
  contact,
  loc,
  cityState,
  objectionText,
  serviceBlock,
  leadSignal,
  tone,
  includeCouponLine,
  couponLink,
}) {
  const v = scriptVariant;
  const svcLabel = (serviceBlock && serviceBlock.label) || 'our services';
  const signal = String(leadSignal || '').trim();
  const coffee = tone === 'coffee-chat';
  const coupon = String(couponLink || '').trim();
  const couponSentence =
    includeCouponLine && coupon
      ? `\n\nIf it helps, I can include a free coffee coupon for your team too: ${coupon}`
      : '';
  let subject = '';
  let body = '';

  if (channel === 'email') {
    if (v === 'followup') {
      subject = `Re: ${company} — quick follow-up`;
      body = signal
        ? `Hey ${contact} — quick follow-up.\n\nStill thinking about this: ${signal}\n\nIf helpful, I can send a no-pressure teardown with the exact fix I'd start with for ${company}.\n\nWant me to send it?\n`
        : (coffee
          ? `Hey ${contact} — quick follow-up on ${company}${loc}.\n\nI still have one simple idea to help convert more local demand into booked work.${couponSentence}\n\nWant me to send the short version?\n`
          : `Hi ${contact},\n\nFollowing up on my last note about ${company}${loc}. I know the inbox is crowded — the short version: we help local businesses turn more of their online visibility into booked work.\n\nWorth a two-line reply on who to loop in?\n\nThanks,\n`);
    } else if (v === 'reengage') {
      subject = `Still relevant for ${company}?`;
      body = signal
        ? `Hey ${contact},\n\nCircling back because this stood out in your pipeline audit: ${signal}\n\nIf now isn't ideal, no worries. If you'd like, I can still send the 2-minute fix plan for ${company} so your team has it.\n`
        : (coffee
          ? `Hey ${contact},\n\nCircling back in case this got buried. I had one practical idea for ${company} in ${cityState || 'your market'} to help drive more calls from search.${couponSentence}\n\nIf timing is off, all good.\n`
          : `Hi ${contact},\n\nCircling back in case this landed in spam — I work with ${company}'s type of business in ${
              cityState || 'the area'
            } on how you show up in search, reviews, and when someone is ready to call now.\n\nIf timing's off, no problem — a quick "not now" helps too.\n\nThanks,\n`);
    } else if (v === 'short') {
      subject = `Quick idea for ${company}`;
      body = signal
        ? `Hey ${contact} — quick one: ${signal}\n\nI mocked a simple fix for ${company}. Want me to send it over?\n`
        : (coffee
          ? `Hey ${contact} — quick one: ${company}${loc} is visible, but most shops leak demand between maps, site, and missed calls.\n\nI can send the top fix we usually start with.${couponSentence}\n`
          : `Hi ${contact} — one quick reason I reached out: ${company}${loc} is visible, but most shops leak demand between maps, site, and missed calls. Happy to share the top fix we see. Reply with a yes/no?\n\nThanks,\n`);
    } else {
      subject = signal ? `${company} — quick thing I noticed` : `Quick idea for ${company}`;
      body = signal
        ? (coffee
          ? `Hey ${contact} — hope your week is going well.\n\nI was reviewing ${company}${loc} and noticed: ${signal}\n\nI put together a free mockup with the fix we’d start with (aligned to ${svcLabel}). If you want, I can send it over.${couponSentence}\n`
          : `Hi ${contact},\n\nI reviewed ${company}${loc} and one issue stood out: ${signal}\n\nI put together a quick mockup showing the fix we would start with (aligned to ${svcLabel}). If useful, I can send it over.\n`)
        : (coffee
          ? `Hey ${contact} — hope your week is going well.\n\nI noticed ${company}${loc} and wanted to share one quick thought on getting in front of more local demand.\n\nIf you're open, I can send one concrete suggestion aligned with ${svcLabel}.${couponSentence}\n`
          : `Hi ${contact},\n\nI noticed ${company}${loc} and wanted to reach out with a quick thought on how you're getting in front of local demand.\n\nIf you're open to it, reply with the best email for your team and I'll share one concrete suggestion — aligned with ${svcLabel}.\n\nThanks,\n`);
    }
  } else if (channel === 'dm' || channel === 'sms') {
    if (v === 'followup') {
      body = channel === 'sms'
        ? (signal
          ? `Hi ${contact} — quick follow-up: ${signal} Want me to text over the fix I mocked for ${company}?`
          : `Hi ${contact} — quick follow-up on ${company}${loc}. I can share one tactical idea that helps similar businesses book more calls. Open to that?`)
        : (signal
          ? `Hey ${contact} — one thing I noticed for ${company}: ${signal} If useful, I can send a simple fix mockup.`
          : `Hey ${contact} — small follow-up on my DM about ${company}${loc}. If you want one tactical tip (no long pitch), I can share what’s working for similar local operators.`);
    } else if (v === 'short') {
      body = channel === 'sms'
        ? `Hi ${contact} — quick thought for ${company}${loc}: one simple fix often increases booked calls. Want the 1-line version?`
        : `Hi ${contact} — re: ${company} in ${cityState || 'your market'}. Open to 1 quick tip that helps similar businesses book more calls?`;
    } else {
      body = channel === 'sms'
        ? (signal
          ? `Hi ${contact}, this is [your name]. Quick note on ${company}: ${signal} I can text the exact fix if helpful.`
          : `Hi ${contact}, this is [your name]. Noticed ${company}${loc} and had one practical idea around ${svcLabel} to capture more ready-to-buy demand. Want me to text it here?`)
        : (signal
          ? `Hey ${contact} — looked at ${company}${loc} and noticed: ${signal} Want me to send the fix I'd start with?`
          : `Hey ${contact} — ${company} caught my eye${loc}. Open to a quick DM swap? Happy to share one thing that's working for similar shops (no pitch dump). (Angle: ${svcLabel}.)`);
    }
  } else if (channel === 'objection-handling') {
    body =
      objectionText ||
      `Objection: "We're good for now."\nResponse: Totally fair. Most teams we help were already getting leads, but wanted better consistency week to week.\n\nObjection: "No budget."\nResponse: Understood. If helpful, I can outline a low-lift starting point so you can gauge ROI before committing.`;
  } else if (channel === 'voicemail') {
    if (v === 'followup') {
      body = `Hi ${contact}, this is ___ with a quick follow-up for ${company}. I left a note about helping with online leads in ${cityState || 'your area'}. If you have sixty seconds, my number is…`;
    } else if (v === 'short' || v === 'reengage') {
      body = `Hey ${contact}, it's ___ for ${company}. I help local businesses with ${svcLabel} — a quick callback would go a long way. Thanks!`;
    } else {
      body = `Hi ${contact}, this is ___ — I'm reaching out to ${company}${loc} about one practical way to capture more of the people already looking for you online. I’ll send a short follow-up, but a live conversation works best. My number is [your #]. Thank you!`;
    }
  } else {
    const libOpen = serviceBlock && serviceBlock.opening
      ? applyScriptPlaceholders(serviceBlock.opening, { contact, company, cityState })
      : '';
    if (v === 'followup') {
      body = `[Opener] Hi, this is ___ for ${contact} at ${company}. I tried you briefly — is now any better for a 30-second reason I called${loc}?\n\n[Bridge] Quick context: I help local service businesses with ${svcLabel}.\n\n[Ask] If you're the right person, is there a better time today I could try you back?`;
    } else if (v === 'reengage' || v === 'short') {
      body = `[Opener] Hi, calling ${contact} at ${company} — I’m ___. Two sentences: I help with ${svcLabel} for shops in ${cityState || 'this market'}.\n\n[Ask] Who would I talk to about growth or marketing ?`;
    } else if (libOpen) {
      body = `Recommended angle: ${svcLabel}\n\n[Opener] ${libOpen}\n\n[Bridge] I work with local businesses on filling the calendar and noticed you online${loc}.\n\n[Ask] Did I catch you at an okay time, or is there a better 5-minute block later?`;
    } else {
      body = `[Opener] Hi, this is ___ calling for ${contact} at ${company}. Did I catch you at an okay time?\n\n[Bridge] I work with local businesses on filling the calendar — noticed you online${loc} (focus: ${svcLabel}).\n\n[Ask] If it makes sense, who handles marketing day-to-day?`;
    }
  }

  return { subject, body };
}

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
    const allowed = new Set(['email', 'dm', 'sms', 'call-script', 'objection-handling', 'voicemail']);
    if (!allowed.has(channel)) channel = 'email';
    const scriptVariant = normalizeFocusScriptVariant(
      (req.body && req.body.scriptVariant) || 'default',
    );
    const tone = normalizeFocusTone((req.body && req.body.tone) || 'coffee-chat');
    const includeCouponLine = normalizeIncludeCouponLine(
      req.body && Object.prototype.hasOwnProperty.call(req.body, 'includeCouponLine')
        ? req.body.includeCouponLine
        : true
    );

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

    const company = String(lead.title || 'your team').trim() || 'your team';
    const em = String(lead.email || '').trim();
    const contact =
      String(lead.contactName || '').trim() ||
      (em && em.includes('@') ? em.split('@')[0].replace(/[._]+/g, ' ') : '') ||
      'there';
    const city = [lead.city, lead.state].filter(Boolean).join(', ');
    const loc = city ? ` in ${city}` : '';
    const cityState = city;
    const ws = await dbService.getWorkspace(req.workspaceId);
    const mergedLibrary = salesScriptsStorage.buildMergedScriptLibrary(ws, SCRIPT_LIBRARY);
    const leadServiceKey = String(lead.primaryServiceKey || '').trim();
    const fallbackServiceKey = SCRIPT_LIBRARY_KEYS[0];
    const recommendedKey = SCRIPT_LIBRARY_KEYS.includes(leadServiceKey) ? leadServiceKey : fallbackServiceKey;
    const requestedRaw = String((req.body && req.body.serviceKey) || '').trim();
    const requestedLower = requestedRaw.toLowerCase();
    const normalizedRequested = SCRIPT_LIBRARY_KEYS.find(
      (k) => k.toLowerCase() === requestedLower,
    );
    const useAuto =
      !requestedRaw ||
      requestedLower === 'auto' ||
      requestedLower === 'recommended' ||
      requestedLower === 'default_recommended';
    const selectedKey =
      !useAuto && normalizedRequested ? normalizedRequested : recommendedKey;
    const serviceKey = selectedKey;
    const serviceBlock = mergedLibrary && mergedLibrary[serviceKey] ? mergedLibrary[serviceKey] : null;
    const recommendedBlock = mergedLibrary[recommendedKey] ? mergedLibrary[recommendedKey] : null;
    const recommendedProduct = {
      key: recommendedKey,
      label: (recommendedBlock && recommendedBlock.label) || recommendedKey,
      tabLabel: (recommendedBlock && recommendedBlock.tabLabel) || recommendedKey,
    };
    const productOptions = SCRIPT_LIBRARY_KEYS.map((k) => {
      const row = mergedLibrary && mergedLibrary[k] ? mergedLibrary[k] : null;
      return {
        key: k,
        label: (row && row.label) || k,
        tabLabel: (row && row.tabLabel) || k,
      };
    });
    const objectionText =
      mergedLibrary &&
      mergedLibrary[serviceKey] &&
      typeof mergedLibrary[serviceKey].objectionHandling === 'string'
        ? mergedLibrary[serviceKey].objectionHandling.trim()
        : '';

    const { subject, body } = buildFocusOutreachDraft({
      channel,
      scriptVariant,
      company,
      contact,
      loc,
      cityState,
      objectionText,
      serviceBlock,
      leadSignal: lead.ownerSignal || '',
      tone,
      includeCouponLine,
      couponLink: ws && ws.coffeeCouponLink ? ws.coffeeCouponLink : '',
    });

    res.json({
      success: true,
      subject,
      body,
      scriptVariant,
      tone,
      includeCouponLine,
      scriptVariants: FOCUS_SCRIPT_VARIANTS,
      recommendedProduct,
      recommendedServiceKey: recommendedKey,
      selectedServiceKey: serviceKey,
      productOptions,
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
