/**
 * Agency Local SEO — Maps / GBP / reviews research + AI improve chat.
 */

const express = require('express');
const dataForSeo = require('../services/dataForSeoClient');
const workspaceIntegrations = require('../services/workspaceIntegrations');
const localSeoStore = require('../services/localSeoStore');
const { syncLocalSeo } = require('../services/localSeoSync');
const { generateLocalActionPlan } = require('../services/localSeoPlanner');
const { askLocalSeoChat } = require('../services/localSeoChat');
const { defaultKeywords, enrichKeywords } = require('../services/localSeoParse');

const router = express.Router();

function readProfileBody(body) {
  const b = body && typeof body === 'object' ? body : {};
  const keywords = Array.isArray(b.keywords)
    ? b.keywords
    : String(b.keywordsText || '')
        .split(/\n|,/)
        .map((k) => k.trim())
        .filter(Boolean);
  return {
    businessName: b.businessName != null ? String(b.businessName).trim() : undefined,
    city: b.city != null ? String(b.city).trim() : undefined,
    state: b.state != null ? String(b.state).trim() : undefined,
    vertical: b.vertical != null ? String(b.vertical).trim() : undefined,
    website: b.website != null ? String(b.website).trim() : undefined,
    locationName: b.locationName != null ? String(b.locationName).trim() : undefined,
    locationCode: b.locationCode != null ? Number(b.locationCode) || 2840 : undefined,
    languageCode: b.languageCode != null ? String(b.languageCode).slice(0, 8) : undefined,
    placeId: b.placeId != null ? String(b.placeId).trim() : undefined,
    cid: b.cid != null ? String(b.cid).trim() : undefined,
    keywords: keywords.length ? keywords.slice(0, 8) : undefined,
  };
}

router.get('/', async (req, res, next) => {
  try {
    const integrationEnv = await workspaceIntegrations.getResolvedIntegrationEnv(req.workspaceId);
    const bundle = await localSeoStore.load(req.workspaceId);
    const profile = localSeoStore.resolveBusinessProfile(bundle.workspace, bundle.profile);
    profile.keywords = enrichKeywords({ ...profile, keywords: profile.keywords.length ? profile.keywords : defaultKeywords(profile) });
    res.render('local_seo', {
      title: 'Local SEO Rank | Agency OS',
      activePage: 'local-seo',
      dfsReady: dataForSeo.isConfigured(integrationEnv),
      profile,
      research: bundle.research,
      actionPlan: bundle.actionPlan,
      chat: bundle.chat || [],
      syncStatus: bundle.syncStatus,
      lastSyncedAt: bundle.lastSyncedAt,
      flashError: null,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/profile', express.json(), async (req, res) => {
  try {
    const patch = readProfileBody(req.body);
    Object.keys(patch).forEach((k) => {
      if (patch[k] === undefined) delete patch[k];
    });
    const saved = await localSeoStore.save(req.workspaceId, { profile: patch });
    return res.json({ success: true, profile: saved.profile });
  } catch (err) {
    return res.status(500).json({ success: false, error: err && err.message ? err.message : 'Save failed' });
  }
});

router.post('/sync', express.json(), async (req, res) => {
  try {
    const integrationEnv = await workspaceIntegrations.getResolvedIntegrationEnv(req.workspaceId);
    const profilePatch = readProfileBody(req.body);
    Object.keys(profilePatch).forEach((k) => {
      if (profilePatch[k] === undefined) delete profilePatch[k];
    });

    const updated = await syncLocalSeo(req.workspaceId, {
      integrationEnv,
      profilePatch,
      persist: true,
    });
    // Auto-generate action plan after a successful sync so the page isn't empty.
    let actionPlan = null;
    try {
      actionPlan = await generateLocalActionPlan(updated.research, { integrationEnv });
      await localSeoStore.save(req.workspaceId, { actionPlan });
    } catch (_) {
      /* non-fatal */
    }
    return res.json({
      success: true,
      research: updated.research,
      profile: updated.profile,
      actionPlan,
      scores: updated.research && updated.research.scores,
      warnings: (updated.research && updated.research.warnings) || [],
      lastSyncedAt: updated.lastSyncedAt,
    });
  } catch (err) {
    const status =
      err &&
      (err.code === 'DATAFORSEO_NOT_CONFIGURED' || err.code === 'NO_BUSINESS' || err.code === 'NO_CITY')
        ? 400
        : 500;
    return res.status(status).json({
      success: false,
      error: err && err.message ? err.message : 'Sync failed',
      code: err && err.code,
    });
  }
});

router.post('/analyze', express.json(), async (req, res) => {
  try {
    const bundle = await localSeoStore.load(req.workspaceId);
    if (!bundle.research) {
      return res.status(400).json({ success: false, error: 'Run Update first so there is research to analyze.' });
    }
    const integrationEnv = await workspaceIntegrations.getResolvedIntegrationEnv(req.workspaceId);
    const plan = await generateLocalActionPlan(bundle.research, { integrationEnv });
    await localSeoStore.save(req.workspaceId, { actionPlan: plan });
    return res.json({ success: true, actionPlan: plan });
  } catch (err) {
    return res.status(500).json({ success: false, error: err && err.message ? err.message : 'Analyze failed' });
  }
});

router.post('/chat', express.json(), async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const question = String(body.question || body.message || '').trim();
    const bundle = await localSeoStore.load(req.workspaceId);
    const integrationEnv = await workspaceIntegrations.getResolvedIntegrationEnv(req.workspaceId);
    const result = await askLocalSeoChat(bundle.research, bundle.actionPlan, question, {
      integrationEnv,
      history: bundle.chat,
    });
    const chat = Array.isArray(bundle.chat) ? bundle.chat.slice() : [];
    chat.push({ role: 'user', content: question, at: new Date().toISOString() });
    chat.push({
      role: 'assistant',
      content: result.answer,
      source: result.source,
      at: new Date().toISOString(),
    });
    const trimmed = chat.slice(-24);
    await localSeoStore.save(req.workspaceId, { chat: trimmed });
    return res.json({ success: true, answer: result.answer, source: result.source, chat: trimmed });
  } catch (err) {
    const status = err && err.code === 'NO_QUESTION' ? 400 : 500;
    return res.status(status).json({
      success: false,
      error: err && err.message ? err.message : 'Chat failed',
      code: err && err.code,
    });
  }
});

module.exports = router;
