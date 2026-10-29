/**
 * Agency Backlinks module — DataForSEO Backlinks API (own site + competitors).
 * Competitors are user-selected from local Google Maps results (not Labs giants).
 */

const express = require('express');
const dataForSeo = require('../services/dataForSeoClient');
const workspaceIntegrations = require('../services/workspaceIntegrations');
const backlinksStore = require('../services/backlinksStore');
const { syncBacklinksProject } = require('../services/backlinksSync');
const { searchLocalCompetitors, cleanDomain } = require('../services/backlinksLocalCompetitors');
const localSeoStore = require('../services/localSeoStore');
const { isDirectoryOrPlatformDomain } = require('../services/backlinksParse');

const router = express.Router();

function hostFrom(raw) {
  return dataForSeo.hostFromWebsite(raw);
}

async function pageLocals(req, project) {
  const integrationEnv = await workspaceIntegrations.getResolvedIntegrationEnv(req.workspaceId);
  const projects = await backlinksStore.listProjects(req.workspaceId);
  const localSeo = await localSeoStore.load(req.workspaceId);
  const profile = localSeoStore.resolveBusinessProfile(req.workspace || { id: req.workspaceId }, localSeo.profile);
  return {
    title: project
      ? `${project.seedDomain} · Backlinks | Agency OS`
      : 'Backlinks | Agency OS',
    activePage: 'backlinks',
    dfsReady: dataForSeo.isConfigured(integrationEnv),
    projects,
    project: project || null,
    flashError: null,
    localSearchDefaults: {
      keyword:
        (Array.isArray(profile.keywords) && profile.keywords[0]) ||
        [profile.vertical, profile.city, profile.state].filter(Boolean).join(' ') ||
        '',
      city: profile.city || '',
      state: profile.state || '',
      businessName: profile.businessName || '',
    },
  };
}

router.get('/', async (req, res, next) => {
  try {
    res.render('backlinks', await pageLocals(req, null));
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
    res.render('backlinks', await pageLocals(req, project));
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
    const manualCompetitors = Array.isArray(body.competitors)
      ? body.competitors
          .map((d) => {
            if (d && typeof d === 'object') {
              return {
                domain: cleanDomain(d.domain || d),
                source: 'manual',
                title: d.title ? String(d.title).slice(0, 160) : null,
              };
            }
            return { domain: cleanDomain(d), source: 'manual', title: null };
          })
          .filter((c) => c.domain && c.domain !== seedDomain)
      : [];
    const project = await backlinksStore.upsertProject(req.workspaceId, {
      seedDomain,
      locationCode: Number(body.locationCode) || 2840,
      languageCode: String(body.languageCode || 'en').slice(0, 8),
      maxCompetitors: Math.min(5, Math.max(1, Number(body.maxCompetitors) || 3)),
      referringLimit: Math.min(200, Math.max(20, Number(body.referringLimit) || 80)),
      anchorLimit: Math.min(100, Math.max(10, Number(body.anchorLimit) || 40)),
      // Never Labs auto-discover — user picks local Maps rivals.
      autoDiscoverCompetitors: false,
      competitors: manualCompetitors,
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

router.post('/:id/local-competitors', express.json(), async (req, res) => {
  try {
    const project = await backlinksStore.getProject(req.workspaceId, req.params.id);
    if (!project) return res.status(404).json({ success: false, error: 'Project not found.' });
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const integrationEnv = await workspaceIntegrations.getResolvedIntegrationEnv(req.workspaceId);
    const localSeo = await localSeoStore.load(req.workspaceId);
    const profile = localSeoStore.resolveBusinessProfile(req.workspace || { id: req.workspaceId }, localSeo.profile);
    const result = await searchLocalCompetitors({
      keyword: body.keyword || body.query,
      city: body.city != null ? body.city : profile.city,
      state: body.state != null ? body.state : profile.state,
      locationName: body.locationName,
      locationCode: Number(body.locationCode) || project.locationCode || 2840,
      languageCode: project.languageCode || 'en',
      excludeDomain: project.seedDomain,
      businessName: body.businessName || profile.businessName,
      integrationEnv,
    });
    return res.json({ success: true, ...result });
  } catch (err) {
    const status =
      err && (err.code === 'DATAFORSEO_NOT_CONFIGURED' || err.code === 'NO_KEYWORD') ? 400 : 500;
    return res.status(status).json({
      success: false,
      error: err && err.message ? err.message : 'Local search failed',
      code: err && err.code,
    });
  }
});

router.post('/:id/competitors', express.json(), async (req, res) => {
  try {
    const project = await backlinksStore.getProject(req.workspaceId, req.params.id);
    if (!project) return res.status(404).json({ success: false, error: 'Project not found.' });
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const seed = hostFrom(project.seedDomain);
    const list = Array.isArray(body.competitors) ? body.competitors : [];
    const competitors = [];
    const seen = new Set();
    for (const raw of list) {
      const domain = cleanDomain(raw && typeof raw === 'object' ? raw.domain : raw);
      if (!domain || domain === seed || seen.has(domain) || isDirectoryOrPlatformDomain(domain)) continue;
      seen.add(domain);
      competitors.push({
        domain,
        source: (raw && raw.source) || 'manual',
        title: raw && raw.title ? String(raw.title).slice(0, 160) : null,
      });
      if (competitors.length >= 5) break;
    }
    const updated = await backlinksStore.upsertProject(req.workspaceId, {
      ...project,
      competitors,
      autoDiscoverCompetitors: false,
      // Clear stale Labs comparison until the next sync.
      comparison: [],
      competitorProfiles: [],
      linkGaps: [],
      summary: {
        ...(project.summary || {}),
        competitorCount: 0,
        linkGapCount: 0,
      },
    });
    return res.json({ success: true, project: updated, competitors: updated.competitors });
  } catch (err) {
    return res.status(500).json({ success: false, error: err && err.message ? err.message : 'Save failed' });
  }
});

router.post('/:id/sync', express.json(), async (req, res) => {
  try {
    const project = await backlinksStore.getProject(req.workspaceId, req.params.id);
    if (!project) return res.status(404).json({ success: false, error: 'Project not found.' });
    const integrationEnv = await workspaceIntegrations.getResolvedIntegrationEnv(req.workspaceId);
    const updated = await syncBacklinksProject(
      {
        ...project,
        autoDiscoverCompetitors: false,
        rediscoverCompetitors: false,
      },
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
