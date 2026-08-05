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
  JOB_TYPES.PERMITS,
  JOB_TYPES.BUSINESS_FORMATIONS,
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

function attachNestedChildren(parentKey, childrenByParent) {
  const kids = childrenByParent.get(parentKey) || [];
  return kids.map((child) => ({
    ...child,
    children: attachNestedChildren(child.key, childrenByParent),
  }));
}

function flattenFolderRows(nestedChildren, depth = 1) {
  const rows = [];
  for (const child of nestedChildren || []) {
    rows.push({ folder: child, depth });
    if (child.children && child.children.length) {
      rows.push(...flattenFolderRows(child.children, depth + 1));
    }
  }
  return rows;
}

function sumNestedLeadCounts(nodes, countsByKey) {
  let total = 0;
  for (const node of nodes || []) {
    total += countLeadsInFolder(node.key, countsByKey);
    total += sumNestedLeadCounts(node.children, countsByKey);
  }
  return total;
}

function dedupeFoldersByKey(folders) {
  const byKey = new Map();
  for (const folder of folders || []) {
    if (!folder || !folder.key) continue;
    byKey.set(String(folder.key), folder);
  }
  return [...byKey.values()];
}

/**
 * Flat, grouped folder options for searchable pipeline filter pickers.
 * @param {ReturnType<typeof buildFolderTree>} folderTree
 * @param {string} [selectedKey]
 */
function buildFolderPickerOptions(folderTree, selectedKey) {
  const selected = String(selectedKey || '').trim();
  const options = [
    {
      key: '',
      label: 'Main pipeline (unfiled)',
      groupKey: '',
      groupName: '',
      depth: 0,
      searchText: 'main pipeline unfiled',
      selected: !selected,
    },
  ];
  const seenKeys = new Set(['']);
  const seenTradeSlugs = new Set();

  for (const group of folderTree?.groups || []) {
    const groupName = String(group.name || '');
    if (group.folder && group.isSystem && !seenKeys.has(String(group.folder.key))) {
      seenKeys.add(String(group.folder.key));
      options.push({
        key: String(group.folder.key),
        label: String(group.folder.name || groupName),
        groupKey: String(group.key),
        groupName,
        depth: 0,
        isSystem: true,
        searchText: `${groupName} ${group.folder.name} system`.toLowerCase(),
        selected: selected === String(group.folder.key),
      });
    }
    for (const row of group.childRows || []) {
      const folder = row.folder;
      if (!folder || !folder.key || seenKeys.has(String(folder.key))) continue;
      const tradeSlug = String(folder.tradeSlug || '').trim();
      if (tradeSlug) {
        if (seenTradeSlugs.has(tradeSlug)) continue;
        seenTradeSlugs.add(tradeSlug);
      }
      seenKeys.add(String(folder.key));
      const depth = row.depth || 1;
      const prefix = depth > 1 ? '\u21b3 '.repeat(depth) : '\u21b3 ';
      const plainName = String(folder.name || 'Folder');
      options.push({
        key: String(folder.key),
        label: prefix + plainName,
        groupKey: String(group.key),
        groupName,
        depth,
        isTrade: !!folder.isTradeFolder,
        searchText: `${groupName} ${plainName} ${folder.tradeSlug || ''} ${folder.jobType || ''}`.toLowerCase(),
        selected: selected === String(folder.key),
      });
    }
  }

  return options;
}

function findPickerNodeLabel(nodes, selectedKey) {
  for (const node of nodes || []) {
    if (String(node.key) === String(selectedKey)) return node.name;
    const nested = findPickerNodeLabel(node.children, selectedKey);
    if (nested) return nested;
  }
  return null;
}

function buildPickerNodeFromFolder(folder, nestedChildren, groupName, selected, seenKeys, seenTradeSlugs) {
  if (!folder || !folder.key) return null;
  const key = String(folder.key);
  if (seenKeys.has(key)) return null;
  seenKeys.add(key);

  const name = String(folder.name || 'Folder');
  const childNodes = [];
  const childSeenKeys = new Set();
  for (const child of nestedChildren || []) {
    const slug = String(child.tradeSlug || '').trim();
    if (slug && seenTradeSlugs.has(slug)) continue;
    const nextSlugs = new Set(seenTradeSlugs);
    if (slug) nextSlugs.add(slug);
    const built = buildPickerNodeFromFolder(
      child,
      child.children || [],
      groupName,
      selected,
      childSeenKeys,
      nextSlugs
    );
    if (built) childNodes.push(built);
  }

  return {
    key,
    name,
    searchText: `${groupName} ${name} ${folder.tradeSlug || ''} ${folder.jobType || ''}`.toLowerCase(),
    selected: String(selected) === key,
    isSystem: !!folder.isPipelineDefault,
    isTrade: !!folder.isTradeFolder,
    hasChildren: childNodes.length > 0,
    children: childNodes,
  };
}

/**
 * Nested tree for collapsible folder pickers (system → subfolder → …).
 * @param {ReturnType<typeof buildFolderTree>} folderTree
 * @param {string} [selectedKey]
 */
function buildFolderPickerTree(folderTree, selectedKey) {
  const selected = String(selectedKey || '').trim();
  const roots = [
    {
      key: '',
      name: 'Main pipeline (unfiled)',
      searchText: 'main pipeline unfiled',
      selected: !selected,
      isSystem: false,
      isTrade: false,
      hasChildren: false,
      children: [],
    },
  ];

  for (const group of folderTree?.groups || []) {
    if (group.folder && group.isSystem) {
      const node = buildPickerNodeFromFolder(
        group.folder,
        group.children || [],
        String(group.name || ''),
        selected,
        new Set(),
        new Set()
      );
      if (node) roots.push(node);
      continue;
    }
    if (!group.isSystem && group.key === OTHER_GROUP_KEY) {
      for (const orphan of group.children || []) {
        const node = buildPickerNodeFromFolder(
          orphan,
          orphan.children || [],
          String(group.name || 'Other folders'),
          selected,
          new Set(),
          new Set()
        );
        if (node) roots.push(node);
      }
    }
  }

  return {
    roots,
    selectedKey: selected,
    selectedLabel: findPickerNodeLabel(roots, selected) || 'Main pipeline (unfiled)',
  };
}

/**
 * Folder key plus all nested subfolder keys (for pipeline folder filter).
 * @param {ReturnType<typeof buildFolderTree>} folderTree
 * @param {string} folderKey
 * @returns {Set<string>|null} null when folderKey empty
 */
function folderKeysIncludingDescendants(folderTree, folderKey) {
  const root = String(folderKey || '').trim();
  if (!root) return null;

  const keys = new Set([root]);

  function collectNested(folder) {
    if (!folder || !folder.key) return;
    keys.add(String(folder.key));
    for (const child of folder.children || []) {
      collectNested(child);
    }
  }

  function findInNodes(nodes) {
    for (const folder of nodes || []) {
      if (!folder || !folder.key) continue;
      if (String(folder.key) === root) {
        collectNested(folder);
        return true;
      }
      if (findInNodes(folder.children)) return true;
    }
    return false;
  }

  for (const group of folderTree?.groups || []) {
    if (group.folder && String(group.folder.key) === root) {
      for (const child of group.children || []) {
        collectNested(child);
      }
      return keys;
    }
    if (findInNodes(group.children)) return keys;
  }

  return keys;
}

/**
 * @param {object[]} folders
 * @returns {{ groups: object[], rootsByJobType: Record<string,object>, allFolders: object[] }}
 */
function buildFolderTree(folders) {
  const all = dedupeFoldersByKey(Array.isArray(folders) ? folders.filter(Boolean) : []);
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

  const groups = rootsOrdered.map((root) => {
    const nestedChildren = attachNestedChildren(root.key, childrenByParent);
    return {
      key: root.key,
      name: root.name,
      folder: root,
      isSystem: true,
      jobType: root.jobType || '',
      children: nestedChildren,
      childRows: flattenFolderRows(nestedChildren),
    };
  });

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
      children: orphans.map((f) => ({ ...f, children: [] })),
      childRows: orphans.map((f) => ({ folder: f, depth: 1 })),
    });
  }

  return { groups, rootsByJobType, allFolders: all };
}

function countLeadsInFolder(folderKey, countsByKey) {
  return (countsByKey && countsByKey[folderKey]) || 0;
}

function groupLeadTotal(children, countsByKey, rootKey) {
  let total = countLeadsInFolder(rootKey, countsByKey);
  total += sumNestedLeadCounts(children, countsByKey);
  return total;
}

/**
 * Lead counts per folder key, including all nested subfolders.
 * @param {ReturnType<typeof buildFolderTree>} folderTree
 * @param {Record<string, number>} countsByKey — direct leads per folder key
 */
function buildFolderAggregateCounts(folderTree, countsByKey) {
  const out = {};
  function record(folder, children) {
    if (!folder || !folder.key) return;
    const key = String(folder.key);
    out[key] = groupLeadTotal(children || [], countsByKey, key);
    for (const child of children || []) {
      record(child, child.children || []);
    }
  }
  for (const group of folderTree?.groups || []) {
    if (group.folder) {
      record(group.folder, group.children || []);
      continue;
    }
    for (const child of group.children || []) {
      record(child, child.children || []);
    }
  }
  return out;
}

/** @param {Record<string, Set<string>>} tagsByKey */
function tagSetForFolder(folderKey, tagsByKey) {
  const set = tagsByKey[folderKey];
  return set ? new Set(set) : new Set();
}

/** @param {Array<{ key: string, children?: unknown[] }>} children @param {Record<string, Set<string>>} tagsByKey */
function sumNestedTagKeys(children, tagsByKey) {
  const out = new Set();
  for (const child of children || []) {
    if (!child || !child.key) continue;
    const ck = String(child.key);
    for (const tk of tagSetForFolder(ck, tagsByKey)) out.add(tk);
    for (const tk of sumNestedTagKeys(child.children || [], tagsByKey)) out.add(tk);
  }
  return out;
}

/** @param {Record<string, Set<string>>} tagsByKey */
function groupFolderTagKeys(folderKey, children, tagsByKey) {
  const out = tagSetForFolder(folderKey, tagsByKey);
  for (const tk of sumNestedTagKeys(children || [], tagsByKey)) out.add(tk);
  return out;
}

/**
 * Active workspace tags used by leads in each folder (includes nested subfolders).
 * @param {ReturnType<typeof buildFolderTree>} folderTree
 * @param {Record<string, Set<string>>} tagsByKey — direct tag keys per folder key
 * @param {Record<string, { key: string, name: string, color?: string }>} tagCatalogByKey
 */
function buildFolderAggregateTags(folderTree, tagsByKey, tagCatalogByKey) {
  const out = {};
  function record(folder, children) {
    if (!folder || !folder.key) return;
    const key = String(folder.key);
    const keySet = groupFolderTagKeys(key, children || [], tagsByKey);
    out[key] = [...keySet]
      .map((tk) => tagCatalogByKey[tk])
      .filter(Boolean)
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' }));
    for (const child of children || []) {
      record(child, child.children || []);
    }
  }
  for (const group of folderTree?.groups || []) {
    if (group.folder) {
      record(group.folder, group.children || []);
      continue;
    }
    for (const child of group.children || []) {
      record(child, child.children || []);
    }
  }
  return out;
}

module.exports = {
  SYSTEM_JOB_ORDER,
  OTHER_GROUP_KEY,
  folderSearchText,
  buildFolderTree,
  buildFolderPickerOptions,
  buildFolderPickerTree,
  folderKeysIncludingDescendants,
  dedupeFoldersByKey,
  countLeadsInFolder,
  groupLeadTotal,
  flattenFolderRows,
  sumNestedLeadCounts,
  buildFolderAggregateCounts,
  buildFolderAggregateTags,
  groupFolderTagKeys,
};
