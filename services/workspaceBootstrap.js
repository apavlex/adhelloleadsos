/**
 * First-time and legacy migration: ensures each signed-in user has at least one workspace,
 * migrates `default` workspace + keys to UUID "Adhello Agency", sets slug index + user prefs.
 */
const { randomUUID } = require('crypto');
const dbService = require('./database');
const workspaceScriptBootstrap = require('./workspaceScriptBootstrap');
const { emailAliases } = require('./workspaceService');

const DEFAULT_COACH_AGENCY =
  'You are coaching a digital ad agency owner targeting small businesses. Focus on reply-bait and offer clarity.';

function normEmail(email) {
  return String(email || '')
    .trim()
    .toLowerCase();
}

async function collectWorkspaceIdsForEmail(email) {
  const aliases = emailAliases(email);
  const ids = [];
  for (const a of aliases) {
    const part = await dbService.getUserWorkspaceIds(a);
    for (const id of part) {
      if (id && !ids.includes(id)) ids.push(id);
    }
  }
  return ids;
}

/**
 * Link this login email onto every workspace found via brand-domain aliases
 * (so @adhello.io sees the same Agency OS as @adhello.ai).
 */
async function linkAliasWorkspaces(ownerEmail) {
  const em = normEmail(ownerEmail);
  if (!em) return [];
  const aliases = emailAliases(em);
  const ids = await collectWorkspaceIdsForEmail(em);
  if (!ids.length) return [];

  for (const id of ids) {
    await dbService.addUserWorkspaceId(em, id);
    const ws = await dbService.getWorkspace(id);
    if (!ws || typeof ws !== 'object') continue;
    const members = { ...(ws.members || {}) };
    let changed = false;
    // Copy membership from any alias already on the workspace
    let roleFromAlias = null;
    for (const a of aliases) {
      if (a === em) continue;
      if (members[a] && members[a].role) {
        roleFromAlias = members[a].role;
        break;
      }
      if (normEmail(ws.ownerUserId) === a) roleFromAlias = 'owner';
    }
    if (!members[em]) {
      members[em] = {
        role: roleFromAlias || 'owner',
        joinedAt: new Date().toISOString(),
        userId: em,
      };
      changed = true;
    }
    if (changed) {
      ws.members = members;
      await dbService.saveWorkspace(id, ws);
    }
  }

  const prefs = await dbService.getUserPrefs(em);
  let activeSet = false;
  for (const a of aliases) {
    if (a === em) continue;
    const ap = await dbService.getUserPrefs(a);
    if (ap && ap.activeWorkspaceId && ids.includes(String(ap.activeWorkspaceId))) {
      await dbService.saveUserPrefs(em, { activeWorkspaceId: String(ap.activeWorkspaceId) });
      activeSet = true;
      break;
    }
  }
  if (!activeSet && (!prefs || !prefs.activeWorkspaceId) && ids[0]) {
    await dbService.saveUserPrefs(em, { activeWorkspaceId: ids[0] });
  }

  await pruneEmptyDuplicateAgencyWorkspaces(em);
  return collectWorkspaceIdsForEmail(em);
}

function isAdhelloAgencyWorkspace(ws) {
  if (!ws || typeof ws !== 'object') return false;
  const name = String(ws.name || '')
    .trim()
    .toLowerCase();
  const slug = String(ws.slug || '')
    .trim()
    .toLowerCase();
  if (slug === 'adhello-agency' || slug.startsWith('adhello-agency')) return true;
  return name === 'adhello agency' || name === 'adhello.ai agency';
}

/**
 * Remove empty duplicate "Adhello Agency" shells created when logging in with @adhello.io
 * while the real Agency workspace (with leads) already existed under @adhello.ai.
 */
async function pruneEmptyDuplicateAgencyWorkspaces(ownerEmail) {
  const em = normEmail(ownerEmail);
  if (!em) return { kept: null, removed: [] };
  const aliases = emailAliases(em);
  const ids = await collectWorkspaceIdsForEmail(em);
  if (ids.length < 2) return { kept: null, removed: [] };

  const agency = [];
  for (const id of ids) {
    const ws = await dbService.getWorkspace(id);
    if (!ws || ws.archivedAt) continue;
    if (!isAdhelloAgencyWorkspace(ws)) continue;
    let leadCount = 0;
    try {
      const leads = await dbService.getAllLeads(id);
      leadCount = Array.isArray(leads) ? leads.length : 0;
    } catch (_) {
      leadCount = 0;
    }
    agency.push({
      id,
      leadCount,
      createdAt: Date.parse(ws.createdAt || '') || 0,
      ws,
    });
  }
  if (agency.length < 2) return { kept: null, removed: [] };

  agency.sort((a, b) => {
    if (b.leadCount !== a.leadCount) return b.leadCount - a.leadCount;
    return a.createdAt - b.createdAt;
  });
  const keep = agency[0];
  const drop = agency.slice(1).filter((x) => x.leadCount === 0);
  if (!drop.length) return { kept: keep.id, removed: [] };

  const removed = [];
  for (const d of drop) {
    for (const a of aliases) {
      await dbService.removeUserWorkspaceId(a, d.id);
    }
    const doc = d.ws;
    doc.archivedAt = new Date().toISOString();
    doc.archivedReason = 'empty_duplicate_adhello_agency';
    await dbService.saveWorkspace(d.id, doc);
    removed.push(d.id);
  }

  // Point canonical slug at the workspace that still has leads
  try {
    await dbService.saveWorkspaceSlug('adhello-agency', keep.id);
  } catch (_) {
    /* ignore */
  }

  for (const a of aliases) {
    const prefs = await dbService.getUserPrefs(a);
    if (prefs && removed.includes(String(prefs.activeWorkspaceId || ''))) {
      await dbService.saveUserPrefs(a, { activeWorkspaceId: keep.id });
    }
  }

  console.log(
    `[workspace] Pruned ${removed.length} empty duplicate Adhello Agency workspace(s); kept ${keep.id} (${keep.leadCount} leads)`,
  );
  return { kept: keep.id, removed };
}

function parseLegacyDailyTrackerKey(key) {
  const parts = String(key || '').split(':');
  if (parts[0] !== 'daily_tracker') return null;
  if (parts.length === 3) return { fragment: parts[1], date: parts[2] };
  return null;
}

async function migrateFoldersToWorkspace(newId) {
  const keys = await dbService.listStorageKeysWithPrefix('folder:default:');
  for (const oldKey of keys) {
    const raw = await dbService.peekStorageKey(oldKey);
    if (raw == null) continue;
    let obj;
    try {
      obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
      continue;
    }
    obj.workspaceId = newId;
    const newKey = oldKey.replace(/^folder:default:/, `folder:${newId}:`);
    await dbService.putStorageKey(newKey, JSON.stringify(obj));
    await dbService.deleteStorageKey(oldKey);
  }
}

async function migrateSchedulesToWorkspace(newId) {
  const keys = await dbService.listStorageKeysWithPrefix('schedule:');
  for (const key of keys) {
    const raw = await dbService.peekStorageKey(key);
    if (raw == null) continue;
    let obj;
    try {
      obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
      continue;
    }
    const w = obj.workspaceId || 'default';
    if (w === 'default' || !obj.workspaceId) {
      obj.workspaceId = newId;
      await dbService.putStorageKey(key, JSON.stringify(obj));
    }
  }
}

async function migrateMorningBriefsToWorkspace(newId) {
  const keys = await dbService.listStorageKeysWithPrefix('morningBrief:default:');
  for (const oldKey of keys) {
    const raw = await dbService.peekStorageKey(oldKey);
    if (raw == null) continue;
    const suffix = oldKey.replace(/^morningBrief:default:/, '');
    const newKey = `morningBrief:${newId}:${suffix}`;
    await dbService.putStorageKey(newKey, raw);
    await dbService.deleteStorageKey(oldKey);
  }
}

async function migrateProspectingCoachCacheToWorkspace(newId) {
  const oldKey = 'pc_coach:default';
  const raw = await dbService.peekStorageKey(oldKey);
  if (raw == null) return;
  await dbService.putStorageKey(`pc_coach:${newId}`, raw);
  await dbService.deleteStorageKey(oldKey);
}

async function migrateDailyTrackersToWorkspace(newId) {
  const keys = await dbService.listStorageKeysWithPrefix('daily_tracker:');
  for (const oldKey of keys) {
    const parsed = parseLegacyDailyTrackerKey(oldKey);
    if (!parsed) continue;
    const raw = await dbService.peekStorageKey(oldKey);
    if (raw == null) continue;
    const newKey = `daily_tracker:${newId}:${parsed.fragment}:${parsed.date}`;
    await dbService.putStorageKey(newKey, raw);
    await dbService.deleteStorageKey(oldKey);
  }
}

async function migrateUserScopedPrefix(oldWid, newId, middlePrefix) {
  const from = `${middlePrefix}:${oldWid}:`;
  const keys = await dbService.listStorageKeysWithPrefix(from);
  for (const oldKey of keys) {
    const raw = await dbService.peekStorageKey(oldKey);
    if (raw == null) continue;
    const rest = oldKey.slice(from.length);
    const newKey = `${middlePrefix}:${newId}:${rest}`;
    await dbService.putStorageKey(newKey, raw);
    await dbService.deleteStorageKey(oldKey);
  }
}

async function migrateLeadsWorkspaceTo(newId) {
  const keys = await dbService.listStorageKeysWithPrefix('lead:');
  for (const key of keys) {
    const lead = await dbService.getLead(key);
    if (!lead) continue;
    const w = lead.workspaceId || 'default';
    if (w === 'default' || !lead.workspaceId) {
      await dbService.updateLead(key, { workspaceId: newId });
    }
  }
}

/**
 * @param {string} ownerEmail
 */
async function runLegacyMigrationToNewWorkspace(ownerEmail) {
  const em = normEmail(ownerEmail);
  const newId = randomUUID();
  const legacyWs = await dbService.getWorkspace('default');

  const doc = {
    id: newId,
    ownerUserId: em,
    name: 'Adhello Agency',
    slug: 'adhello-agency',
    accentColor: (legacyWs && legacyWs.accentColor) || '#CA8A04',
    coachPrompt: (legacyWs && legacyWs.coachPrompt) || DEFAULT_COACH_AGENCY,
    icp: (legacyWs && legacyWs.icp) || { keyword: '', city: '', state: '', qty: 20 },
    settings: (legacyWs && legacyWs.settings) || {},
    members: {},
    roundRobinIndex: (legacyWs && legacyWs.roundRobinIndex) || 0,
    createdAt: (legacyWs && legacyWs.createdAt) || new Date().toISOString(),
    archivedAt: null,
  };

  if (legacyWs) {
    if (legacyWs.avgDealValue != null) doc.avgDealValue = legacyWs.avgDealValue;
    if (legacyWs.timezone) doc.timezone = legacyWs.timezone;
    if (legacyWs.integrationsCipher) doc.integrationsCipher = legacyWs.integrationsCipher;
    if (legacyWs.integrationsUpdatedAt) doc.integrationsUpdatedAt = legacyWs.integrationsUpdatedAt;
    doc.members = { ...(legacyWs.members || {}) };
    workspaceScriptBootstrap.copyLegacyScriptFields(doc, legacyWs);
  }
  doc.members[em] = { role: 'owner', joinedAt: new Date().toISOString(), userId: em };

  if (!workspaceScriptBootstrap.workspaceHasScriptCatalog(doc)) {
    workspaceScriptBootstrap.seedWorkspaceScriptsOnCreate(doc, { presetKey: 'agency' });
  } else if (!doc.salesScriptsSeededAt) {
    doc.salesScriptsSeededAt = legacyWs?.salesScriptsUpdatedAt || new Date().toISOString();
    doc.salesScriptsPresetKey = doc.salesScriptsPresetKey || 'agency';
  }

  await dbService.saveWorkspace(newId, doc);
  await dbService.saveWorkspaceSlug('adhello-agency', newId);
  await dbService.putStorageKey('sys:legacy_default_workspace_id', newId);

  await migrateLeadsWorkspaceTo(newId);
  await migrateFoldersToWorkspace(newId);
  await migrateSchedulesToWorkspace(newId);
  await migrateMorningBriefsToWorkspace(newId);
  await migrateProspectingCoachCacheToWorkspace(newId);
  await migrateDailyTrackersToWorkspace(newId);
  await migrateUserScopedPrefix('default', newId, 'user_task');
  await migrateUserScopedPrefix('default', newId, 'user_resource');
  await migrateUserScopedPrefix('default', newId, 'ws_resource');

  await dbService.addUserWorkspaceId(em, newId);
  await dbService.saveUserPrefs(em, {
    email: em,
    activeWorkspaceId: newId,
  });

  if (legacyWs) {
    await dbService.deleteStorageKey('workspace:default');
  }

  console.log(`[workspace] Migrated legacy "default" workspace → ${newId} (${em})`);
  return newId;
}

/**
 * Fresh tenant: no leads and no workspace:default — still create Adhello Agency.
 */
async function createFreshDefaultWorkspace(ownerEmail) {
  const em = normEmail(ownerEmail);
  // Never mint a second Adhello Agency if the slug (or any alias) already has one.
  const existingSlugId = await dbService.getWorkspaceIdForSlug('adhello-agency');
  if (existingSlugId) {
    const existing = await dbService.getWorkspace(existingSlugId);
    if (existing && !existing.archivedAt) {
      await dbService.addUserWorkspaceId(em, existingSlugId);
      await dbService.saveUserPrefs(em, { email: em, activeWorkspaceId: existingSlugId });
      return existingSlugId;
    }
  }
  const aliasIds = await collectWorkspaceIdsForEmail(em);
  if (aliasIds.length) {
    await dbService.saveUserPrefs(em, { email: em, activeWorkspaceId: aliasIds[0] });
    return aliasIds[0];
  }

  const newId = randomUUID();
  const doc = {
    id: newId,
    ownerUserId: em,
    name: 'Adhello Agency',
    slug: 'adhello-agency',
    accentColor: '#CA8A04',
    coachPrompt: DEFAULT_COACH_AGENCY,
    icp: { keyword: '', city: '', state: '', qty: 20 },
    settings: {},
    members: {
      [em]: { role: 'owner', joinedAt: new Date().toISOString(), userId: em },
    },
    roundRobinIndex: 0,
    createdAt: new Date().toISOString(),
    archivedAt: null,
  };
  workspaceScriptBootstrap.seedWorkspaceScriptsOnCreate(doc, { presetKey: 'agency' });
  await dbService.saveWorkspace(newId, doc);
  await dbService.saveWorkspaceSlug('adhello-agency', newId);
  await dbService.putStorageKey('sys:legacy_default_workspace_id', newId);
  await dbService.addUserWorkspaceId(em, newId);
  await dbService.saveUserPrefs(em, {
    email: em,
    activeWorkspaceId: newId,
  });
  return newId;
}

/**
 * Idempotent: guarantees `userwork:` has at least one workspace for this email.
 * @param {string} ownerEmail
 */
async function ensureUserHasWorkspaces(ownerEmail) {
  const em = normEmail(ownerEmail);
  if (!em) return;

  // Prefer existing workspaces on either brand email before creating a fresh empty one.
  const linked = await linkAliasWorkspaces(em);
  if (linked.length > 0) {
    await pruneEmptyDuplicateAgencyWorkspaces(em);
    return;
  }

  let ids = await dbService.getUserWorkspaceIds(em);
  if (ids.length > 0) {
    await pruneEmptyDuplicateAgencyWorkspaces(em);
    return;
  }

  const legacyWs = await dbService.getWorkspace('default');
  const leadKeys = await dbService.listStorageKeysWithPrefix('lead:');
  const hasLeads = leadKeys.length > 0;

  if (legacyWs || hasLeads) {
    await runLegacyMigrationToNewWorkspace(em);
    return;
  }

  await createFreshDefaultWorkspace(em);
}

function userCanAccessWorkspace(workspaceDoc, email) {
  const aliases = emailAliases(email);
  if (!workspaceDoc || !aliases.length) return false;
  if (workspaceDoc.archivedAt) return false;
  for (const em of aliases) {
    if (normEmail(workspaceDoc.ownerUserId) === em) return true;
    const m = workspaceDoc.members && workspaceDoc.members[em];
    if (m && m.role) return true;
  }
  return false;
}

module.exports = {
  normEmail,
  emailAliases,
  ensureUserHasWorkspaces,
  userCanAccessWorkspace,
  collectWorkspaceIdsForEmail,
  linkAliasWorkspaces,
  pruneEmptyDuplicateAgencyWorkspaces,
  isAdhelloAgencyWorkspace,
  DEFAULT_COACH_AGENCY,
};
