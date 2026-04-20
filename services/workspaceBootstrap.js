/**
 * First-time and legacy migration: ensures each signed-in user has at least one workspace,
 * migrates `default` workspace + keys to UUID "Adhello Agency", sets slug index + user prefs.
 */
const { randomUUID } = require('crypto');
const dbService = require('./database');

const DEFAULT_COACH_AGENCY =
  'You are coaching a digital ad agency owner targeting small businesses. Focus on reply-bait and offer clarity.';

function normEmail(email) {
  return String(email || '')
    .trim()
    .toLowerCase();
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
  }
  doc.members[em] = { role: 'owner', joinedAt: new Date().toISOString(), userId: em };

  await dbService.saveWorkspace(newId, doc);
  await dbService.saveWorkspaceSlug('adhello-agency', newId);
  await dbService.putStorageKey('sys:legacy_default_workspace_id', newId);

  await migrateLeadsWorkspaceTo(newId);
  await migrateFoldersToWorkspace(newId);
  await migrateSchedulesToWorkspace(newId);
  await migrateMorningBriefsToWorkspace(newId);
  await migrateDailyTrackersToWorkspace(newId);
  await migrateUserScopedPrefix('default', newId, 'user_task');
  await migrateUserScopedPrefix('default', newId, 'user_resource');

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

  let ids = await dbService.getUserWorkspaceIds(em);
  if (ids.length > 0) return;

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
  const em = normEmail(email);
  if (!workspaceDoc || !em) return false;
  if (normEmail(workspaceDoc.ownerUserId) === em) return true;
  const m = workspaceDoc.members && workspaceDoc.members[em];
  return !!(m && m.role);
}

module.exports = {
  normEmail,
  ensureUserHasWorkspaces,
  userCanAccessWorkspace,
  DEFAULT_COACH_AGENCY,
};
