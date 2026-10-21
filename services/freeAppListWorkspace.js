/**
 * When a reviews-app (app_free) member uploads a customer list, create (or
 * reuse) an Agency OS workspace owned by the agency network owner so ops can
 * manage that list from the CRM — not only inside the member PWA.
 *
 * Member field: managedWorkspaceId
 * Workspace flags: fromReviewsAppList, reviewsAppMemberId, reviewsAppNetworkId,
 *                  reviewsAppListFolderKey
 */
const { randomUUID } = require('crypto');
const dbService = require('./database');
const store = require('./networkStore');
const freeAppSignup = require('./freeAppSignup');
const workspaceBootstrap = require('./workspaceBootstrap');
const workspaceScriptBootstrap = require('./workspaceScriptBootstrap');
const pipelineStagesService = require('./pipelineStagesService');
const { PRESETS } = require('../lib/pipeline/presets');
const { normalizeStages } = require('../lib/pipeline/normalize');
const { upsertOpenTaskForLead, TASK_SOURCE_NETWORK } = require('./userTasks');
const withWorkspace = require('../middleware/withWorkspace');

const LIST_FOLDER_NAME = 'Uploaded customer list';
const SOURCE = 'reviews_app_list_upload';

function slugify(name) {
  const s = String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return s || 'reviews-list';
}

async function allocateSlug(name) {
  const base = slugify(name);
  for (let i = 0; i < 50; i += 1) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`;
    // eslint-disable-next-line no-await-in-loop
    if (!(await dbService.getWorkspaceIdForSlug(candidate))) return candidate;
  }
  return `${base}-${randomUUID().slice(0, 8)}`;
}

async function resolveAgencyOwnerEmail(network) {
  let owner = workspaceBootstrap.normEmail(network && network.ownerEmail);
  if (owner) return owner;
  const wid = network && network.ownerWorkspaceId;
  if (!wid) return '';
  const ws = await dbService.getWorkspace(wid);
  if (!ws) return '';
  owner = workspaceBootstrap.normEmail(ws.ownerUserId);
  if (owner) return owner;
  const members = ws.members && typeof ws.members === 'object' ? ws.members : {};
  const row = Object.entries(members).find(([, m]) => m && m.role === 'owner');
  return row ? workspaceBootstrap.normEmail(row[0]) : '';
}

async function ensureListFolder(ws) {
  const existingKey = String(ws.reviewsAppListFolderKey || '').trim();
  if (existingKey) {
    const folder = await dbService.getFolder(ws.id, existingKey);
    if (folder) return existingKey;
  }
  const folders = await dbService.listFolders(ws.id);
  const match = (folders || []).find(
    (f) => String(f.name || '').trim().toLowerCase() === LIST_FOLDER_NAME.toLowerCase(),
  );
  if (match && match.key) {
    await dbService.saveWorkspace(ws.id, { ...ws, reviewsAppListFolderKey: match.key });
    return match.key;
  }
  const created = await dbService.createFolder(ws.id, LIST_FOLDER_NAME);
  await dbService.saveWorkspace(ws.id, { ...ws, reviewsAppListFolderKey: created.key });
  return created.key;
}

async function createManagedWorkspace({ network, member, ownerEmail }) {
  const company = String(member.companyName || 'Reviews app business').trim() || 'Reviews app business';
  const newId = randomUUID();
  const slug = await allocateSlug(company);
  const now = new Date().toISOString();
  const em = workspaceBootstrap.normEmail(ownerEmail);

  const doc = {
    id: newId,
    ownerUserId: em,
    name: company,
    slug,
    accentColor: '#CA8A04',
    coachPrompt:
      'You coach a local service business that signed up via the AdHello reviews app. Focus on activating their uploaded customer list for review asks and follow-up.',
    icp: { keyword: '', city: '', state: '', qty: 20 },
    settings: {},
    pipelineIntake: { setupPath: 'preset', presetKey: 'local_service' },
    salesIntake: {
      businessName: company,
      contactName: member.contactName || '',
      contactPhone: member.phone || '',
      contactEmail: member.email || '',
    },
    members: {
      [em]: { role: 'owner', joinedAt: now, userId: em },
    },
    roundRobinIndex: 0,
    createdAt: now,
    archivedAt: null,
    fromReviewsAppList: true,
    reviewsAppMemberId: member.id,
    reviewsAppNetworkId: network.id,
    reviewsAppMemberLeadKey: member.leadKey || '',
  };
  workspaceScriptBootstrap.seedWorkspaceScriptsOnCreate(doc, { presetKey: 'local_service' });
  workspaceScriptBootstrap.applySalesIntakeToFirstOffer(doc, doc.salesIntake);

  await dbService.saveWorkspace(newId, doc);
  await dbService.saveWorkspaceSlug(slug, newId);
  await dbService.addUserWorkspaceId(em, newId);
  await pipelineStagesService.deleteAllStages(newId);
  await pipelineStagesService.persistNormalizedStages(
    newId,
    normalizeStages(PRESETS.local_service.stages),
  );

  try {
    withWorkspace.clearSwitcherCache(em);
  } catch (_) {
    /* switcher cache is best-effort */
  }

  return dbService.getWorkspace(newId);
}

function customerToLead(row, { workspaceId, folderKey, member }) {
  const name = String((row && row.name) || '').trim() || 'Customer';
  const phone = String((row && row.phone) || '').trim() || 'N/A';
  const email = String((row && row.email) || '').trim() || 'N/A';
  const address = String((row && row.address) || '').trim();
  const notes = String((row && row.notes) || '').trim();
  return {
    workspaceId,
    title: name,
    contactName: name,
    phone,
    email,
    address: address || undefined,
    message: notes || undefined,
    source: SOURCE,
    folderKey,
    forceFolderKey: true,
    importFields: {
      fromReviewsApp: true,
      memberId: member.id,
      companyName: member.companyName || '',
    },
  };
}

async function importRowsAsLeads(rows, ctx) {
  let created = 0;
  let merged = 0;
  let failed = 0;
  for (const row of rows || []) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const result = await dbService.saveLeadWithMeta(customerToLead(row, ctx));
      if (result.merged) merged += 1;
      else created += 1;
    } catch (err) {
      failed += 1;
      console.warn('[free-app-list-ws] lead import failed:', err && err.message ? err.message : err);
    }
  }
  return { created, merged, failed, total: (rows || []).length };
}

async function notifyAgencyWorkspaceCreated({ network, member, workspace, imported }) {
  const owner = await resolveAgencyOwnerEmail(network);
  const agencyWid = network.ownerWorkspaceId;
  if (!owner || !agencyWid) return null;
  const count = imported && (imported.created + imported.merged);
  const countLabel = Number.isFinite(count) && count > 0 ? ` · ${count} contacts` : '';
  try {
    return await upsertOpenTaskForLead(agencyWid, owner, {
      title: `Reviews list workspace: ${member.companyName}${countLabel}`.slice(0, 240),
      leadKey: member.leadKey || null,
      scheduledAt: new Date().toISOString(),
      source: TASK_SOURCE_NETWORK,
      href: `/workspaces/open?workspaceId=${encodeURIComponent(workspace.id)}&next=${encodeURIComponent('/today')}`,
    });
  } catch (err) {
    console.warn('[free-app-list-ws] operator task failed:', err.message);
    return null;
  }
}

/**
 * After a free-app member uploads a customer list: ensure a managed Agency OS
 * workspace exists and upsert the uploaded rows as leads in “Uploaded customer list”.
 *
 * @returns {Promise<{
 *   skipped?: boolean,
 *   reason?: string,
 *   created?: boolean,
 *   workspaceId?: string,
 *   workspace?: object,
 *   member?: object,
 *   imported?: { created: number, merged: number, failed: number, total: number },
 * }>}
 */
async function syncListUpload({ network, member, rows }) {
  if (!network || !member || !member.id) {
    return { skipped: true, reason: 'missing_context' };
  }
  if (!freeAppSignup.isAppFreeMember(member)) {
    return { skipped: true, reason: 'not_free_app' };
  }
  const list = Array.isArray(rows) ? rows.filter((r) => r && (r.name || r.phone || r.email)) : [];
  if (!list.length) {
    return { skipped: true, reason: 'empty' };
  }

  const ownerEmail = await resolveAgencyOwnerEmail(network);
  if (!ownerEmail) {
    return { skipped: true, reason: 'no_agency_owner' };
  }

  let created = false;
  let workspaceId = String(member.managedWorkspaceId || '').trim();
  let ws = workspaceId ? await dbService.getWorkspace(workspaceId) : null;
  if (!ws || ws.archivedAt) {
    ws = await createManagedWorkspace({ network, member, ownerEmail });
    workspaceId = ws.id;
    created = true;
    member = await store.saveMember(network.id, {
      ...member,
      managedWorkspaceId: workspaceId,
    });
  }

  const folderKey = await ensureListFolder(ws);
  ws = (await dbService.getWorkspace(workspaceId)) || ws;

  const imported = await importRowsAsLeads(list, { workspaceId, folderKey, member });

  if (created) {
    setImmediate(() => {
      notifyAgencyWorkspaceCreated({ network, member, workspace: ws, imported }).catch(() => {});
    });
  }

  return {
    created,
    workspaceId,
    workspace: ws,
    member,
    imported,
  };
}

module.exports = {
  LIST_FOLDER_NAME,
  SOURCE,
  slugify,
  allocateSlug,
  resolveAgencyOwnerEmail,
  syncListUpload,
  customerToLead,
};
