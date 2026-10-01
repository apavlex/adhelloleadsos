const express = require('express');
const router = express.Router();
const dbService = require('../services/database');
const sequenceEngine = require('../services/sequenceEngine');
const sequenceTemplates = require('../services/sequenceTemplates');
const pipelineStagesService = require('../services/pipelineStagesService');
const { filterLeadsForRequest, userEmail } = require('../services/workspaceService');
const customCadences = require('../services/customCadences');
const teamActivity = require('../services/teamActivity');
const { filterTemplatesForWorkspace } = require('../services/auditCadenceGuard');
const workspaceIntegrations = require('../services/workspaceIntegrations');
const ghlSync = require('../services/ghlSync');
const prospectingEnroll = require('../services/prospectingEnroll');
const {
  getActiveAutoOutreachSummary,
  loadFolderOutreachFromFolder,
} = require('../services/folderOutreachAutomation');
const { SCRIPT_LIBRARY } = require('../services/salesConstants');
const salesScriptsStorage = require('../services/salesScriptsStorage');

function senderOfferPicklist(ws) {
  const merged = salesScriptsStorage.buildMergedScriptLibrary(ws, SCRIPT_LIBRARY);
  return salesScriptsStorage.getWorkspaceScriptKeys(ws, SCRIPT_LIBRARY).map((k) => ({
    key: k,
    label: (merged[k] && merged[k].label) || k,
  }));
}

async function buildGhlOutreachLocals(req, ws, leads) {
  const wid = req.workspaceId || 'default';
  const [integrationEnv, campaigns, folders] = await Promise.all([
    workspaceIntegrations.getResolvedIntegrationEnv(wid).catch(() => ({})),
    getActiveAutoOutreachSummary(wid).catch(() => null),
    dbService.listFolders(wid).catch(() => []),
  ]);
  const folderPrompts = (Array.isArray(folders) ? folders : [])
    .map((f) => {
      const s = loadFolderOutreachFromFolder(f);
      const prompt = String(s.ghlWorkflowPrompt || '').trim();
      if (!prompt) return null;
      return {
        key: String(f.key || ''),
        name: String(f.name || f.key || 'Folder'),
        enabled: !!s.enabled,
        goal: String(s.ghlGoal || '').trim(),
        prompt,
      };
    })
    .filter(Boolean);
  const today = prospectingEnroll.utcDayKey(new Date());
  const enrolledToday = leads.filter((l) => prospectingEnroll.leadAutoOutreachEnrolledOnDay(l, today)).length;
  const ghlOutreachLeads = leads
    .filter((l) => prospectingEnroll.isActiveProspecting(l))
    .map((l) => ({
      key: l.key,
      title: l.title,
      enrolledAt: (l.prospecting && (l.prospecting.lastEnrolledAt || l.prospecting.enrolledAt)) || '',
    }))
    .sort((a, b) => String(b.enrolledAt).localeCompare(String(a.enrolledAt)));
  let senderOffers = [];
  try {
    senderOffers = senderOfferPicklist(ws);
  } catch (_) {
    senderOffers = [];
  }
  return {
    ghlStatus: ghlSync.statusFromEnv(integrationEnv),
    ghlOutreach: {
      tagName: prospectingEnroll.AUTO_OUTREACH_TAG_NAME,
      dailyCap: prospectingEnroll.AUTO_OUTREACH_DAILY_CAP,
      enrolledToday,
      campaigns,
    },
    ghlOutreachLeads,
    folderPrompts,
    senderOffers,
  };
}

function mapTemplateSteps(steps) {
  return (Array.isArray(steps) ? steps : []).map((s) => ({
    dayOffset: s.dayOffset,
    channel: s.channel,
    title: s.title,
    hint: s.hint || '',
  }));
}

function serializeSequenceTemplates(req, ws) {
  const raw = req.app.locals.sequenceTemplates || sequenceEngine.listTemplates();
  const scoped = filterTemplatesForWorkspace(raw, ws);
  return (Array.isArray(scoped) ? scoped : []).map((t) => {
    if (!t || !t.id) return null;
    let steps = mapTemplateSteps(t.steps);
    if (!steps.length) {
      const full = sequenceTemplates.getTemplate(t.id);
      if (full && Array.isArray(full.steps)) steps = mapTemplateSteps(full.steps);
    }
    const stepCount = steps.length || (t.stepCount != null ? t.stepCount : 0);
    return {
      id: t.id,
      persona: t.persona,
      name: t.name,
      description: t.description,
      stepCount,
      steps,
    };
  }).filter(Boolean);
}

/** JSON playbook list for lead panel cadence picker (and other clients). */
router.get('/templates.json', async (req, res, next) => {
  try {
    const ws = await dbService.getWorkspace(req.workspaceId);
    res.json({ success: true, templates: serializeSequenceTemplates(req, ws) });
  } catch (e) {
    next(e);
  }
});

function requireManager(req, res) {
  if (req.canManageWorkspace) return true;
  res.status(403).json({ success: false, error: 'Only workspace owners and admins can edit cadences.' });
  return false;
}

/** Custom GHL cadences for the Pipeline launch picker. */
router.get('/custom.json', async (req, res, next) => {
  try {
    const ws = await dbService.getWorkspace(req.workspaceId);
    const cadences = customCadences.listCadences(ws).map((c) => ({
      id: c.id,
      name: c.name,
      goal: c.goal,
      tagName: customCadences.tagNameFor(c),
      summary: customCadences.stepSummary(c),
      ghlSetupAt: c.ghlSetupAt,
    }));
    res.json({ success: true, cadences });
  } catch (e) {
    next(e);
  }
});

router.post('/custom', express.json(), async (req, res, next) => {
  try {
    if (!requireManager(req, res)) return;
    const result = await customCadences.saveCadence(req.workspaceId, req.body || {});
    if (!result.ok) return res.status(400).json({ success: false, error: result.error });
    res.json({ success: true, cadence: result.cadence, prompt: customCadences.buildGhlPrompt(result.cadence) });
  } catch (e) {
    next(e);
  }
});

router.post('/custom/:id/delete', async (req, res, next) => {
  try {
    if (!requireManager(req, res)) return;
    const result = await customCadences.deleteCadence(req.workspaceId, req.params.id);
    if (!result.ok) return res.status(404).json({ success: false, error: result.error });
    res.json({ success: true });
  } catch (e) {
    next(e);
  }
});

router.post('/custom/:id/ghl-ready', async (req, res, next) => {
  try {
    const result = await customCadences.markGhlSetup(req.workspaceId, req.params.id);
    if (!result.ok) return res.status(404).json({ success: false, error: result.error });
    res.json({ success: true, cadence: result.cadence });
  } catch (e) {
    next(e);
  }
});

router.post('/custom/:id/launch', express.json(), async (req, res, next) => {
  try {
    const body = req.body || {};
    const all = await dbService.getAllLeads(req.workspaceId);
    const visible = new Set(filterLeadsForRequest(req, all).map((l) => l.key));
    const leadKeys = (Array.isArray(body.leadKeys) ? body.leadKeys : [])
      .map((k) => (String(k).startsWith('lead:') ? String(k) : `lead:${k}`))
      .filter((k) => visible.has(k));
    const result = await customCadences.launchCadence({
      workspaceId: req.workspaceId,
      cadenceId: req.params.id,
      leadKeys,
      actorEmail: userEmail(req),
    });
    if (!result.ok) return res.status(400).json({ success: false, error: result.error });
    if (result.launched) {
      teamActivity.record(req, {
        category: 'outreach',
        action: 'ghl_cadence_launch',
        summary: `Launched "${result.cadence.name}" on ${result.launched} lead${result.launched === 1 ? '' : 's'}`,
        leadKeys: leadKeys,
        leadCount: result.launched,
      });
    }
    res.json({ success: true, ...result });
  } catch (e) {
    next(e);
  }
});

router.post('/custom/stop', express.json(), async (req, res, next) => {
  try {
    const result = await customCadences.stopCadenceForLead({ workspaceId: req.workspaceId, leadKey: (req.body || {}).leadKey });
    if (!result.ok) return res.status(400).json({ success: false, error: result.error });
    res.json({ success: true });
  } catch (e) {
    next(e);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const ws = await dbService.getWorkspace(req.workspaceId);
    const all = await dbService.getAllLeads(req.workspaceId);
    const leads = filterLeadsForRequest(req, all);
    const templates = serializeSequenceTemplates(req, ws).map((t) => ({
      id: t.id,
      persona: t.persona,
      name: t.name,
      description: t.description,
      stepCount: t.stepCount,
    }));
    const active = leads.filter(
      (l) => l.sequenceState && l.sequenceState.status === 'active'
    );
    const stageRows = await pipelineStagesService.ensureWorkspaceStagesSeeded(req.workspaceId);
    const pipelineStages = pipelineStagesService.stagesForKanban(stageRows);
    const ghlLocals = await buildGhlOutreachLocals(req, ws, leads);
    res.render('sequences', {
      title: 'Cadences | Agency OS',
      activePage: 'sequences',
      templates,
      activeSequences: active,
      activeCount: active.length,
      pipelineStages,
      customCadences: customCadences.cadencesWithLeads(ws, leads),
      cadenceChannels: customCadences.CHANNELS,
      cadenceMergeTokens: Object.keys(customCadences.MERGE_TOKENS),
      ...ghlLocals,
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
