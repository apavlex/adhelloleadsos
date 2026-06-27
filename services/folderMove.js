/**
 * Reparent workspace folders (e.g. move from Other → Businesses).
 */

const dbService = require('./database');
const { buildFolderTree } = require('./folderTree');
const { findFolderForJobType } = require('./pipelineFolders');
const { JOB_TYPES } = require('./scrapeJobTypes');

function foldersByKey(folders) {
  const map = new Map();
  for (const folder of folders || []) {
    if (!folder || !folder.key) continue;
    map.set(String(folder.key), folder);
  }
  return map;
}

function buildChildrenMap(folders) {
  const map = new Map();
  for (const folder of folders || []) {
    if (!folder || !folder.key) continue;
    const parent = String(folder.parentFolderKey || '').trim();
    if (!parent) continue;
    if (!map.has(parent)) map.set(parent, []);
    map.get(parent).push(String(folder.key));
  }
  return map;
}

function collectDescendantKeys(folderKey, childrenMap) {
  const root = String(folderKey || '').trim();
  const out = new Set();
  if (!root) return out;
  const queue = [root];
  while (queue.length) {
    const k = queue.shift();
    for (const child of childrenMap.get(k) || []) {
      if (out.has(child)) continue;
      out.add(child);
      queue.push(child);
    }
  }
  return out;
}

function resolveInheritedJobType(parentFolder, byKey) {
  if (!parentFolder) return '';
  if (parentFolder.isPipelineDefault && parentFolder.jobType) {
    return String(parentFolder.jobType);
  }
  if (parentFolder.jobType) return String(parentFolder.jobType);

  let cur = parentFolder;
  let guard = 0;
  while (cur && cur.parentFolderKey && guard < 32) {
    cur = byKey.get(String(cur.parentFolderKey));
    guard += 1;
    if (!cur) break;
    if (cur.jobType) return String(cur.jobType);
    if (cur.isPipelineDefault && cur.jobType) return String(cur.jobType);
  }
  return '';
}

/**
 * @param {object[]} folders
 * @param {string} folderKey
 * @param {string} newParentKey — empty string = top-level Other folders
 */
function validateFolderMove(folders, folderKey, newParentKey) {
  const key = String(folderKey || '').trim();
  const parentKey = String(newParentKey || '').trim();
  if (!key) return { ok: false, error: 'folderKey is required.' };

  const list = Array.isArray(folders) ? folders.filter(Boolean) : [];
  const byKey = foldersByKey(list);
  const folder = byKey.get(key);
  if (!folder) return { ok: false, error: 'Folder not found.' };
  if (folder.isPipelineDefault) {
    return { ok: false, error: 'System folders cannot be moved.' };
  }
  if (folder.isTradeFolder) {
    return { ok: false, error: 'Trade subfolders are managed automatically.' };
  }

  if (parentKey === key) {
    return { ok: false, error: 'A folder cannot be moved under itself.' };
  }

  const childrenMap = buildChildrenMap(list);
  const descendants = collectDescendantKeys(key, childrenMap);
  if (parentKey && descendants.has(parentKey)) {
    return { ok: false, error: 'Cannot move a folder under one of its subfolders.' };
  }

  let parentFolder = null;
  if (parentKey) {
    parentFolder = byKey.get(parentKey);
    if (!parentFolder) return { ok: false, error: 'Destination folder not found.' };
  }

  const patch = {
    parentFolderKey: parentKey || '',
    jobType: parentKey ? resolveInheritedJobType(parentFolder, byKey) : '',
  };

  return { ok: true, folder, parentFolder, patch };
}

/**
 * @param {string} workspaceId
 * @param {string} folderKey
 * @param {string} newParentKey
 */
async function moveFolder(workspaceId, folderKey, newParentKey) {
  const wid = workspaceId || 'default';
  const folders = await dbService.listFolders(wid);
  const validation = validateFolderMove(folders, folderKey, newParentKey);
  if (!validation.ok) return validation;

  const updated = await dbService.updateFolder(wid, folderKey, validation.patch);
  if (!updated) return { ok: false, error: 'Folder not found.' };

  return { ok: true, folder: updated };
}

/**
 * Flat list of valid move destinations for UI pickers.
 * @param {object[]} folders
 * @param {string} [movingFolderKey] — exclude self + descendants
 */
function buildFolderMoveOptions(folders, movingFolderKey) {
  const list = Array.isArray(folders) ? folders.filter(Boolean) : [];
  const tree = buildFolderTree(list);
  const childrenMap = buildChildrenMap(list);
  const blocked = new Set();
  const movingKey = String(movingFolderKey || '').trim();
  if (movingKey) {
    blocked.add(movingKey);
    for (const d of collectDescendantKeys(movingKey, childrenMap)) blocked.add(d);
  }

  const options = [
    {
      key: '',
      label: 'Other folders (top-level)',
      groupName: 'Ungrouped',
      depth: 0,
    },
  ];

  for (const group of tree.groups || []) {
    const groupName = String(group.name || 'Folders');
    if (group.folder && group.isSystem && !blocked.has(String(group.folder.key))) {
      options.push({
        key: String(group.folder.key),
        label: String(group.folder.name || groupName),
        groupName,
        depth: 0,
        isSystem: true,
      });
    }
    for (const row of group.childRows || []) {
      const folder = row.folder;
      if (!folder || !folder.key || blocked.has(String(folder.key))) continue;
      const depth = row.depth || 1;
      const prefix = depth > 1 ? '\u21b3 '.repeat(depth) : '\u21b3 ';
      options.push({
        key: String(folder.key),
        label: prefix + String(folder.name || 'Folder'),
        groupName,
        depth,
        isTrade: !!folder.isTradeFolder,
      });
    }
  }

  return options;
}

module.exports = {
  validateFolderMove,
  moveFolder,
  buildFolderMoveOptions,
  collectDescendantKeys,
  buildChildrenMap,
  resolveInheritedJobType,
  findFolderForJobType,
  JOB_TYPES,
};
