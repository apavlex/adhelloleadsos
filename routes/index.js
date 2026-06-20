const express = require('express');
const router = express.Router();
const dbService = require('../services/database');
const { filterLeadsForRequest } = require('../services/workspaceService');
const { getWorkspaceIcp } = require('../services/workspaceIcp');
const { getGoogleMapsApiKey } = require('../services/googleMapsKey');
const { ensurePipelineFolders } = require('../services/pipelineFolders');
const { JOB_TYPES } = require('../services/scrapeJobTypes');
const { searchPresetToFindContext, normalizeSearchPreset } = require('../services/folderSearchPreset');

async function renderFindLeads(req, res, next) {
  try {
    const allLeads = await dbService.getAllLeads(req.workspaceId);
    const leads = filterLeadsForRequest(req, allLeads);
    const adhelloLeads = leads.filter((l) => l.source && l.source.startsWith('adhello_'));
    const workspaceLeads = leads;
    const mapCenterRaw = (process.env.GOOGLE_MAPS_DEFAULT_CENTER || '45.5152,-122.6784').trim();
    const mapCenterParts = mapCenterRaw.split(',').map((s) => parseFloat(String(s).trim(), 10));
    const mapDefaultLat = Number.isFinite(mapCenterParts[0]) ? mapCenterParts[0] : 45.5152;
    const mapDefaultLng = Number.isFinite(mapCenterParts[1]) ? mapCenterParts[1] : -122.6784;
    const mapDefaultZoom = Math.max(
      3,
      Math.min(18, parseInt(process.env.GOOGLE_MAPS_DEFAULT_ZOOM || '11', 10) || 11)
    );

    const allSchedules = await dbService.listSchedules();
    const wid = req.workspaceId;
    const schedules = allSchedules.filter((s) => (s.workspaceId || 'default') === wid);
    const folders = await ensurePipelineFolders(wid);
    const pipelineFolderByType = {
      maps: folders.find((f) => f && f.jobType === JOB_TYPES.MAPS_BUSINESS) || null,
      mobile_homes: folders.find((f) => f && f.jobType === JOB_TYPES.MOBILE_HOMES) || null,
      real_estate: folders.find((f) => f && f.jobType === JOB_TYPES.REAL_ESTATE) || null,
    };

    const workspace = (await dbService.getWorkspace(wid)) || {};
    const presetIcp = String(req.query.preset || '').toLowerCase() === 'icp';
    const icp = getWorkspaceIcp(workspace);
    const mrQ = parseInt(req.query.maxResults, 10);
    const qtyIcp = Number.isFinite(mrQ) && mrQ > 0 ? Math.min(100, mrQ) : icp.qty || 50;

    const nightlyPrepMeta = workspace.nightlyPrep || {};

    let activeSearchFolder = null;
    let folderSearchPreset = null;
    const presetFolderKey = String(req.query.folderKey || '').trim();
    if (presetFolderKey) {
      activeSearchFolder = folders.find((f) => f && String(f.key) === presetFolderKey) || null;
      if (activeSearchFolder && activeSearchFolder.searchPreset) {
        folderSearchPreset = normalizeSearchPreset(activeSearchFolder.searchPreset);
      }
    }

    const rawType = String(
      req.query.type || (folderSearchPreset && folderSearchPreset.jobType) || 'maps'
    )
      .trim()
      .toLowerCase()
      .replace(/-/g, '_');

    let searchType =
      rawType === 'mobile_homes' || rawType === 'mobilehomes' || rawType === 'mobile'
        ? 'mobile_homes'
        : rawType === 'real_estate' || rawType === 'realestate' || rawType === 'zillow'
          ? 'real_estate'
          : 'maps';

    let searchPrefill = presetIcp
      ? {
          keyword: icp.keyword || 'plumber',
          city: icp.city || 'Austin',
          state: icp.state || 'TX',
          qty: qtyIcp,
        }
      : { keyword: '', city: '', state: '', qty: 20 };

    if (folderSearchPreset) {
      const ctx = searchPresetToFindContext(folderSearchPreset);
      if (ctx) {
        searchType = ctx.searchType;
        searchPrefill = { ...searchPrefill, ...ctx.searchPrefill };
      }
    }

    return res.render('index', {
      title: 'Agency OS | Daily Leads',
      activePage: 'find',
      searchType,
      savedLeadsCount: adhelloLeads.length,
      workspaceLeadsCount: workspaceLeads.length,
      warmInboundCount: adhelloLeads.length,
      totalPipelineCount: leads.length,
      googleMapsKey: getGoogleMapsApiKey(),
      mapDefaultLat,
      mapDefaultLng,
      mapDefaultZoom,
      schedules,
      folders,
      pipelineFolderByType,
      searchPrefill,
      presetIcp,
      nightlyPrepMeta,
      activeSearchFolder,
      folderSearchPreset,
      presetFolderKey,
    });
  } catch (e) {
    return next(e);
  }
}

router.get('/', (req, res) => {
  if (req.session && req.session.userId) {
    return res.redirect(302, '/today');
  }
  res.render('home', { title: 'AdHello — AI Consultant for Local Business' });
});
router.get('/home', (req, res) => {
  res.render('home', { title: 'AdHello — AI Consultant for Local Business' });
});
router.get('/leads/find', renderFindLeads);

router.get('/leads/find/real-estate', (req, res) => {
  const params = new URLSearchParams(req.query);
  params.set('type', 'real_estate');
  res.redirect(302, `/leads/find?${params.toString()}`);
});

router.get('/leads/find/mobile-homes', (req, res) => {
  const params = new URLSearchParams(req.query);
  params.set('type', 'mobile_homes');
  res.redirect(302, `/leads/find?${params.toString()}`);
});

/** Toggle overnight Maps prep for this workspace (cron: GET /api/cron/nightly-prep). */
router.post('/leads/find/nightly-prep-settings', express.urlencoded({ extended: true }), async (req, res, next) => {
  try {
    const wid = req.workspaceId;
    const ws = (await dbService.getWorkspace(wid)) || { id: wid, members: {} };
    const enabled = String(req.body.enabled || '').trim() === '1';
    ws.nightlyPrep = { ...(ws.nightlyPrep || {}), enabled };
    await dbService.saveWorkspace(wid, ws);
    res.redirect('/leads/find');
  } catch (e) {
    next(e);
  }
});

// GET /schedules — canonical UI is Prospecting → Queue (scheduled jobs table)
router.get('/schedules', (req, res) => {
  const params = new URLSearchParams();
  params.set('tab', 'queue');
  if (req.query.success === 'true') params.set('scheduleSuccess', 'true');
  res.redirect(302, `/prospecting?${params.toString()}`);
});

// POST /schedules/delete — Remove a scheduled job
router.post('/schedules/delete', async (req, res) => {
  const { key, returnTo } = req.body;
  if (key) {
    await dbService.deleteSchedule(key);
  }
  let dest = '/prospecting?tab=queue';
  if (returnTo === '/') dest = '/today';
  else if (returnTo && returnTo !== '/schedules') dest = returnTo;
  res.redirect(dest);
});

module.exports = router;
