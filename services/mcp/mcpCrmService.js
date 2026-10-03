/**
 * CRM operations exposed to the CEO Command Center MCP server.
 */
const dbService = require('../database');
const { filterLeadsForRequest } = require('../workspaceService');
const {
  applyLeadListFilters,
  buildLeadSearchContext,
  leadMatchesSearchQuery,
  scoreLeadSearchMatch,
  mapLeadListJson,
} = require('../leadListFilters');
const { buildFolderTree, folderKeysIncludingDescendants } = require('../folderTree');
const { normalizeLeadKey: normalizeActivityKey } = require('../teamActivity');
const leadPeople = require('./mcpLeadPeople');

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

/** Fields MCP clients may update via update_lead / bulk_update_leads. */
const MCP_UPDATABLE_LEAD_FIELDS = new Set([
  'title',
  'phone',
  'email',
  'website',
  'address',
  'city',
  'state',
  'zip',
  'postalCode',
  'categoryName',
  'note',
  'notes',
  'status',
  'pipelineStage',
  'stageId',
  'opportunityPipelineId',
  'opportunityStageId',
  'opportunityDismissed',
  'opportunityValue',
  'opportunitySource',
  'folderKey',
  'tags',
  'url',
  'facebook',
  'instagram',
  'twitter',
  'auditSummary',
  'gbpClaimStatus',
  'gbpOptimizationScore',
  'aiWebsiteAnalysisScore',
  'ownerSignal',
  'loomUrl',
  'outreachPrompt',
  'nextActionAt',
  'lastTouchChannel',
  'lastDisposition',
  'assignedTo',
  'jobType',
  'sourceType',
]);

function clampLimit(limit) {
  const n = parseInt(limit, 10);
  if (Number.isNaN(n) || n < 1) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

function clampOffset(offset) {
  const n = parseInt(offset, 10);
  if (Number.isNaN(n) || n < 0) return 0;
  return n;
}

function normalizeFolderName(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

async function resolveFolderRef(workspaceId, ref = {}) {
  const folderId = String(ref.folder_id || ref.folder_key || '').trim();
  const folderName = String(ref.folder_name || '').trim();
  if (!folderId && !folderName) {
    const err = new Error('folder_id or folder_name is required.');
    err.code = 'INVALID_ARGUMENT';
    throw err;
  }

  const folders = await dbService.listFolders(workspaceId);

  if (folderId) {
    const exact =
      folders.find((f) => f && String(f.key || '').trim() === folderId) ||
      folders.find((f) => f && String(f.key || '').toLowerCase() === folderId.toLowerCase());
    if (exact) return exact;
  }

  if (folderName) {
    return resolveFolder(workspaceId, folderName);
  }

  const err = new Error(`Folder not found: ${folderId || folderName}`);
  err.code = 'NOT_FOUND';
  throw err;
}

async function resolveFolder(workspaceId, folderName) {
  const raw = String(folderName || '').trim();
  if (!raw) {
    const err = new Error('folder_name is required.');
    err.code = 'INVALID_ARGUMENT';
    throw err;
  }
  const folders = await dbService.listFolders(workspaceId);
  const norm = normalizeFolderName(raw);
  let folder =
    folders.find((f) => f && String(f.key || '').trim() === raw) ||
    folders.find((f) => f && normalizeFolderName(f.name) === norm) ||
    folders.find((f) => f && normalizeFolderName(f.name).includes(norm)) ||
    folders.find((f) => f && String(f.key || '').toLowerCase().includes(norm));
  if (!folder) {
    const err = new Error(`Folder not found: ${raw}`);
    err.code = 'NOT_FOUND';
    throw err;
  }
  return folder;
}

function wantsSubfolders(ref) {
  const v = ref && ref.include_subfolders;
  return !(v === false || v === 'false' || v === 0 || v === '0');
}

/**
 * Parent links as the Folder manager shows them: system folders (e.g. Businesses) adopt trade
 * folders by job type, so the tree is the source of truth; explicit parentFolderKey fills the rest.
 */
function folderHierarchy(folders) {
  const list = (folders || []).filter((f) => f && f.key);
  const parentOf = new Map();
  const walk = (parentKey, nodes) => {
    for (const node of nodes || []) {
      if (!node || !node.key) continue;
      if (parentKey) parentOf.set(String(node.key), String(parentKey));
      walk(node.key, node.children);
    }
  };
  for (const group of buildFolderTree(list).groups || []) {
    walk(group.folder ? group.folder.key : '', group.children);
  }
  const keys = new Set(list.map((f) => String(f.key)));
  for (const f of list) {
    const pk = String(f.parentFolderKey || '').trim();
    if (pk && keys.has(pk) && !parentOf.has(String(f.key))) parentOf.set(String(f.key), pk);
  }
  const childrenOf = new Map();
  for (const [child, parent] of parentOf) {
    if (!childrenOf.has(parent)) childrenOf.set(parent, []);
    childrenOf.get(parent).push(child);
  }
  const descendants = (rootKey) => {
    const root = String(rootKey || '').trim();
    const out = new Set([root]);
    const stack = [root];
    while (stack.length) {
      for (const child of childrenOf.get(stack.pop()) || []) {
        if (out.has(child)) continue;
        out.add(child);
        stack.push(child);
      }
    }
    return out;
  };
  return { parentOf, childrenOf, descendants };
}

/** The folder plus every nested subfolder, the same set the Folder manager counts and "Open leads" shows. */
function folderKeySet(folders, folderKey, includeSubfolders = true) {
  const root = String(folderKey || '').trim();
  if (!includeSubfolders) return new Set([root]);
  const keys = folderHierarchy(folders).descendants(root);
  for (const k of folderKeysIncludingDescendants(buildFolderTree(folders), root) || []) keys.add(String(k));
  return keys;
}

function countByFolderKey(leads) {
  const counts = new Map();
  for (const l of leads) {
    const fk = String(l.folderKey || '').trim();
    if (fk) counts.set(fk, (counts.get(fk) || 0) + 1);
  }
  return counts;
}

async function folderCounts(workspaceId, folder, reqLike, folders) {
  const all = await dbService.getAllLeads(workspaceId);
  const counts = countByFolderKey(reqLike ? filterLeadsForRequest(reqLike, all) : all);
  const keys = folderKeySet(folders, folder.key);
  let total = 0;
  for (const k of keys) total += counts.get(k) || 0;
  return { total, direct: counts.get(String(folder.key)) || 0, subfolders: keys.size - 1 };
}

function buildReqLike(workspaceId, userEmail) {
  return {
    workspaceId,
    workspace: { id: workspaceId },
    user: userEmail ? { emails: [{ value: userEmail }] } : undefined,
  };
}

function pickUpdatableFields(fields) {
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
    const err = new Error('fields must be a plain object.');
    err.code = 'INVALID_ARGUMENT';
    throw err;
  }
  const patch = {};
  for (const [key, value] of Object.entries(fields)) {
    if (!MCP_UPDATABLE_LEAD_FIELDS.has(key)) continue;
    patch[key] = value;
  }
  if (!Object.keys(patch).length) {
    const err = new Error('No allowed fields provided to update.');
    err.code = 'INVALID_ARGUMENT';
    throw err;
  }
  return patch;
}

async function resolveLeadKey(workspaceId, leadId) {
  const raw = String(leadId || '').trim();
  if (!raw) {
    const err = new Error('lead_id is required.');
    err.code = 'INVALID_ARGUMENT';
    throw err;
  }
  const resolved =
    (await dbService.resolveLeadStorageKey(raw, workspaceId)) ||
    (raw.startsWith('lead:') ? raw : `lead:${raw}`);
  const lead = await dbService.getLead(resolved);
  if (!lead) {
    const err = new Error(`Lead not found: ${raw}`);
    err.code = 'NOT_FOUND';
    throw err;
  }
  if (!(await dbService.leadBelongsToWorkspace(lead, workspaceId))) {
    const err = new Error('Lead not found in this workspace.');
    err.code = 'NOT_FOUND';
    throw err;
  }
  return { fullKey: lead.key || resolved, lead };
}

function folderPath(folder, byKey, parentOf) {
  const names = [];
  const seen = new Set();
  let cur = folder;
  while (cur && !seen.has(cur.key)) {
    seen.add(cur.key);
    names.unshift(cur.name || cur.key);
    const pk = parentOf.get(String(cur.key));
    cur = pk ? byKey.get(pk) : null;
  }
  return names.join(' / ');
}

/** leadCount includes nested subfolders (matches the Folder manager); directLeadCount is this folder only. */
function mapFolderSummary(folder, leadCount, extra = {}) {
  return {
    key: folder.key,
    name: folder.name,
    ...(extra.path ? { path: extra.path } : {}),
    jobType: folder.jobType || '',
    parentFolderKey: extra.parentKey != null ? extra.parentKey : folder.parentFolderKey || '',
    isPipelineDefault: !!folder.isPipelineDefault,
    isTradeFolder: !!folder.isTradeFolder,
    leadCount,
    ...(extra.directLeadCount != null ? { directLeadCount: extra.directLeadCount } : {}),
    ...(extra.subfolderCount != null ? { subfolderCount: extra.subfolderCount } : {}),
    createdAt: folder.createdAt || null,
    updatedAt: folder.updatedAt || null,
  };
}

function mapLeadDetail(lead) {
  const copy = { ...lead };
  delete copy.updates;
  delete copy.chatHistory;
  return copy;
}

async function listFolders(ctx) {
  const { workspaceId, userEmail } = ctx;
  const reqLike = buildReqLike(workspaceId, userEmail);
  const folders = (await dbService.listFolders(workspaceId)).filter((f) => f && f.key);
  const all = await dbService.getAllLeads(workspaceId);
  const counts = countByFolderKey(filterLeadsForRequest(reqLike, all));
  const { parentOf, descendants } = folderHierarchy(folders);
  const byKey = new Map(folders.map((f) => [String(f.key), f]));
  const summaries = folders.map((folder) => {
    const keys = descendants(folder.key);
    let total = 0;
    for (const k of keys) total += counts.get(k) || 0;
    return mapFolderSummary(folder, total, {
      path: folderPath(folder, byKey, parentOf),
      parentKey: parentOf.get(String(folder.key)) || '',
      directLeadCount: counts.get(String(folder.key)) || 0,
      subfolderCount: keys.size - 1,
    });
  });
  summaries.sort((a, b) => String(a.path || a.name || '').localeCompare(String(b.path || b.name || '')));
  return { folders: summaries, total: summaries.length };
}

async function getFolder(ctx, ref) {
  const { workspaceId, userEmail } = ctx;
  const folder = await resolveFolderRef(workspaceId, ref);
  const folders = await dbService.listFolders(workspaceId);
  const c = await folderCounts(workspaceId, folder, buildReqLike(workspaceId, userEmail), folders);
  const byKey = new Map(folders.filter(Boolean).map((f) => [String(f.key), f]));
  const { parentOf, childrenOf } = folderHierarchy(folders);
  const subfolders = (childrenOf.get(String(folder.key)) || [])
    .map((k) => byKey.get(k))
    .filter(Boolean)
    .map((f) => ({ key: f.key, name: f.name }));
  return {
    folder: {
      ...mapFolderSummary(folder, c.total, {
        path: folderPath(folder, byKey, parentOf),
        parentKey: parentOf.get(String(folder.key)) || '',
        directLeadCount: c.direct,
        subfolderCount: c.subfolders,
      }),
      subfolders,
    },
  };
}

async function countLeads(ctx, ref = {}) {
  const { workspaceId, userEmail } = ctx;
  const folderId = String(ref.folder_id || ref.folder_key || '').trim();
  const folderName = String(ref.folder_name || '').trim();
  const reqLike = buildReqLike(workspaceId, userEmail);

  if (!folderId && !folderName) {
    const all = await dbService.getAllLeads(workspaceId);
    const visible = filterLeadsForRequest(reqLike, all);
    return {
      scope: 'workspace',
      count: visible.length,
    };
  }

  const folder = await resolveFolderRef(workspaceId, ref);
  const c = await folderCounts(workspaceId, folder, reqLike, await dbService.listFolders(workspaceId));
  const withSubs = wantsSubfolders(ref);
  return {
    scope: 'folder',
    folder: { key: folder.key, name: folder.name, folder_id: folder.key },
    count: withSubs ? c.total : c.direct,
    direct_count: c.direct,
    includes_subfolders: withSubs && c.subfolders > 0,
    subfolder_count: c.subfolders,
  };
}

const LIST_SORTS = new Set(['name', 'rating', 'reviews', 'score', 'newest', 'recent']);
const PERSON_FILTERS = [
  ['worked_by', 'worked'],
  ['bookmarked_by', 'bookmarked'],
  ['tagged_by', 'tagged'],
];

function filterError(message, code = 'INVALID_ARGUMENT') {
  const err = new Error(message);
  err.code = code;
  return err;
}

function optionalNumber(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Tag names → tag keys (exact name, else a unique partial match). */
async function resolveTagKeys(workspaceId, names) {
  const tags = (await dbService.listTags(workspaceId)).filter((t) => t && t.isActive !== false);
  const keys = new Set();
  for (const raw of names) {
    const want = String(raw).trim().toLowerCase();
    let hit = tags.find((t) => t.key === raw || String(t.name || '').toLowerCase() === want);
    if (!hit) {
      const partial = tags.filter((t) => String(t.name || '').toLowerCase().includes(want));
      if (partial.length === 1) [hit] = partial;
    }
    if (!hit) {
      throw filterError(`No tag named "${raw}". Tags: ${tags.map((t) => t.name).filter(Boolean).join(', ') || 'none yet'}.`, 'NOT_FOUND');
    }
    keys.add(hit.key);
  }
  return { keys, nameByKey: new Map(tags.map((t) => [t.key, t.name || ''])) };
}

function truthyFlag(v) {
  return v === true || v === 'true' || v === 1 || v === '1';
}

function leadCreatedMs(lead) {
  const ts = Date.parse(lead.createdAt || lead.savedAt || '');
  if (Number.isFinite(ts)) return ts;
  const fromKey = parseInt(String(lead.key || '').replace(/^lead:/, ''), 10);
  return Number.isFinite(fromKey) ? fromKey : 0;
}

function byTitle(a, b) {
  return String(a.title || '').localeCompare(String(b.title || ''), undefined, { sensitivity: 'base' });
}

async function listLeads(ctx, ref = {}) {
  const { workspaceId, userEmail } = ctx;
  const bookmarkedOnly = truthyFlag(ref.bookmarked_only);
  const tagNames = [...(Array.isArray(ref.tags) ? ref.tags : []), ref.tag].map((t) => String(t || '').trim()).filter(Boolean);
  const status = String(ref.status || '').trim().toLowerCase();
  const minRating = optionalNumber(ref.min_rating);
  const minReviews = optionalNumber(ref.min_reviews);
  const maxReviews = optionalNumber(ref.max_reviews);
  const personRefs = PERSON_FILTERS.filter(([arg]) => String(ref[arg] || '').trim());
  const hasFilters =
    bookmarkedOnly || tagNames.length || status || minRating != null || minReviews != null || maxReviews != null || personRefs.length;
  const hasFolderRef = Boolean(
    String(ref.folder_id || ref.folder_key || '').trim() || String(ref.folder_name || '').trim(),
  );
  if (!hasFolderRef && !hasFilters) {
    throw filterError('Pass a folder (folder_id / folder_name) or at least one filter, e.g. bookmarked_by: "me", tag, worked_by.');
  }
  const folder = hasFolderRef ? await resolveFolderRef(workspaceId, ref) : null;
  const reqLike = buildReqLike(workspaceId, userEmail);
  const lim = clampLimit(ref.limit);
  const off = clampOffset(ref.offset);
  const sortRaw = String(ref.sort || '').trim().toLowerCase();
  const sort = LIST_SORTS.has(sortRaw) ? sortRaw : personRefs.length ? 'recent' : 'name';

  const all = await dbService.getAllLeads(workspaceId);
  const visible = filterLeadsForRequest(reqLike, all);
  const folderKeys = folder ? folderKeySet(await dbService.listFolders(workspaceId), folder.key, wantsSubfolders(ref)) : null;
  let filtered = folder ? applyLeadListFilters(visible, { folderKey: folder.key, folderKeys }) : visible;
  if (bookmarkedOnly) filtered = filtered.filter((l) => !!l.bookmarked);

  const tagInfo = await resolveTagKeys(workspaceId, tagNames);
  if (tagNames.length) filtered = filtered.filter((l) => (Array.isArray(l.tags) ? l.tags : []).some((k) => tagInfo.keys.has(k)));
  if (status) {
    filtered = filtered.filter(
      (l) => String(l.status || '').toLowerCase() === status || String(l.pipelineStage || '').toLowerCase() === status,
    );
  }
  const rating = (l) => Number(l.totalScore) || 0;
  const reviews = (l) => Number(l.reviewsCount) || 0;
  if (minRating != null) filtered = filtered.filter((l) => rating(l) >= minRating);
  if (minReviews != null) filtered = filtered.filter((l) => reviews(l) >= minReviews);
  if (maxReviews != null) filtered = filtered.filter((l) => reviews(l) <= maxReviews);

  const lastAction = new Map();
  const people = {};
  for (const [arg, kind] of personRefs) {
    // eslint-disable-next-line no-await-in-loop
    const person = await leadPeople.resolvePerson(ctx, ref[arg]);
    const index = leadPeople.personalLeadIndex(workspaceId, person.emails)[kind];
    people[arg] = person.label;
    filtered = filtered.filter((l) => {
      const hit = index.get(normalizeActivityKey(l.key));
      if (!hit) return false;
      if (kind === 'bookmarked' && !l.bookmarked) return false;
      if (kind === 'tagged' && !(Array.isArray(l.tags) && l.tags.length)) return false;
      const prev = lastAction.get(l.key);
      if (!prev || hit.at > prev.at) lastAction.set(l.key, { ...hit, by: person.label });
      return true;
    });
  }

  let scoreByKey = null;
  if (sort === 'score') {
    const { scoreLeadRecord } = require('../opportunityScore');
    const workspace = (await dbService.getWorkspace(workspaceId)) || { id: workspaceId };
    scoreByKey = new Map(
      filtered.map((l) => [l.key, Number(scoreLeadRecord(l, { workspace }).score) || 0]),
    );
  }
  const num = (v) => Number(v) || 0;
  filtered.sort((a, b) => {
    let d = 0;
    if (sort === 'rating') d = num(b.totalScore) - num(a.totalScore) || num(b.reviewsCount) - num(a.reviewsCount);
    else if (sort === 'reviews') d = num(b.reviewsCount) - num(a.reviewsCount) || num(b.totalScore) - num(a.totalScore);
    else if (sort === 'score') d = scoreByKey.get(b.key) - scoreByKey.get(a.key);
    else if (sort === 'newest') d = leadCreatedMs(b) - leadCreatedMs(a);
    else if (sort === 'recent') {
      const at = (l) => (lastAction.get(l.key) || {}).at || Date.parse(l.updatedAt || '') || leadCreatedMs(l);
      d = at(b) - at(a);
    }
    return d || byTitle(a, b);
  });

  const page = filtered.slice(off, off + lim).map((l) => {
    const row = { ...mapLeadListJson(l), bookmarked: !!l.bookmarked };
    row.tag_names = row.tags.map((k) => tagInfo.nameByKey.get(k)).filter(Boolean);
    if (scoreByKey) row.score = Math.round(scoreByKey.get(l.key) * 10) / 10;
    const act = lastAction.get(l.key);
    if (act) {
      row.last_action = { by: act.by, summary: act.summary, ...(act.at ? { at: new Date(act.at).toISOString() } : {}) };
    }
    return row;
  });
  const filters = {
    ...(tagNames.length ? { tags: tagNames } : {}),
    ...(status ? { status: ref.status } : {}),
    ...(minRating != null ? { min_rating: minRating } : {}),
    ...(minReviews != null ? { min_reviews: minReviews } : {}),
    ...(maxReviews != null ? { max_reviews: maxReviews } : {}),
    ...people,
  };
  return {
    folder: folder
      ? { key: folder.key, name: folder.name, includes_subfolders: folderKeys.size > 1, subfolder_count: folderKeys.size - 1 }
      : null,
    scope: folder ? 'folder' : 'workspace',
    sort,
    bookmarkedOnly,
    ...(Object.keys(filters).length ? { filters } : {}),
    leads: page,
    pagination: {
      limit: lim,
      offset: off,
      total: filtered.length,
      hasMore: off + lim < filtered.length,
    },
  };
}

async function getLead(ctx, { lead_id: leadId }) {
  const { workspaceId } = ctx;
  const { lead, fullKey } = await resolveLeadKey(workspaceId, leadId);
  return { lead: mapLeadDetail({ ...lead, key: fullKey }) };
}

async function updateLead(ctx, { lead_id: leadId, fields }) {
  const { workspaceId } = ctx;
  const { fullKey } = await resolveLeadKey(workspaceId, leadId);
  const patch = pickUpdatableFields(fields);
  const updated = await dbService.updateLead(fullKey, patch, workspaceId);
  return { lead: mapLeadDetail(updated) };
}

async function bulkUpdateLeads(ctx, { updates }) {
  if (!Array.isArray(updates) || !updates.length) {
    const err = new Error('updates must be a non-empty array.');
    err.code = 'INVALID_ARGUMENT';
    throw err;
  }
  if (updates.length > 50) {
    const err = new Error('Maximum 50 leads per bulk_update_leads call.');
    err.code = 'INVALID_ARGUMENT';
    throw err;
  }

  const results = [];
  for (const item of updates) {
    const leadId = item && (item.lead_id || item.leadId);
    try {
      const row = await updateLead(ctx, { lead_id: leadId, fields: item.fields || {} });
      results.push({ lead_id: leadId, success: true, lead: row.lead });
    } catch (e) {
      results.push({
        lead_id: leadId,
        success: false,
        error: e.message || 'Update failed',
        code: e.code || 'ERROR',
      });
    }
  }
  const ok = results.filter((r) => r.success).length;
  return {
    updated: ok,
    failed: results.length - ok,
    results,
  };
}

async function searchLeads(ctx, { query, limit, offset }) {
  const { workspaceId, userEmail } = ctx;
  const q = String(query || '').trim();
  if (q.length < 2) {
    const err = new Error('query must be at least 2 characters.');
    err.code = 'INVALID_ARGUMENT';
    throw err;
  }
  const lim = clampLimit(limit);
  const off = clampOffset(offset);
  const reqLike = buildReqLike(workspaceId, userEmail);

  const all = await dbService.getAllLeads(workspaceId);
  const visible = filterLeadsForRequest(reqLike, all);
  const [folders, tags] = await Promise.all([
    dbService.listFolders(workspaceId),
    dbService.listTags(workspaceId),
  ]);
  const searchContext = buildLeadSearchContext(tags, folders);
  const folderByKey = new Map(
    (folders || []).filter((f) => f && f.key).map((f) => [String(f.key), String(f.name || 'Folder')]),
  );

  const matched = visible.filter((l) => leadMatchesSearchQuery(l, q, searchContext));
  matched.sort((a, b) => {
    const sa = scoreLeadSearchMatch(a, q, searchContext);
    const sb = scoreLeadSearchMatch(b, q, searchContext);
    if (sa !== sb) return sa - sb;
    return String(a.title || '').localeCompare(String(b.title || ''), undefined, {
      sensitivity: 'base',
    });
  });

  const page = matched.slice(off, off + lim).map((l) => {
    const base = mapLeadListJson(l);
    const folderKey = String(l.folderKey || '').trim();
    return {
      ...base,
      folderName: folderKey ? folderByKey.get(folderKey) || '' : '',
    };
  });

  return {
    query: q,
    leads: page,
    pagination: {
      limit: lim,
      offset: off,
      total: matched.length,
      hasMore: off + lim < matched.length,
    },
  };
}

module.exports = {
  MCP_UPDATABLE_LEAD_FIELDS,
  LIST_SORTS,
  buildReqLike,
  resolveFolderRef,
  resolveLeadKey,
  mapFolderSummary,
  listFolders,
  getFolder,
  countLeads,
  listLeads,
  getLead,
  updateLead,
  bulkUpdateLeads,
  searchLeads,
};
