/**
 * Folder hierarchy — system roots, subfolders, and UI grouping.
 */

const { JOB_TYPES } = require('./scrapeJobTypes');

const SYSTEM_JOB_ORDER = [
  JOB_TYPES.MAPS_BUSINESS,
  JOB_TYPES.REAL_ESTATE,
  JOB_TYPES.HOME_OWNERS,
  JOB_TYPES.PRODUCTS,
  JOB_TYPES.WHOLESALE,
];

const OTHER_GROUP_KEY = '__other__';

function folderSearchText(folder) {
  const parts = [
    folder && folder.name,
    folder && folder.jobType,
    folder && folder.tradeSlug,
    folder && folder.parentFolderKey,
  ];
  return parts
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function resolveVirtualParentKey(folder, rootsByJobType) {
  if (!folder || folder.isPipelineDefault) return null;
  if (folder.parentFolderKey) return String(folder.parentFolderKey);
  const jt = String(folder.jobType || '').trim();
  if (jt && rootsByJobType[jt]) return rootsByJobType[jt].key;
  return OTHER_GROUP_KEY;
}

function sortFoldersByName(a, b) {
  return String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' });
}

function sortTradeBeforeCustom(a, b) {
  const aTrade = a.isTradeFolder ? 0 : 1;
  const bTrade = b.isTradeFolder ? 0 : 1;
  if (aTrade !== bTrade) return aTrade - bTrade;
  return sortFoldersByName(a, b);
}

/**
 * @param {object[]} folders
 * @returns {{ groups: object[], rootsByJobType: Record<string,object>, allFolders: object[] }}
 */
function buildFolderTree(folders) {
  const all = Array.isArray(folders) ? folders.filter(Boolean) : [];
  const roots = all.filter((f) => f.isPipelineDefault);
  const rootsByJobType = {};
  for (const root of roots) {
    if (root.jobType) rootsByJobType[String(root.jobType)] = root;
  }

  const rootsOrdered = SYSTEM_JOB_ORDER.map((jt) => rootsByJobType[jt]).filter(Boolean);

  const childrenByParent = new Map();
  for (const folder of all) {
    if (folder.isPipelineDefault) continue;
    const parentKey = resolveVirtualParentKey(folder, rootsByJobType);
    if (!parentKey || parentKey === OTHER_GROUP_KEY) continue;
    if (!childrenByParent.has(parentKey)) childrenByParent.set(parentKey, []);
    childrenByParent.get(parentKey).push(folder);
  }
  for (const [, kids] of childrenByParent) {
    kids.sort(sortTradeBeforeCustom);
  }

  const groups = rootsOrdered.map((root) => ({
    key: root.key,
    name: root.name,
    folder: root,
    isSystem: true,
    jobType: root.jobType || '',
    children: childrenByParent.get(root.key) || [],
  }));

  const orphans = all.filter((f) => {
    if (f.isPipelineDefault) return false;
    return resolveVirtualParentKey(f, rootsByJobType) === OTHER_GROUP_KEY;
  });
  orphans.sort(sortFoldersByName);

  if (orphans.length) {
    groups.push({
      key: OTHER_GROUP_KEY,
      name: 'Other folders',
      folder: null,
      isSystem: false,
      jobType: '',
      children: orphans,
    });
  }

  return { groups, rootsByJobType, allFolders: all };
}

function countLeadsInFolder(folderKey, countsByKey) {
  return (countsByKey && countsByKey[folderKey]) || 0;
}

function groupLeadTotal(children, countsByKey, rootKey) {
  let total = countLeadsInFolder(rootKey, countsByKey);
  for (const child of children || []) {
    total += countLeadsInFolder(child.key, countsByKey);
  }
  return total;
}

module.exports = {
  SYSTEM_JOB_ORDER,
  OTHER_GROUP_KEY,
  folderSearchText,
  buildFolderTree,
  countLeadsInFolder,
  groupLeadTotal,
};
