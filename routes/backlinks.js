/**
 * Agency Backlinks module — DataForSEO Backlinks API (own site + competitors).
 */

const express = require('express');
const dataForSeo = require('../services/dataForSeoClient');
const workspaceIntegrations = require('../services/workspaceIntegrations');
const backlinksStore = require('../services/backlinksStore');
const { syncBacklinksProject } = require('../services/backlinksSync');

const router = express.Router();

function hostFrom(raw) {
  return dataForSeo.hostFromWebsite(raw);
}

router.get('/', async (req, res, next) => {
  try {
    const integrationEnv = await workspaceIntegrations.getResolvedIntegrationEnv(req.workspaceId);
    const projects = await backlinksStore.listProjects(req.workspaceId);
    res.render('backlinks', {
      title: 'Backlinks | Agency OS',
      activePage: 'backlinks',
      dfsReady: dataForSeo.isConfigured(integrationEnv),
      projects,
      project: null,
      flashError: null,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const project = await backlinksStore.getProject(req.workspaceId, req.params.id);
    if (!project) {
      return res.status(404).render('error', { message: 'Backlinks project not found.', activePage: 'backlinks' });
    }
    const integrationEnv = await workspaceIntegrations.getResolvedIntegrationEnv(req.workspaceId);
    const projects = await backlinksStore.listProjects(req.workspaceId);
    res.render('backlinks', {
      title: `${project.seedDomain} · Backlinks | Agency OS`,
      activePage: 'backlinks',
      dfsReady: dataForSeo.isConfigured(integrationEnv),
      projects,
      project,
      flashError: null,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/projects', express.json(), async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const seedDomain = hostFrom(body.seedDomain || body.domain || '');
    if (!seedDomain) {
      return res.status(400).json({ success: false, error: 'Enter a valid domain (e.g. example.com).' });
    }
    const project = await backlinksStore.upsertProject(req.workspaceId, {
      seedDomain,
      locationCode: Number(body.locationCode) || 2840,
      languageCode: String(body.languageCode || 'en').slice(0, 8),
      maxCompetitors: Math.min(5, Math.max(1, Number(body.maxCompetitors) || 3)),
      referringLimit: Math.min(200, Math.max(20, Number(body.referringLimit) || 80)),
      anchorLimit: Math.min(100, Math.max(10, Number(body.anchorLimit) || 40)),
      autoDiscoverCompetitors: body.autoDiscoverCompetitors !== false,
      competitors: Array.isArray(body.competitors)
        ? body.competitors.map((d) => ({ domain: hostFrom(d), source: 'manual' })).filter((c) => c.domain)
        : [],
      syncStatus: 'new',
      you: null,
      competitorProfiles: [],
      comparison: [],
      linkGaps: [],
    });
    return res.json({ success: true, project, url: `/backlinks/${encodeURIComponent(project.id)}` });
  } catch (err) {
    return res.status(500).json({ success: false, error: err && err.message ? err.message : 'Create failed' });
  }
});

router.post('/:id/sync', express.json(), async (req, res) => {
  try {
    const project = await backlinksStore.getProject(req.workspaceId, req.params.id);
    if (!project) return res.status(404).json({ success: false, error: 'Project not found.' });
    const integrationEnv = await workspaceIntegrations.getResolvedIntegrationEnv(req.workspaceId);
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const updated = await syncBacklinksProject(
      { ...project, rediscoverCompetitors: body.rediscoverCompetitors !== false },
      { integrationEnv, persist: true }
    );
    return res.json({
      success: true,
      project: updated,
      summary: updated.summary,
      warnings: updated.warnings || [],
    });
  } catch (err) {
    const status = err && err.code === 'DATAFORSEO_NOT_CONFIGURED' ? 400 : 500;
    return res.status(status).json({
      success: false,
      error: err && err.message ? err.message : 'Sync failed',
      code: err && err.code,
    });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const ok = await backlinksStore.deleteProject(req.workspaceId, req.params.id);
    if (!ok) return res.status(404).json({ success: false, error: 'Not found' });
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: err && err.message ? err.message : 'Delete failed' });
  }
});

module.exports = router;
