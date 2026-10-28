/**
 * Agency Local SEO — Maps / GBP / reviews research for the workspace business profile.
 */

const express = require('express');
const dataForSeo = require('../services/dataForSeoClient');
const workspaceIntegrations = require('../services/workspaceIntegrations');
const localSeoStore = require('../services/localSeoStore');
const { syncLocalSeo } = require('../services/localSeoSync');
const { generateLocalActionPlan } = require('../services/localSeoPlanner');
const { defaultKeywords } = require('../services/localSeoParse');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const integrationEnv = await workspaceIntegrations.getResolvedIntegrationEnv(req.workspaceId);
    const bundle = await localSeoStore.load(req.workspaceId);
    const profile = localSeoStore.resolveBusinessProfile(bundle.workspace, bundle.profile);
    if (!profile.keywords.length) {
      profile.keywords = defaultKeywords(profile);
    }
    res.render('local_seo', {
      title: 'Local SEO | Agency OS',
      activePage: 'local-seo',
      dfsReady: dataForSeo.isConfigured(integrationEnv),
      profile,
      research: bundle.research,
      actionPlan: bundle.actionPlan,
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
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const keywords = Array.isArray(body.keywords)
      ? body.keywords
      : String(body.keywordsText || '')
          .split(/\n|,/)
          .map((k) => k.trim())
          .filter(Boolean);
    const saved = await localSeoStore.save(req.workspaceId, {
      profile: {
        businessName: String(body.businessName || '').trim(),
        city: String(body.city || '').trim(),
        vertical: String(body.vertical || '').trim(),
        website: String(body.website || '').trim(),
        locationName: String(body.locationName || '').trim(),
        locationCode: Number(body.locationCode) || 2840,
        languageCode: String(body.languageCode || 'en').slice(0, 8),
        placeId: String(body.placeId || '').trim(),
        cid: String(body.cid || '').trim(),
        keywords: keywords.slice(0, 8),
      },
    });
    return res.json({ success: true, profile: saved.profile });
  } catch (err) {
    return res.status(500).json({ success: false, error: err && err.message ? err.message : 'Save failed' });
  }
});

router.post('/sync', express.json(), async (req, res) => {
  try {
    const integrationEnv = await workspaceIntegrations.getResolvedIntegrationEnv(req.workspaceId);
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const keywords = Array.isArray(body.keywords)
      ? body.keywords
      : String(body.keywordsText || '')
          .split(/\n|,/)
          .map((k) => k.trim())
          .filter(Boolean);
    const profilePatch = {
      businessName: body.businessName != null ? String(body.businessName).trim() : undefined,
      city: body.city != null ? String(body.city).trim() : undefined,
      vertical: body.vertical != null ? String(body.vertical).trim() : undefined,
      website: body.website != null ? String(body.website).trim() : undefined,
      locationName: body.locationName != null ? String(body.locationName).trim() : undefined,
      placeId: body.placeId != null ? String(body.placeId).trim() : undefined,
      cid: body.cid != null ? String(body.cid).trim() : undefined,
      keywords: keywords.length ? keywords.slice(0, 8) : undefined,
    };
    Object.keys(profilePatch).forEach((k) => {
      if (profilePatch[k] === undefined) delete profilePatch[k];
    });

    const updated = await syncLocalSeo(req.workspaceId, {
      integrationEnv,
      profilePatch,
      persist: true,
    });
    return res.json({
      success: true,
      research: updated.research,
      profile: updated.profile,
      scores: updated.research && updated.research.scores,
      warnings: (updated.research && updated.research.warnings) || [],
      lastSyncedAt: updated.lastSyncedAt,
    });
  } catch (err) {
    const status =
      err && (err.code === 'DATAFORSEO_NOT_CONFIGURED' || err.code === 'NO_BUSINESS') ? 400 : 500;
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

module.exports = router;
