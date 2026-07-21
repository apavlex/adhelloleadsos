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

async function countLeadsInFolder(workspaceId, folderKey, reqLike) {
  const all = await dbService.getAllLeads(workspaceId);
  const visible = reqLike ? filterLeadsForRequest(reqLike, all) : all;
  return visible.filter((l) => String(l.folderKey || '').trim() === String(folderKey || '').trim())
    .length;
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

function mapFolderSummary(folder, leadCount) {
  return {
    key: folder.key,
    name: folder.name,
    jobType: folder.jobType || '',
    parentFolderKey: folder.parentFolderKey || '',
    isPipelineDefault: !!folder.isPipelineDefault,
    isTradeFolder: !!folder.isTradeFolder,
    leadCount,
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
  const folders = await dbService.listFolders(workspaceId);
  const summaries = [];
  for (const folder of folders) {
    if (!folder || !folder.key) continue;
    const leadCount = await countLeadsInFolder(workspaceId, folder.key, reqLike);
    summaries.push(mapFolderSummary(folder, leadCount));
  }
  summaries.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  return { folders: summaries, total: summaries.length };
}

async function getFolder(ctx, ref) {
  const { workspaceId, userEmail } = ctx;
  const folder = await resolveFolderRef(workspaceId, ref);
  const reqLike = buildReqLike(workspaceId, userEmail);
  const leadCount = await countLeadsInFolder(workspaceId, folder.key, reqLike);
  return { folder: mapFolderSummary(folder, leadCount) };
}

async function countLeads(ctx, ref) {
  const { workspaceId, userEmail } = ctx;
  const folder = await resolveFolderRef(workspaceId, ref);
  const reqLike = buildReqLike(workspaceId, userEmail);
  const count = await countLeadsInFolder(workspaceId, folder.key, reqLike);
  return {
    folder: { key: folder.key, name: folder.name, folder_id: folder.key },
    count,
  };
}

async function listLeads(ctx, ref) {
  const { workspaceId, userEmail } = ctx;
  const folder = await resolveFolderRef(workspaceId, ref);
  const reqLike = buildReqLike(workspaceId, userEmail);
  const lim = clampLimit(ref.limit);
  const off = clampOffset(ref.offset);

  const all = await dbService.getAllLeads(workspaceId);
  const visible = filterLeadsForRequest(reqLike, all);
  const filtered = applyLeadListFilters(visible, { folderKey: folder.key });
  filtered.sort((a, b) =>
    String(a.title || '').localeCompare(String(b.title || ''), undefined, { sensitivity: 'base' }),
  );

  const page = filtered.slice(off, off + lim).map(mapLeadListJson);
  return {
    folder: { key: folder.key, name: folder.name },
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
  listFolders,
  getFolder,
  countLeads,
  listLeads,
  getLead,
  updateLead,
  bulkUpdateLeads,
  searchLeads,
};
