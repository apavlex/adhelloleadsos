/**
 * Agency SEO Gap module — DataForSEO sync + AI action plans (no crawler).
 */

const express = require('express');
const dataForSeo = require('../services/dataForSeoClient');
const workspaceIntegrations = require('../services/workspaceIntegrations');
const seoGapStore = require('../services/seoGapStore');
const { syncProjectFromDataForSeo } = require('../services/seoGapSync');
const { generateActionPlan } = require('../services/seoActionPlanner');

const router = express.Router();

function hostFrom(raw) {
  return dataForSeo.hostFromWebsite(raw);
}

router.get('/', async (req, res, next) => {
  try {
    const integrationEnv = await workspaceIntegrations.getResolvedIntegrationEnv(req.workspaceId);
    const dfsReady = dataForSeo.isConfigured(integrationEnv);
    const projects = await seoGapStore.listProjects(req.workspaceId);
    res.render('seo_gap', {
      title: 'SEO Gap | Agency OS',
      activePage: 'seo-gap',
      dfsReady,
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
    const project = await seoGapStore.getProject(req.workspaceId, req.params.id);
    if (!project) return res.status(404).render('error', { message: 'SEO project not found.', activePage: 'seo-gap' });
    const integrationEnv = await workspaceIntegrations.getResolvedIntegrationEnv(req.workspaceId);
    const projects = await seoGapStore.listProjects(req.workspaceId);
    res.render('seo_gap', {
      title: `${project.seedDomain} · SEO Gap | Agency OS`,
      activePage: 'seo-gap',
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
    const project = await seoGapStore.upsertProject(req.workspaceId, {
      seedDomain,
      locationCode: Number(body.locationCode) || 2840,
      languageCode: String(body.languageCode || 'en').slice(0, 8),
      maxCompetitors: Math.min(5, Math.max(1, Number(body.maxCompetitors) || 3)),
      keywordLimit: Math.min(200, Math.max(20, Number(body.keywordLimit) || 80)),
      competitors: Array.isArray(body.competitors)
        ? body.competitors.map((d) => ({ domain: hostFrom(d), source: 'manual' })).filter((c) => c.domain)
        : [],
      syncStatus: 'new',
      gapRows: [],
      youRankings: [],
      competitorRankings: [],
    });
    return res.json({ success: true, project, url: `/seo-gap/${encodeURIComponent(project.id)}` });
  } catch (err) {
    return res.status(500).json({ success: false, error: err && err.message ? err.message : 'Create failed' });
  }
});

router.post('/:id/sync', express.json(), async (req, res) => {
  try {
    const project = await seoGapStore.getProject(req.workspaceId, req.params.id);
    if (!project) return res.status(404).json({ success: false, error: 'Project not found.' });
    const integrationEnv = await workspaceIntegrations.getResolvedIntegrationEnv(req.workspaceId);
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const updated = await syncProjectFromDataForSeo(project, {
      integrationEnv,
      rediscoverCompetitors: body.rediscoverCompetitors !== false,
      persist: true,
    });
    return res.json({
      success: true,
      project: updated,
      summary: updated.gapSummary,
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

router.post('/:id/analyze', express.json(), async (req, res) => {
  try {
    const project = await seoGapStore.getProject(req.workspaceId, req.params.id);
    if (!project) return res.status(404).json({ success: false, error: 'Project not found.' });
    if (!Array.isArray(project.gapRows) || !project.gapRows.length) {
      return res.status(400).json({
        success: false,
        error: 'Sync DataForSEO data first so there are gap keywords to analyze.',
      });
    }
    const integrationEnv = await workspaceIntegrations.getResolvedIntegrationEnv(req.workspaceId);
    const plan = await generateActionPlan(project, { integrationEnv });
    const updated = await seoGapStore.upsertProject(req.workspaceId, {
      ...project,
      actionPlan: plan,
      actionPlanAt: new Date().toISOString(),
    });
    return res.json({ success: true, actionPlan: plan, project: updated });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err && err.message ? err.message : 'Analyze failed',
    });
  }
});

router.get('/:id/export.csv', async (req, res, next) => {
  try {
    const project = await seoGapStore.getProject(req.workspaceId, req.params.id);
    if (!project) return res.status(404).send('Not found');
    const rows = Array.isArray(project.gapRows) ? project.gapRows : [];
    const header = [
      'keyword',
      'gap_type',
      'you_pos',
      'rival_pos',
      'rival_domain',
      'volume',
      'kd',
      'opportunity_score',
    ];
    const esc = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const lines = [header.join(',')].concat(
      rows.map((r) =>
        [
          r.keyword,
          r.gapType,
          r.youPos,
          r.rivalPos,
          r.rivalDomain,
          r.volume,
          r.kd,
          r.opportunityScore,
        ]
          .map(esc)
          .join(','),
      ),
    );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="seo-gap-${project.seedDomain || 'export'}.csv"`,
    );
    return res.send(lines.join('\n'));
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const ok = await seoGapStore.deleteProject(req.workspaceId, req.params.id);
    if (!ok) return res.status(404).json({ success: false, error: 'Not found' });
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: err && err.message ? err.message : 'Delete failed' });
  }
});

module.exports = router;
