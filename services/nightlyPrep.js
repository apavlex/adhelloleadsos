/**
 * Nightly prospecting prep: Maps search + enrichment → saved search + pipeline leads.
 * Triggered by Render cron (GET /api/cron/nightly-prep) when workspace nightlyPrep.enabled is set on Find leads.
 */

const mapsSearch = require('./mapsSearch');
const enricher = require('./enricher');
const workspaceIntegrations = require('./workspaceIntegrations');
const dbService = require('./database');
const { getWorkspaceIcp } = require('./workspaceIcp');
const { autoAttachCadenceIfNeeded } = require('./leadCadence');
const { sanitizeLeadCategoryName } = require('./leadCategory');

function mapsRowToLeadData(row, workspaceId, keyword) {
  const title = row.title || 'Unknown';
  const categoryRaw =
    row.categoryName && String(row.categoryName).trim() && row.categoryName !== 'N/A'
      ? row.categoryName
      : keyword || 'N/A';
  return {
    title,
    phone: row.phone || 'N/A',
    website: row.website || 'N/A',
    email: row.email || 'N/A',
    categoryName: sanitizeLeadCategoryName(categoryRaw, title, keyword || 'N/A'),
    address: row.address || 'N/A',
    city: row.city || '',
    state: row.state || '',
    totalScore: parseFloat(row.totalScore) || 0,
    reviewsCount: parseInt(row.reviewsCount, 10) || 0,
    url: row.url || '',
    facebook: row.facebook || 'N/A',
    instagram: row.instagram || 'N/A',
    twitter: row.twitter || 'N/A',
    status: 'Not Contacted',
    workspaceId,
    source: 'nightly_prep',
    savedAt: new Date().toISOString(),
  };
}

async function patchNightlyPrepMeta(workspaceId, patch) {
  const wid = String(workspaceId || '').trim();
  if (!wid) return;
  const ws = (await dbService.getWorkspace(wid)) || { id: wid, members: {} };
  ws.nightlyPrep = { ...(ws.nightlyPrep || {}), ...patch };
  await dbService.saveWorkspace(wid, ws);
}

/**
 * @param {string} workspaceId
 * @param {{ skipEnabledCheck?: boolean }} [opts]
 * @returns {Promise<{ ok: boolean, skipped?: string, error?: string, resultCount?: number, leadsSaved?: number }>}
 */
async function runNightlyPrep(workspaceId, opts = {}) {
  const wid = String(workspaceId || '').trim() || 'default';
  const ws = await dbService.getWorkspace(wid);

  if (!opts.skipEnabledCheck && !(ws && ws.nightlyPrep && ws.nightlyPrep.enabled)) {
    console.log(`[NIGHTLY-PREP] Skip workspace ${wid}: nightly prep not enabled`);
    return { ok: true, skipped: 'not_enabled' };
  }

  const icp = getWorkspaceIcp(ws || {});
  const keyword = String(icp.keyword || '').trim();
  const city = String(icp.city || '').trim();
  const state = String(icp.state || '').trim();

  if (!keyword || !city || !state) {
    const msg = 'ICP incomplete — set keyword, city, and state (Workspace / Find leads preset).';
    await patchNightlyPrepMeta(wid, {
      lastRunAt: new Date().toISOString(),
      lastStatus: 'skipped',
      lastError: msg,
    });
    console.warn(`[NIGHTLY-PREP] ${wid}: ${msg}`);
    return { ok: false, skipped: 'icp_incomplete', error: msg };
  }

  const maxResults = icp.qty || 50;
  const integrationEnv = await workspaceIntegrations.getResolvedIntegrationEnv(wid);

  if (!mapsSearch.isMapsSearchConfigured(integrationEnv)) {
    const msg = 'Maps search not configured (API keys).';
    await patchNightlyPrepMeta(wid, {
      lastRunAt: new Date().toISOString(),
      lastStatus: 'error',
      lastError: msg,
    });
    return { ok: false, error: msg };
  }

  await patchNightlyPrepMeta(wid, {
    lastRunStartedAt: new Date().toISOString(),
    lastStatus: 'running',
    lastError: null,
  });

  try {
    console.log(`[NIGHTLY-PREP] Maps search "${keyword}" in ${city}, ${state} (limit ${maxResults})…`);
    let results = await mapsSearch.searchGoogleMaps({
      keyword,
      city,
      state,
      maxResults,
      integrationEnv,
    });
    results = await enricher.enrichLeads(results, { workspaceId: wid });

    const searchRecord = {
      keyword,
      city,
      state,
      maxResults,
      resultCount: results.length,
      results,
      isAutopilot: true,
      isNightlyPrep: true,
      timestamp: new Date().toISOString(),
      workspaceId: wid,
    };
    const searchKey = await dbService.saveSearch(searchRecord);

    let leadsSaved = 0;
    for (const row of results) {
      try {
        const leadData = mapsRowToLeadData(row, wid, keyword);
        const leadKey = await dbService.saveLead(leadData);
        leadsSaved += 1;
        try {
          await autoAttachCadenceIfNeeded({ leadKey, workspaceId: wid });
        } catch {
          /* non-fatal */
        }
      } catch (e) {
        console.warn('[NIGHTLY-PREP] saveLead failed for row:', e.message);
      }
    }

    try {
      const wsMeta = await dbService.getWorkspace(wid);
      await dbService.recordCompletedSearchNotification({
        keyword,
        city,
        state,
        maxResults,
        resultCount: results.length,
        source: 'nightly_prep',
        workspaceId: wid,
        workspaceName: (wsMeta && wsMeta.name) || '',
      });
    } catch (notifyErr) {
      console.error('[NIGHTLY-PREP] notification failed:', notifyErr.message);
    }

    await patchNightlyPrepMeta(wid, {
      lastRunAt: new Date().toISOString(),
      lastStatus: 'ok',
      lastResultCount: results.length,
      lastLeadsSaved: leadsSaved,
      lastSearchKey: searchKey || '',
      lastKeyword: keyword,
      lastCity: city,
      lastState: state,
      lastError: null,
    });

    console.log(`[NIGHTLY-PREP] Done ${wid}: ${results.length} rows, ${leadsSaved} saved to pipeline.`);
    return { ok: true, resultCount: results.length, leadsSaved };
  } catch (err) {
    console.error('[NIGHTLY-PREP] Failed:', err);
    await patchNightlyPrepMeta(wid, {
      lastRunAt: new Date().toISOString(),
      lastStatus: 'error',
      lastError: err.message || String(err),
    });
    return { ok: false, error: err.message || String(err) };
  }
}

/**
 * Workspaces to process when cron fires (no explicit env list).
 * Only workspaces with nightlyPrep.enabled === true.
 */
async function listEnabledNightlyPrepWorkspaceIds() {
  const ids = await dbService.listWorkspaceIds();
  const out = [];
  for (const id of ids) {
    const ws = await dbService.getWorkspace(id);
    if (ws && ws.nightlyPrep && ws.nightlyPrep.enabled) out.push(id);
  }
  return out;
}

/**
 * @returns {Promise<{ ids: string[], skipEnabledCheck: boolean }>}
 */
async function getCronNightlyPrepTargets() {
  const explicit = String(process.env.NIGHTLY_PREP_WORKSPACE_IDS || '').trim();
  if (explicit) {
    return {
      ids: explicit.split(',').map((s) => s.trim()).filter(Boolean),
      skipEnabledCheck: true,
    };
  }
  const ids = await listEnabledNightlyPrepWorkspaceIds();
  return { ids, skipEnabledCheck: false };
}

module.exports = {
  runNightlyPrep,
  getCronNightlyPrepTargets,
  listEnabledNightlyPrepWorkspaceIds,
  mapsRowToLeadData,
};
