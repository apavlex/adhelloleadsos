const express = require('express');
const { randomUUID } = require('crypto');
const dbService = require('../services/database');
const workspaceService = require('../services/workspaceService');
const { userEmail } = workspaceService;
const workspaceBootstrap = require('../services/workspaceBootstrap');
const { PRESETS, PALETTE } = require('../lib/pipeline/presets');
const { normalizeStages } = require('../lib/pipeline/normalize');
const { suggestPipelineStages } = require('../services/suggestPipelineStages');
const pipelineStagesService = require('../services/pipelineStagesService');
const { normalizeWorkspaceAccentHex } = require('../lib/workspaceAccent');

const router = express.Router();

const COACH_PRESETS = {
  agency: workspaceBootstrap.DEFAULT_COACH_AGENCY,
  retail_install:
    'You are coaching a flooring retail/install business owner targeting general contractors and builders. Focus on trust signals, sample kits, and job-site relationships.',
  saas:
    'You are coaching a B2B SaaS founder targeting operational leaders. Focus on ROI proof, onboarding clarity, and champion enablement.',
  local_service:
    'You are coaching a local service business owner. Focus on fast response, reviews, and neighborhood trust.',
  other: '',
};

function slugify(name) {
  const s = String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return s || 'workspace';
}

async function allocateUniqueSlug(base) {
  let s = slugify(base);
  for (let i = 0; i < 50; i += 1) {
    const candidate = i === 0 ? s : `${s}-${i + 1}`;
    const existing = await dbService.getWorkspaceIdForSlug(candidate);
    if (!existing) return candidate;
  }
  return `${slugify(base)}-${randomUUID().slice(0, 8)}`;
}

function getWizard(req) {
  if (!req.session) return null;
  if (!req.session.createWorkspaceWizard) {
    req.session.createWorkspaceWizard = { step: 1 };
  }
  return req.session.createWorkspaceWizard;
}

const PRESET_LIST = Object.keys(PRESETS).map((key) => ({
  key,
  label: PRESETS[key].label,
  stages: PRESETS[key].stages,
}));

router.post('/suggest-stages', express.json(), async (req, res) => {
  try {
    const result = await suggestPipelineStages(req.body || {});
    if (!result.success) {
      return res.status(400).json(result);
    }
    return res.json(result);
  } catch (e) {
    console.warn('[suggest-stages]', e.message);
    return res.status(400).json({
      success: false,
      error: 'Could not generate stages, please try again or use a preset.',
    });
  }
});

router.get('/new', async (req, res, next) => {
  try {
    const email = userEmail(req);
    if (!email) return res.redirect('/auth/login');

    if (String(req.query.reset || '') === '1' && req.session) {
      req.session.createWorkspaceWizard = { step: 1 };
    }

    const w = getWizard(req);
    const errQ = typeof req.query.error === 'string' ? req.query.error.trim() : '';

    res.render('workspaces-wizard', {
      title: 'New workspace | Agency OS',
      activePage: 'workspace',
      PALETTE,
      PRESET_LIST,
      wizard: w,
      error: errQ || null,
    });
  } catch (e) {
    next(e);
  }
});

function readSaleIncludes(body) {
  const out = [];
  const m = {
    inc_site_visit: 'site_visit',
    inc_estimate: 'estimate',
    inc_contract: 'contract',
    inc_deposit: 'deposit',
    inc_install: 'install',
    inc_subscription: 'subscription',
    inc_multi: 'multi_stakeholder',
  };
  for (const [field, key] of Object.entries(m)) {
    if (body[field] === 'on' || body[field] === '1' || body[field] === true) out.push(key);
  }
  return out;
}

function readWonDefinition(body) {
  const opt = String(body.wonOption || '').trim();
  const map = {
    contract: 'Contract signed',
    deposit: 'Deposit received',
    completed: 'Work completed',
    payment: 'First payment',
  };
  if (opt === 'other') return String(body.wonOther || '').trim() || 'Closed won';
  return map[opt] || 'Contract signed';
}

router.post('/new', express.urlencoded({ extended: true }), async (req, res, next) => {
  try {
    const email = userEmail(req);
    if (!email) return res.redirect('/auth/login');

    const w = getWizard(req);
    const action = String(req.body.action || '').trim();

    if (action === 'step1') {
      w.name = String(req.body.name || '').trim() || 'New workspace';
      let acRaw = String(req.body.accentColor || '').trim();
      if (acRaw === '__custom__') {
        acRaw = String(req.body.accentColorCustom || '').trim();
      }
      if (!acRaw) acRaw = String(Object.values(PALETTE)[0]);
      const normAc = normalizeWorkspaceAccentHex(acRaw);
      w.accentColor = normAc || String(Object.values(PALETTE)[0]);
      w.setupPath = String(req.body.setupPath || 'preset').trim();
      w.presetKey = null;
      w.icpKeyword = String(req.body.keyword || '').trim();
      w.icpCity = String(req.body.city || '').trim();
      w.icpState = String(req.body.state || '').trim();
      const avgRaw = String(req.body.avgDealValue || '').replace(/,/g, '');
      w.avgDealValue = parseFloat(avgRaw, 10);
      if (w.setupPath === 'preset') {
        w.step = 2;
      } else if (w.setupPath === 'ai') {
        w.step = '2b';
      } else {
        w.step = 3;
        w.cwRationale = '';
        w.cwStages = normalizeStages([
          { key: 'new', name: 'New', color: PALETTE.slate, slaHours: 24, isWon: false, isLost: false },
          {
            key: 'in_progress',
            name: 'In progress',
            color: PALETTE.blue,
            slaHours: 72,
            isWon: false,
            isLost: false,
          },
          { key: 'won', name: 'Won', color: PALETTE.green, slaHours: null, isWon: true, isLost: false },
        ]);
      }
      return res.redirect('/workspaces/new');
    }

    if (action === 'preset_pick') {
      const pk = String(req.body.presetKey || '').trim();
      const preset = PRESETS[pk];
      if (!preset) {
        return res.redirect('/workspaces/new?error=' + encodeURIComponent('Unknown preset.'));
      }
      w.presetKey = pk;
      w.cwStages = normalizeStages(
        preset.stages.map((s) => ({
          key: s.key,
          name: s.name,
          color: s.color,
          slaHours: s.slaHours,
          isWon: s.isWon,
          isLost: s.isLost,
        }))
      );
      w.cwRationale = '';
      w.step = 3;
      return res.redirect('/workspaces/new');
    }

    if (action === 'ai_intake') {
      const businessDescription = String(req.body.businessDescription || '').trim();
      const cycleLength = String(req.body.cycleLength || '1-2m').trim();
      const saleIncludes = readSaleIncludes(req.body);
      const wonDefinition = readWonDefinition(req.body);
      w.cwIntake = {
        businessDescription,
        cycleLength,
        saleIncludes,
        wonDefinition,
      };
      const result = await suggestPipelineStages({
        businessDescription,
        cycleLength,
        saleIncludes,
        wonDefinition,
        modifier: null,
      });
      if (!result.success) {
        return res.redirect('/workspaces/new?error=' + encodeURIComponent(result.error || 'AI failed'));
      }
      w.cwStages = result.stages;
      w.cwRationale = result.rationale || '';
      w.step = 3;
      w.setupPath = 'ai';
      return res.redirect('/workspaces/new');
    }

    if (action === 'regenerate_ai') {
      const intake = w.cwIntake;
      if (!intake || w.setupPath !== 'ai') {
        return res.redirect('/workspaces/new');
      }
      const modifier = String(req.body.modifier || '').trim() || null;
      const result = await suggestPipelineStages({
        businessDescription: intake.businessDescription,
        cycleLength: intake.cycleLength,
        saleIncludes: intake.saleIncludes || [],
        wonDefinition: intake.wonDefinition,
        modifier: modifier === 'try_again' ? null : modifier,
      });
      if (!result.success) {
        return res.redirect('/workspaces/new?error=' + encodeURIComponent(result.error || 'AI failed'));
      }
      w.cwStages = result.stages;
      w.cwRationale = result.rationale || '';
      return res.redirect('/workspaces/new');
    }

    if (action === 'create') {
      let stages = Array.isArray(w.cwStages) ? w.cwStages : [];
      if (req.body.stagesJson) {
        try {
          const parsed = JSON.parse(String(req.body.stagesJson));
          if (Array.isArray(parsed)) stages = normalizeStages(parsed);
        } catch (_) {
          /* keep session */
        }
      }

      const name = w.name || String(req.body.name || '').trim() || 'New workspace';
      const accentRaw = w.accentColor || String(req.body.accentColor || '#CA8A04').trim();
      const accentColor = normalizeWorkspaceAccentHex(accentRaw) || '#CA8A04';
      const keyword = w.icpKeyword != null ? w.icpKeyword : String(req.body.keyword || '').trim();
      const city = w.icpCity != null ? w.icpCity : String(req.body.city || '').trim();
      const state = w.icpState != null ? w.icpState : String(req.body.state || '').trim();
      const avgDealValue = Number.isFinite(w.avgDealValue) ? w.avgDealValue : parseFloat(String(req.body.avgDealValue || '').replace(/,/g, ''), 10);

      const newId = randomUUID();
      const slug = await allocateUniqueSlug(name);
      const em = workspaceBootstrap.normEmail(email);

      const pipelineIntake = {
        ...(w.cwIntake || {}),
        setupPath: w.setupPath || 'preset',
        presetKey: w.presetKey || null,
      };

      let coachPrompt = COACH_PRESETS.agency;
      if (w.setupPath === 'ai' && pipelineIntake.businessDescription) {
        coachPrompt = `You coach this business owner. Context: ${String(pipelineIntake.businessDescription).slice(0, 1500)}`;
      } else {
        const ck = String(w.presetKey || 'agency').toLowerCase();
        if (COACH_PRESETS[ck]) coachPrompt = COACH_PRESETS[ck];
      }

      const doc = {
        id: newId,
        ownerUserId: em,
        name,
        slug,
        accentColor,
        coachPrompt: coachPrompt || COACH_PRESETS.agency,
        icp: {
          keyword,
          city,
          state,
          qty: 20,
        },
        settings: {},
        pipelineIntake,
        members: {
          [em]: { role: 'owner', joinedAt: new Date().toISOString(), userId: em },
        },
        roundRobinIndex: 0,
        createdAt: new Date().toISOString(),
        archivedAt: null,
      };
      if (Number.isFinite(avgDealValue) && avgDealValue > 0) doc.avgDealValue = avgDealValue;

      await dbService.saveWorkspace(newId, doc);
      await dbService.saveWorkspaceSlug(slug, newId);
      await dbService.addUserWorkspaceId(em, newId);
      await dbService.saveUserPrefs(em, { activeWorkspaceId: newId });
      if (req.session) {
        req.session.activeWorkspaceId = newId;
        req.session.workspaceId = newId;
        delete req.session.createWorkspaceWizard;
      }

      await pipelineStagesService.deleteAllStages(newId);
      await pipelineStagesService.persistNormalizedStages(newId, stages);
      res.redirect('/today');
      return;
    }

    if (action === 'back') {
      if (w.step === 3) {
        if (w.setupPath === 'preset') w.step = 2;
        else if (w.setupPath === 'ai') w.step = '2b';
        else w.step = 1;
      } else if (w.step === 2 || w.step === '2b') {
        w.step = 1;
      }
      return res.redirect('/workspaces/new');
    }

    return res.redirect('/workspaces/new');
  } catch (e) {
    next(e);
  }
});

router.get('/:workspaceId/settings/pipeline', async (req, res, next) => {
  try {
    const email = userEmail(req);
    if (!email) return res.redirect('/auth/login');

    const wid = String(req.params.workspaceId || '').trim();
    const ws = await dbService.getWorkspace(wid);
    if (!ws || !workspaceBootstrap.userCanAccessWorkspace(ws, email)) {
      return res.status(403).render('error', {
        message: 'You do not have access to this workspace.',
        activePage: '',
      });
    }
    const role = workspaceService.roleForEmail(ws, email);
    if (!workspaceService.canManageTeam(role)) {
      return res.status(403).render('error', {
        message: 'Only admins can edit pipeline stages.',
        activePage: 'workspace',
      });
    }

    const rows = await pipelineStagesService.ensureWorkspaceStagesSeeded(wid);
    const sorted = [...rows].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
    const counts = await pipelineStagesService.countLeadsByStageId(wid);

    res.render('workspace-pipeline-settings', {
      title: 'Pipeline stages | Agency OS',
      activePage: 'workspace',
      workspace: ws,
      workspaceId: wid,
      stages: sorted,
      leadCountsByStageId: counts,
      PRESET_LIST,
      PALETTE,
      pipelineIntake: ws.pipelineIntake || null,
    });
  } catch (e) {
    next(e);
  }
});

router.post('/:workspaceId/settings/pipeline/save', express.json(), async (req, res) => {
  try {
    const email = userEmail(req);
    if (!email) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const wid = String(req.params.workspaceId || '').trim();
    const ws = await dbService.getWorkspace(wid);
    if (!ws || !workspaceBootstrap.userCanAccessWorkspace(ws, email)) {
      return res.status(403).json({ success: false, error: 'No access.' });
    }
    const roleSave = workspaceService.roleForEmail(ws, email);
    if (!workspaceService.canManageTeam(roleSave)) {
      return res.status(403).json({ success: false, error: 'Admin required.' });
    }

    const body = req.body || {};
    const stages = Array.isArray(body.stages) ? body.stages : [];
    const deleteIds = Array.isArray(body.deleteStageIds) ? body.deleteStageIds : [];

    try {
      const saved = await pipelineStagesService.saveStagesFromEditor(wid, stages, deleteIds);
      return res.json({ success: true, stages: saved });
    } catch (e) {
      if (e && e.code === 'STAGE_HAS_LEADS') {
        return res.status(400).json({
          success: false,
          error: 'STAGE_HAS_LEADS',
          stageId: e.stageId,
          count: e.count,
        });
      }
      return res.status(400).json({ success: false, error: e.message || 'Save failed.' });
    }
  } catch (e) {
    console.warn('[pipeline/save]', e.message);
    return res.json({ success: false, error: 'Save failed.' });
  }
});

router.post('/:workspaceId/settings/pipeline/replace-mapped', express.json(), async (req, res) => {
  try {
    const email = userEmail(req);
    if (!email) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const wid = String(req.params.workspaceId || '').trim();
    const ws = await dbService.getWorkspace(wid);
    if (!ws || !workspaceBootstrap.userCanAccessWorkspace(ws, email)) {
      return res.status(403).json({ success: false, error: 'No access.' });
    }
    const roleRep = workspaceService.roleForEmail(ws, email);
    if (!workspaceService.canManageTeam(roleRep)) {
      return res.status(403).json({ success: false, error: 'Admin required.' });
    }

    const body = req.body || {};
    const newRowsRaw = Array.isArray(body.newStages) ? body.newStages : [];
    /** Maps old stage UUID → new stage key (snake_case) */
    const mapping = body.mapping && typeof body.mapping === 'object' ? body.mapping : {};

    if (!newRowsRaw.length) {
      return res.status(400).json({ success: false, error: 'newStages required.' });
    }

    const coerced = normalizeStages(
      newRowsRaw.map((s) => ({
        key: s.key,
        name: s.name,
        color: s.color,
        slaHours: s.slaHours,
        isWon: s.isWon,
        isLost: s.isLost,
      }))
    );

    const now = new Date().toISOString();
    const newRows = coerced.map((s, i) => ({
      id: randomUUID(),
      workspaceId: wid,
      key: s.key,
      name: s.name,
      color: s.color,
      sortOrder: i,
      isWon: s.isWon,
      isLost: s.isLost,
      slaHours: s.slaHours,
      description: null,
      createdAt: now,
    }));

    const keyToId = Object.fromEntries(newRows.map((r) => [r.key, r.id]));
    const oldToNewId = {};
    for (const [oldId, newKey] of Object.entries(mapping)) {
      const nk = String(newKey || '').trim();
      if (nk && keyToId[nk]) oldToNewId[oldId] = keyToId[nk];
    }

    const oldStages = await pipelineStagesService.listStages(wid);
    const counts = await pipelineStagesService.countLeadsByStageId(wid);

    for (const old of oldStages) {
      const c = counts[old.id] || 0;
      if (c > 0 && !oldToNewId[old.id]) {
        return res.status(400).json({
          success: false,
          error: `Map stage "${old.name}" (${c} leads) to a new stage.`,
        });
      }
    }

    await pipelineStagesService.replaceStagesWithMapping(wid, newRows, oldToNewId);

    if (body.pipelineIntake && typeof body.pipelineIntake === 'object') {
      const next = {
        ...ws,
        pipelineIntake: { ...(ws.pipelineIntake || {}), ...body.pipelineIntake },
      };
      await dbService.saveWorkspace(wid, next);
    }

    return res.json({ success: true, stages: newRows });
  } catch (e) {
    console.warn('[pipeline/replace-mapped]', e.message);
    return res.json({ success: false, error: e.message || 'Replace failed.' });
  }
});

router.post('/switch', express.urlencoded({ extended: true }), async (req, res, next) => {
  try {
    const email = userEmail(req);
    if (!email) return res.redirect('/auth/login');

    const raw = String(req.body.workspaceId || '').trim();
    if (!raw) return res.redirect('/today');

    const ws = await dbService.getWorkspace(raw);
    if (!ws || !workspaceBootstrap.userCanAccessWorkspace(ws, email)) {
      return res.status(403).render('error', {
        message: 'You do not have access to that workspace.',
        activePage: '',
      });
    }

    await dbService.saveUserPrefs(email, { activeWorkspaceId: raw });
    if (req.session) {
      req.session.activeWorkspaceId = raw;
      req.session.workspaceId = raw;
    }

    const fallback = '/today';
    const returnRaw = String(req.body.returnTo || req.get('Referer') || '').trim();
    let redirectTo = fallback;
    if (returnRaw) {
      try {
        if (returnRaw.startsWith('/')) {
          if (!returnRaw.startsWith('/auth') && !returnRaw.startsWith('/logout')) {
            redirectTo = returnRaw;
          }
        } else {
          const u = new URL(returnRaw);
          const host = req.get('host') || '';
          if (u.host === host && u.pathname && !u.pathname.startsWith('/auth')) {
            redirectTo = u.pathname + (u.search || '');
          }
        }
      } catch (_) {
        redirectTo = fallback;
      }
    }

    res.redirect(redirectTo);
  } catch (e) {
    next(e);
  }
});

module.exports = router;
