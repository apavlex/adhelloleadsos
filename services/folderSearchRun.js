/**
 * Replay a folder's saved search preset into that folder (incremental merge).
 */

const dbService = require('./database');
const workspaceIntegrations = require('./workspaceIntegrations');
const scrapeJobRunner = require('./scrapeJobRunner');
const { getWorkspaceIcp } = require('./workspaceIcp');
const { JOB_TYPES, normalizeJobType } = require('./scrapeJobTypes');
const { leadMetadataForJobType } = require('./pipelineFolders');
const {
  resolveEffectiveSearchPreset,
  schedulePayloadFromFolder,
  rememberFolderSearchFromRun,
  resolveAutoTagKeys,
} = require('./folderSearchPreset');

function locationFromLeads(leads) {
  const counts = new Map();
  for (const lead of leads || []) {
    const city = String(lead.city || '').trim();
    const state = String(lead.state || '')
      .trim()
      .slice(0, 2)
      .toUpperCase();
    if (!city || !state) continue;
    const key = `${city}|${state}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  let best = null;
  let bestN = 0;
  for (const [key, n] of counts) {
    if (n > bestN) {
      bestN = n;
      best = key;
    }
  }
  if (!best) return {};
  const [city, state] = best.split('|');
  return { city, state };
}

async function findLastSearchForFolder(workspaceId, folderKey) {
  const wid = workspaceId || 'default';
  const fk = String(folderKey || '').trim();
  if (!fk) return null;
  const keys = await dbService.listSearches();
  for (const key of keys.slice(0, 120)) {
    // eslint-disable-next-line no-await-in-loop
    const data = await dbService.getSearch(key);
    if (!data) continue;
    if ((data.workspaceId || 'default') !== wid) continue;
    if (String(data.targetFolderKey || '').trim() !== fk) continue;
    return { key, ...data };
  }
  return null;
}

async function persistResultsIntoFolder(workspaceId, folder, preset, results) {
  const wid = workspaceId || 'default';
  const folderKey = String(folder.key || '').trim();
  const jobType = normalizeJobType(preset.jobType || JOB_TYPES.MAPS_BUSINESS);
  const tagKeys =
    preset.autoTags && preset.autoTags.length ? await resolveAutoTagKeys(wid, preset.autoTags) : [];
  let added = 0;
  let merged = 0;
  for (const row of results || []) {
    const meta = leadMetadataForJobType(jobType, { folderKey });
    const payload = {
      ...row,
      ...meta,
      keyword: preset.keyword || preset.query || row.keyword,
      searchQuery: preset.keyword || preset.query || row.searchQuery,
      workspaceId: wid,
      savedAt: new Date().toISOString(),
    };
    if (tagKeys.length) payload.tags = tagKeys;
    // eslint-disable-next-line no-await-in-loop
    const saved = await dbService.saveLeadWithMeta(payload);
    if (saved && saved.merged) merged += 1;
    else added += 1;
  }
  return { added, merged, total: (results || []).length };
}

async function resolveFolderSearchRun(workspaceId, folderKey) {
  const wid = workspaceId || 'default';
  const fk = String(folderKey || '').trim();
  if (!fk) {
    return { ok: false, error: 'folderKey is required.', needSetup: false };
  }
  const folder = await dbService.getFolder(wid, fk);
  if (!folder) {
    return { ok: false, error: 'Folder not found.', needSetup: false };
  }
  const folders = await dbService.listFolders(wid);
  const parent =
    folder.parentFolderKey &&
    folders.find((f) => f && String(f.key) === String(folder.parentFolderKey));
  const ws = (await dbService.getWorkspace(wid)) || {};
  const icp = getWorkspaceIcp(ws);
  const lastSearch = await findLastSearchForFolder(wid, folder.key);
  const allLeads = await dbService.getAllLeads(wid);
  const folderLeads = allLeads.filter((l) => String(l.folderKey || '').trim() === String(folder.key));
  const sampleLocation = locationFromLeads(folderLeads);

  const resolved = resolveEffectiveSearchPreset(folder, {
    parent: parent || null,
    icp,
    lastSearch,
    sampleLocation,
  });
  return { ...resolved, folder, parent: parent || null };
}

async function kickoffFolderSearchInBackground({ workspaceId, folder, preset }) {
  const wid = workspaceId || 'default';
  const schedule = {
    ...schedulePayloadFromFolder(folder, { city: preset.city, state: preset.state }),
    ...preset,
    workspaceId: wid,
    targetFolderKey: folder.key,
    targetFolderName: folder.name,
  };

  await dbService.setActiveJob({
    type: 'search',
    jobType: schedule.jobType,
    keyword: schedule.keyword || schedule.query || folder.name,
    city: schedule.city,
    state: schedule.state,
    maxResults: schedule.maxResults,
    targetFolderKey: folder.key,
    targetFolderName: folder.name,
    source: 'folder_run',
  });

  setImmediate(async () => {
    let cleared = false;
    try {
      const integrationEnv = await workspaceIntegrations.getResolvedIntegrationEnv(wid);
      if (!scrapeJobRunner.isJobConfigured(schedule, integrationEnv)) {
        await dbService.clearActiveJob({
          failed: true,
          error:
            'Search is not configured. Add provider keys under Workspace → API integrations.',
        });
        cleared = true;
        return;
      }

      const results = await scrapeJobRunner.executeScrapeJob(schedule, integrationEnv, {
        directorySupplement: schedule.directorySupplement === true,
      });
      const persist = await persistResultsIntoFolder(wid, folder, schedule, results);
      const searchRecord = scrapeJobRunner.buildSearchRecord(
        schedule,
        results,
        new Date().toISOString()
      );
      searchRecord.savedCount = persist.added;
      searchRecord.mergedCount = persist.merged;
      const searchKey = await dbService.saveSearch(searchRecord);
      await rememberFolderSearchFromRun(wid, folder.key, {
        ...searchRecord,
        searchKey,
        directorySupplement: schedule.directorySupplement,
      });
      await dbService.clearActiveJob({
        resultCount: results.length,
        searchKey,
        savedCount: persist.added,
      });
      cleared = true;
      console.log(
        `[FOLDER-SEARCH] ${folder.name}: ${persist.added} new, ${persist.merged} already in pipeline (${results.length} results)`
      );
    } catch (err) {
      console.error('[FOLDER-SEARCH] Background search failed:', err);
      const msg = err && err.message ? String(err.message) : 'Search failed';
      await dbService.clearActiveJob({ failed: true, error: msg });
      cleared = true;
    } finally {
      if (!cleared) {
        try {
          await dbService.clearActiveJob({
            failed: true,
            error: 'Search ended unexpectedly.',
          });
        } catch (clearErr) {
          console.error('[FOLDER-SEARCH] Failed to clear active job:', clearErr);
        }
      }
    }
  });

  return {
    keyword: schedule.keyword || schedule.query || folder.name,
    city: schedule.city || '',
    state: schedule.state || '',
    jobType: schedule.jobType,
  };
}

async function startFolderSearch(workspaceId, folderKey) {
  const active = await dbService.getActiveJob();
  if (active) {
    return {
      ok: false,
      busy: true,
      error: 'A search is already running. Wait for the bell, then try again.',
    };
  }

  const resolved = await resolveFolderSearchRun(workspaceId, folderKey);
  if (!resolved.ok) return resolved;

  const started = await kickoffFolderSearchInBackground({
    workspaceId,
    folder: resolved.folder,
    preset: resolved.preset,
  });

  return {
    ok: true,
    started: true,
    folderKey: resolved.folder.key,
    folderName: resolved.folder.name,
    preset: resolved.preset,
    ...started,
    message:
      'Search started in the background. Keep working — the bell will notify you when new leads are merged into this folder.',
  };
}

module.exports = {
  locationFromLeads,
  findLastSearchForFolder,
  persistResultsIntoFolder,
  resolveFolderSearchRun,
  startFolderSearch,
  kickoffFolderSearchInBackground,
};
