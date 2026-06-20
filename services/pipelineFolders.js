/**
 * Default pipeline folders — one table per search type (maps, mobile homes, real estate).
 */

const dbService = require('./database');
const { JOB_TYPES, normalizeJobType } = require('./scrapeJobTypes');

const DEFAULT_PIPELINE_FOLDERS = {
  [JOB_TYPES.MAPS_BUSINESS]: { name: 'Businesses (Maps)', sourceType: 'maps_business' },
  [JOB_TYPES.MOBILE_HOMES]: { name: 'Mobile homes', sourceType: 'mobile_home_listing' },
  [JOB_TYPES.REAL_ESTATE]: { name: 'Real estate', sourceType: 'real_estate' },
};

function sourceForJobType(jobType) {
  const jt = normalizeJobType(jobType);
  if (jt === JOB_TYPES.MOBILE_HOMES) return 'mobile_homes_search';
  if (jt === JOB_TYPES.REAL_ESTATE) return 'real_estate_search';
  return 'maps_search';
}

function findFolderForJobType(folders, jobType) {
  const jt = normalizeJobType(jobType);
  return (
    (folders || []).find((f) => f && String(f.jobType || '') === jt) ||
    (folders || []).find(
      (f) =>
        f &&
        f.isPipelineDefault &&
        String(f.name || '').trim() === String(DEFAULT_PIPELINE_FOLDERS[jt]?.name || '').trim()
    ) ||
    null
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

  for (const [jobType, def] of Object.entries(DEFAULT_PIPELINE_FOLDERS)) {
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

module.exports = {
  DEFAULT_PIPELINE_FOLDERS,
  sourceForJobType,
  findFolderForJobType,
  ensurePipelineFolders,
  resolveTargetFolder,
  folderKeyForJobType,
  leadMetadataForJobType,
};
