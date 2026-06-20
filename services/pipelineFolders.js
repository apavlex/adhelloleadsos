/**
 * Default pipeline folders — one table per search type (maps, mobile homes, real estate).
 */

const dbService = require('./database');
const { JOB_TYPES, normalizeJobType } = require('./scrapeJobTypes');
const { isWarmSource, isManualSource, leadJobType } = require('./leadListFilters');
const { TRADE_FOLDERS } = require('./tradeFoldersCatalog');
const { normalizeSearchPreset } = require('./folderSearchPreset');
const { buildFolderTree } = require('./folderTree');
const { matchFolderToTrade } = require('./folderTradeMatcher');

const DEFAULT_PIPELINE_FOLDERS = {
  [JOB_TYPES.MAPS_BUSINESS]: { name: 'Businesses', sourceType: 'maps_business' },
  [JOB_TYPES.REAL_ESTATE]: { name: 'Real estate', sourceType: 'real_estate' },
  [JOB_TYPES.HOME_OWNERS]: { name: 'Home owners', sourceType: 'home_owners' },
  [JOB_TYPES.PRODUCTS]: { name: 'Products', sourceType: 'product_listing' },
  [JOB_TYPES.WHOLESALE]: { name: 'Wholesale', sourceType: 'wholesale_listing' },
};

function sourceForJobType(jobType) {
  const jt = normalizeJobType(jobType);
  if (jt === JOB_TYPES.HOME_OWNERS) return 'home_owners_search';
  if (jt === JOB_TYPES.PRODUCTS) return 'products_search';
  if (jt === JOB_TYPES.WHOLESALE) return 'wholesale_search';
  if (jt === JOB_TYPES.REAL_ESTATE) return 'real_estate_search';
  return 'maps_search';
}

function findFolderForJobType(folders, jobType) {
  const jt = normalizeJobType(jobType);
  const defName = DEFAULT_PIPELINE_FOLDERS[jt]?.name || '';
  const byJobType = (folders || []).find((f) => f && String(f.jobType || '') === jt);
  if (byJobType) return byJobType;

  if (jt === JOB_TYPES.REAL_ESTATE) {
    const legacy =
      (folders || []).find((f) => f && String(f.jobType || '') === JOB_TYPES.MOBILE_HOMES) ||
      (folders || []).find(
        (f) =>
          f &&
          f.isPipelineDefault &&
          String(f.name || '')
            .trim()
            .toLowerCase() === 'mobile homes'
      );
    if (legacy) return legacy;
  }

  return (
    (folders || []).find(
      (f) =>
        f &&
        f.isPipelineDefault &&
        String(f.name || '').trim() === String(defName).trim()
    ) || null
  );
}

/**
 * Ensure default pipeline folders exist for each search type.
 * @returns {Promise<object[]>}
 */
async function ensurePipelineFolders(workspaceId) {
  const wid = workspaceId || 'default';
  const folders = await dbService.listFolders(wid);
  const out = [...folders];
  const ws = (await dbService.getWorkspace(wid)) || {};
  const hidden = new Set(
    (ws.pipelineSettings && Array.isArray(ws.pipelineSettings.hiddenDefaultFolders)
      ? ws.pipelineSettings.hiddenDefaultFolders
      : []
    ).map((s) => String(s || '').trim())
  );

  for (const [jobType, def] of Object.entries(DEFAULT_PIPELINE_FOLDERS)) {
    if (hidden.has(jobType)) continue;
    if (findFolderForJobType(out, jobType)) continue;
    const created = await dbService.createFolder(wid, def.name, {
      jobType,
      isPipelineDefault: true,
    });
    out.push(created);
  }

  return out.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
}

/**
 * Seed ServiceTitan trade subfolders under the Businesses system folder.
 * @returns {Promise<object[]>} updated folder list
 */
async function ensureTradeSubfolders(workspaceId, folders) {
  const wid = workspaceId || 'default';
  const businessRoot = findFolderForJobType(folders, JOB_TYPES.MAPS_BUSINESS);
  if (!businessRoot || !businessRoot.key) return folders;

  const parentKey = String(businessRoot.key);
  const existingSlugs = new Set(
    (folders || [])
      .filter((f) => f && f.tradeSlug)
      .map((f) => String(f.tradeSlug))
  );
  const existingNames = new Set(
    (folders || [])
      .filter((f) => f && (f.isTradeFolder || f.tradeSlug || String(f.jobType || '') === JOB_TYPES.MAPS_BUSINESS))
      .map((f) => String(f.name || '').trim().toLowerCase())
      .filter(Boolean)
  );

  const out = [...folders];
  for (const trade of TRADE_FOLDERS) {
    if (existingSlugs.has(trade.slug)) continue;
    if (existingNames.has(String(trade.name).trim().toLowerCase())) continue;

    const searchPreset = normalizeSearchPreset({
      jobType: JOB_TYPES.MAPS_BUSINESS,
      keyword: trade.keyword,
      maxResults: 25,
      mapsProvider: 'auto',
      directorySupplement: true,
    });

    // eslint-disable-next-line no-await-in-loop
    const created = await dbService.createFolder(wid, trade.name, {
      parentFolderKey: parentKey,
      jobType: JOB_TYPES.MAPS_BUSINESS,
      isTradeFolder: true,
      tradeSlug: trade.slug,
      searchPreset,
    });
    out.push(created);
    existingSlugs.add(trade.slug);
    existingNames.add(String(trade.name).trim().toLowerCase());
  }

  return out;
}

/**
 * Remove duplicate folders with the same name (keeps trade/system-linked copy).
 */
async function consolidateDuplicateFolders(workspaceId, folders) {
  const wid = workspaceId || 'default';
  const byName = new Map();
  for (const folder of folders || []) {
    if (!folder || folder.isPipelineDefault || !folder.key) continue;
    const name = String(folder.name || '')
      .trim()
      .toLowerCase();
    if (!name) continue;
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push(folder);
  }

  let removed = 0;
  for (const [, group] of byName) {
    if (group.length < 2) continue;
    const score = (f) =>
      (f.isTradeFolder ? 8 : 0) +
      (f.tradeSlug ? 4 : 0) +
      (f.parentFolderKey ? 2 : 0) +
      (f.searchPreset ? 1 : 0);
    group.sort((a, b) => score(b) - score(a));
    const keep = group[0];
    for (let i = 1; i < group.length; i += 1) {
      const dup = group[i];
      // eslint-disable-next-line no-await-in-loop
      await dbService.reassignLeadsToFolder(wid, dup.key, keep.key);
      // eslint-disable-next-line no-await-in-loop
      await dbService.deleteFolder(wid, dup.key);
      removed += 1;
    }
  }

  if (!removed) return { folders, stats: { removed: 0 } };
  return { folders: await dbService.listFolders(wid), stats: { removed } };
}

function isLegacyMobileHomesFolder(folder) {
  if (!folder || folder.isPipelineDefault === false) return false;
  const jt = String(folder.jobType || '').trim();
  if (jt === JOB_TYPES.MOBILE_HOMES) return true;
  return (
    String(folder.name || '')
      .trim()
      .toLowerCase() === 'mobile homes'
  );
}

async function hideLegacyMobileHomesJobType(workspaceId) {
  const wid = workspaceId || 'default';
  const ws = (await dbService.getWorkspace(wid)) || { id: wid, members: {} };
  const prev = ws.pipelineSettings || {};
  const hidden = new Set(
    (Array.isArray(prev.hiddenDefaultFolders) ? prev.hiddenDefaultFolders : []).map((s) =>
      String(s || '').trim()
    )
  );
  hidden.add(JOB_TYPES.MOBILE_HOMES);
  ws.pipelineSettings = {
    ...prev,
    hiddenDefaultFolders: [...hidden],
  };
  await dbService.saveWorkspace(wid, ws);
}

/**
 * Merge duplicate Mobile homes system folder into Real estate (or convert in place).
 * @returns {Promise<{ folders: object[], stats: object }>}
 */
async function migrateLegacyMobileHomesFolder(workspaceId, folders) {
  const wid = workspaceId || 'default';
  const list = [...(folders || [])];
  const legacy = list.find(isLegacyMobileHomesFolder);
  const stats = { moved: 0, removed: false, converted: false };

  if (!legacy) return { folders: list, stats };

  const realEstateByJob = list.find(
    (f) => f && f.isPipelineDefault && String(f.jobType || '') === JOB_TYPES.REAL_ESTATE
  );

  if (!realEstateByJob) {
    const updated = await dbService.updateFolder(wid, legacy.key, {
      jobType: JOB_TYPES.REAL_ESTATE,
      name: DEFAULT_PIPELINE_FOLDERS[JOB_TYPES.REAL_ESTATE].name,
      isPipelineDefault: true,
    });
    await hideLegacyMobileHomesJobType(wid);
    stats.converted = true;
    const out = list.map((f) => (f.key === legacy.key ? { ...f, ...updated } : f));
    return { folders: out, stats };
  }

  if (realEstateByJob.key === legacy.key) {
    await hideLegacyMobileHomesJobType(wid);
    return { folders: list, stats };
  }

  stats.moved = await dbService.reassignLeadsToFolder(wid, legacy.key, realEstateByJob.key);
  await dbService.deleteFolder(wid, legacy.key);
  await hideLegacyMobileHomesJobType(wid);
  stats.removed = true;

  return {
    folders: list.filter((f) => f.key !== legacy.key),
    stats,
  };
}

function tradeFolderBySlug(folders, businessRootKey, slug) {
  return (folders || []).find(
    (f) =>
      f &&
      String(f.parentFolderKey || '') === String(businessRootKey) &&
      String(f.tradeSlug || '') === String(slug)
  );
}

/**
 * Parent custom trade-like folders under matching ServiceTitan trade subfolders.
 * @returns {Promise<{ folders: object[], stats: object }>}
 */
async function autoParentTradeLikeFolders(workspaceId, folders) {
  const wid = workspaceId || 'default';
  const list = [...(folders || [])];
  const businessRoot = findFolderForJobType(list, JOB_TYPES.MAPS_BUSINESS);
  if (!businessRoot || !businessRoot.key) {
    return { folders: list, stats: { parented: 0, merged: 0 } };
  }

  const businessRootKey = String(businessRoot.key);
  const foldersByKey = new Map(list.map((f) => [String(f.key), f]));
  const stats = { parented: 0, merged: 0 };

  for (const folder of list) {
    if (!folder || folder.isPipelineDefault || folder.isTradeFolder) continue;

    const jt = String(folder.jobType || '').trim();
    if (jt && jt !== JOB_TYPES.MAPS_BUSINESS) continue;

    const match = matchFolderToTrade(folder.name);
    if (!match) continue;

    const tradeFolder = tradeFolderBySlug(list, businessRootKey, match.slug);
    if (!tradeFolder || !tradeFolder.key) continue;

    const tradeKey = String(tradeFolder.key);
    const currentParent = String(folder.parentFolderKey || '').trim();

    if (currentParent === tradeKey) continue;

    const normalizedName = String(folder.name || '')
      .trim()
      .toLowerCase();
    const tradeName = String(tradeFolder.name || '')
      .trim()
      .toLowerCase();

    if (normalizedName === tradeName && currentParent !== tradeKey) {
      const moved = await dbService.reassignLeadsToFolder(wid, folder.key, tradeKey);
      await dbService.deleteFolder(wid, folder.key);
      stats.merged += 1;
      stats.moved = (stats.moved || 0) + moved;
      continue;
    }

    if (currentParent && currentParent !== businessRootKey) {
      const parentFolder = foldersByKey.get(currentParent);
      if (parentFolder && parentFolder.isTradeFolder) continue;
    }

    const updated = await dbService.updateFolder(wid, folder.key, {
      parentFolderKey: tradeKey,
      jobType: JOB_TYPES.MAPS_BUSINESS,
    });
    if (updated) {
      Object.assign(folder, updated);
      stats.parented += 1;
    }
  }

  const refreshed = await dbService.listFolders(wid);
  return { folders: refreshed, stats };
}

/**
 * One-time folder hygiene: mobile homes → real estate, trade-like folders → trade parents.
 * @returns {Promise<{ folders: object[], stats: object }>}
 */
async function migrateLegacyFolders(workspaceId, folders) {
  let list = [...(folders || [])];
  const stats = { mobileHomes: {}, tradeFolders: {} };

  const mh = await migrateLegacyMobileHomesFolder(workspaceId, list);
  list = mh.folders;
  stats.mobileHomes = mh.stats;

  list = await ensurePipelineFolders(workspaceId);
  list = await ensureTradeSubfolders(workspaceId, list);

  const deduped = await consolidateDuplicateFolders(workspaceId, list);
  list = deduped.folders;
  stats.duplicates = deduped.stats;

  const trade = await autoParentTradeLikeFolders(workspaceId, list);
  list = trade.folders;
  stats.tradeFolders = trade.stats;

  return { folders: list, stats };
}

async function ensurePipelineFoldersWithTree(workspaceId) {
  const folders = await ensurePipelineFolders(workspaceId);
  const withTrades = await ensureTradeSubfolders(workspaceId, folders);
  const migrated = await migrateLegacyFolders(workspaceId, withTrades);
  return {
    folders: migrated.folders,
    folderTree: buildFolderTree(migrated.folders),
    migrationStats: migrated.stats,
  };
}

async function hideDefaultPipelineFolder(workspaceId, jobType) {
  const jt = normalizeJobType(jobType);
  if (!DEFAULT_PIPELINE_FOLDERS[jt]) return;
  const wid = workspaceId || 'default';
  const ws = (await dbService.getWorkspace(wid)) || { id: wid, members: {} };
  const prev = ws.pipelineSettings || {};
  const hidden = new Set(
    (Array.isArray(prev.hiddenDefaultFolders) ? prev.hiddenDefaultFolders : []).map((s) =>
      String(s || '').trim()
    )
  );
  hidden.add(jt);
  ws.pipelineSettings = {
    ...prev,
    hiddenDefaultFolders: [...hidden],
  };
  await dbService.saveWorkspace(wid, ws);
}

/**
 * Delete folder, unassign leads, and prevent auto-recreate for system pipeline folders.
 */
async function deleteFolderComplete(workspaceId, folderKey) {
  const wid = workspaceId || 'default';
  const folder = await dbService.getFolder(wid, folderKey);
  if (!folder) {
    return { deleted: false, error: 'Folder not found.' };
  }

  const unassigned = await dbService.unassignLeadsFromFolder(wid, folder.key);
  await dbService.deleteFolder(wid, folder.key);

  if (folder.isPipelineDefault && folder.jobType) {
    await hideDefaultPipelineFolder(wid, folder.jobType);
  }

  return {
    deleted: true,
    unassigned,
    wasPipelineDefault: !!folder.isPipelineDefault,
    jobType: folder.jobType || null,
  };
}

/**
 * Resolve folder for a Find / schedule request.
 * Auto-assigns the default pipeline folder for the job type when none is chosen.
 */
async function resolveTargetFolder(workspaceId, options = {}) {
  const wid = workspaceId || 'default';
  const jobType = normalizeJobType(options.jobType);
  const requestedFolderKey = String(options.folderKey || '').trim();
  const newFolderName = String(options.newFolderName || '').trim();
  const autoDefault = options.autoDefault !== false;

  let folders = await ensurePipelineFolders(wid);

  if (newFolderName) {
    const folder = await dbService.createFolder(wid, newFolderName);
    return {
      targetFolderKey: folder && folder.key ? String(folder.key) : '',
      targetFolderName: folder && folder.name ? String(folder.name) : newFolderName,
      jobType,
    };
  }

  if (requestedFolderKey && requestedFolderKey !== '__new__') {
    const existing = folders.find((f) => f && String(f.key) === requestedFolderKey);
    if (!existing) {
      return { error: 'Selected folder no longer exists. Refresh and choose again.' };
    }
    return {
      targetFolderKey: String(existing.key),
      targetFolderName: String(existing.name || ''),
      jobType,
    };
  }

  if (autoDefault) {
    const defFolder = findFolderForJobType(folders, jobType);
    if (defFolder) {
      return {
        targetFolderKey: String(defFolder.key),
        targetFolderName: String(defFolder.name || DEFAULT_PIPELINE_FOLDERS[jobType]?.name || ''),
        jobType,
      };
    }
  }

  return { targetFolderKey: '', targetFolderName: '', jobType };
}

async function folderKeyForJobType(workspaceId, jobType) {
  const resolved = await resolveTargetFolder(workspaceId, { jobType, autoDefault: true });
  return resolved.targetFolderKey || '';
}

function leadMetadataForJobType(jobType, extra = {}) {
  const jt = normalizeJobType(jobType);
  const def = DEFAULT_PIPELINE_FOLDERS[jt] || {};
  const meta = {
    jobType: jt,
    source: sourceForJobType(jt),
  };
  if (def.sourceType) meta.sourceType = def.sourceType;
  if (extra.listing && typeof extra.listing === 'object') meta.listing = extra.listing;
  if (extra.realEstate && typeof extra.realEstate === 'object') meta.realEstate = extra.realEstate;
  return meta;
}

/**
 * Classify an unfiled lead for one-click pipeline migration.
 * @returns {string|null} jobType or null to skip (warm inbound, manual)
 */
function classifyLeadForPipelineMigration(lead) {
  if (!lead || String(lead.folderKey || '').trim()) return null;
  if (isWarmSource(lead)) return null;
  if (isManualSource(lead)) return null;

  const existing = leadJobType(lead);
  if (existing) return normalizeJobType(existing);

  return JOB_TYPES.MAPS_BUSINESS;
}

/**
 * Move unfiled leads into default pipeline folders by search type.
 * @param {string} workspaceId
 * @param {object[]} leads — workspace-visible leads (typically unfiled only)
 */
async function migrateUnfiledLeadsToPipelineFolders(workspaceId, leads) {
  const folders = await ensurePipelineFolders(workspaceId);
  const folderByJobType = {};
  for (const jt of Object.values(JOB_TYPES)) {
    const folder = findFolderForJobType(folders, jt);
    if (folder && folder.key) folderByJobType[jt] = String(folder.key);
  }

  const stats = {
    total: 0,
    maps_business: 0,
    real_estate: 0,
    home_owners: 0,
    products: 0,
    wholesale: 0,
    skipped: 0,
  };

  for (const lead of leads || []) {
    const jobType = classifyLeadForPipelineMigration(lead);
    if (!jobType) {
      stats.skipped += 1;
      continue;
    }

    const folderKey = folderByJobType[jobType];
    if (!folderKey) {
      stats.skipped += 1;
      continue;
    }

    const meta = leadMetadataForJobType(jobType, {
      listing: lead.listing,
      realEstate: lead.realEstate,
    });
    const patch = { folderKey };
    if (!lead.jobType) patch.jobType = meta.jobType;
    if (!lead.sourceType && meta.sourceType) patch.sourceType = meta.sourceType;
    const src = String(lead.source || '').trim();
    if (!src || src === 'nightly_prep') patch.source = meta.source;

    // eslint-disable-next-line no-await-in-loop
    await dbService.updateLead(lead.key, patch);
    stats[jobType] = (stats[jobType] || 0) + 1;
    stats.total += 1;
  }

  return stats;
}

module.exports = {
  DEFAULT_PIPELINE_FOLDERS,
  sourceForJobType,
  findFolderForJobType,
  ensurePipelineFolders,
  ensureTradeSubfolders,
  migrateLegacyFolders,
  migrateLegacyMobileHomesFolder,
  consolidateDuplicateFolders,
  autoParentTradeLikeFolders,
  ensurePipelineFoldersWithTree,
  resolveTargetFolder,
  folderKeyForJobType,
  leadMetadataForJobType,
  classifyLeadForPipelineMigration,
  migrateUnfiledLeadsToPipelineFolders,
  deleteFolderComplete,
  hideDefaultPipelineFolder,
};
