/**
 * Merge one or more lead folders into a target folder:
 * moves leads, reparents subfolders, then deletes the empty source folders.
 */

const dbService = require('./database');
const { deleteFolderComplete } = require('./pipelineFolders');

/**
 * @param {object} opts
 * @param {string} opts.workspaceId
 * @param {string} opts.targetFolderKey
 * @param {string[]} opts.sourceFolderKeys
 * @returns {Promise<{ success: boolean, error?: string, movedLeads?: number, deletedFolders?: string[], targetFolder?: object }>}
 */
async function mergeFoldersInto({ workspaceId, targetFolderKey, sourceFolderKeys }) {
  const wid = workspaceId || 'default';
  const targetKey = String(targetFolderKey || '').trim();
  const sources = [...new Set((sourceFolderKeys || []).map((k) => String(k || '').trim()).filter(Boolean))];

  if (!targetKey) {
    return { success: false, error: 'Pick a destination folder to merge into.' };
  }
  if (!sources.length) {
    return { success: false, error: 'Select at least one folder to merge.' };
  }
  if (sources.includes(targetKey)) {
    return { success: false, error: 'A folder cannot be merged into itself. Deselect the destination folder.' };
  }

  const folders = await dbService.listFolders(wid);
  const byKey = new Map((folders || []).filter(Boolean).map((f) => [String(f.key), f]));
  const target = byKey.get(targetKey);
  if (!target) {
    return { success: false, error: 'Destination folder not found.' };
  }

  for (const key of sources) {
    const folder = byKey.get(key);
    if (!folder) {
      return { success: false, error: `Folder not found: ${key}` };
    }
    if (folder.isPipelineDefault) {
      return { success: false, error: `System folder “${folder.name}” cannot be merged away.` };
    }
    if (folder.isTradeFolder) {
      return { success: false, error: `Trade folder “${folder.name}” cannot be merged away.` };
    }
  }

  // Prevent merging a parent into one of its descendants (would orphan the tree).
  const childrenMap = new Map();
  for (const folder of folders || []) {
    if (!folder || !folder.key) continue;
    const parent = String(folder.parentFolderKey || '').trim();
    if (!parent) continue;
    if (!childrenMap.has(parent)) childrenMap.set(parent, []);
    childrenMap.get(parent).push(String(folder.key));
  }
  function descendantsOf(root) {
    const out = new Set();
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
  for (const key of sources) {
    if (descendantsOf(key).has(targetKey)) {
      const folder = byKey.get(key);
      return {
        success: false,
        error: `Cannot merge “${folder.name}” into one of its subfolders. Pick a different destination.`,
      };
    }
  }

  let movedLeads = 0;
  const deletedFolders = [];

  for (const sourceKey of sources) {
    // eslint-disable-next-line no-await-in-loop
    const moved = await dbService.reassignLeadsToFolder(wid, sourceKey, targetKey);
    movedLeads += moved;

    const children = (await dbService.listFolders(wid)).filter(
      (f) => f && String(f.parentFolderKey || '') === String(sourceKey),
    );
    for (const child of children) {
      // eslint-disable-next-line no-await-in-loop
      await dbService.updateFolder(wid, child.key, { parentFolderKey: targetKey });
    }

    // Leads already reassigned — deleteFolderComplete would unassign nothing useful now.
    // eslint-disable-next-line no-await-in-loop
    const del = await deleteFolderComplete(wid, sourceKey);
    if (del && del.deleted) deletedFolders.push(sourceKey);
  }

  const refreshed = await dbService.getFolder(wid, targetKey);
  return {
    success: true,
    movedLeads,
    deletedFolders,
    targetFolder: refreshed || target,
  };
}

module.exports = {
  mergeFoldersInto,
};
