/**
 * Per-user task helpers — dedupe open tasks by leadKey (keep latest only).
 */
const dbService = require('./database');

function newTaskId() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function taskRecencyScore(task) {
  if (!task || typeof task !== 'object') return 0;
  return Math.max(
    Date.parse(task.updatedAt || '') || 0,
    Date.parse(task.scheduledAt || '') || 0,
    typeof task.sort === 'number' ? task.sort : 0,
    Date.parse(task.createdAt || '') || 0,
  );
}

function normRemindMinutesBefore(v) {
  if (v == null || v === '' || v === false) return null;
  const n = parseInt(v, 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(n, 24 * 60);
}

/** Remove duplicate open tasks for the same lead — keeps the most recently updated. */
async function dedupeOpenLeadTasks(workspaceId, email) {
  const tasks = await dbService.listUserTasks(workspaceId, email);
  const groups = new Map();
  for (const t of tasks) {
    if (!t || !t.leadKey || t.column === 'done') continue;
    const lk = String(t.leadKey);
    if (!groups.has(lk)) groups.set(lk, []);
    groups.get(lk).push(t);
  }
  for (const group of groups.values()) {
    if (group.length <= 1) continue;
    group.sort((a, b) => taskRecencyScore(b) - taskRecencyScore(a));
    for (let i = 1; i < group.length; i += 1) {
      await dbService.deleteUserTask(workspaceId, email, group[i].id);
    }
  }
}

/**
 * Create or update the single open task for a lead.
 * When leadKey is absent, always creates a new task.
 */
async function upsertOpenTaskForLead(workspaceId, email, fields) {
  const title = String(fields.title || '').trim();
  if (!title) throw new Error('Title is required.');

  const leadKey = fields.leadKey ? String(fields.leadKey).trim() : null;
  const scheduledAt = fields.scheduledAt ?? null;
  const column = fields.column || 'todo';
  const remindMinutesBefore = normRemindMinutesBefore(fields.remindMinutesBefore);
  const preferredTaskId = fields.preferredTaskId
    ? String(fields.preferredTaskId).trim()
    : null;

  if (!leadKey) {
    return dbService.saveUserTask(workspaceId, email, {
      id: newTaskId(),
      title,
      column,
      sort: Date.now(),
      createdAt: new Date().toISOString(),
      scheduledAt,
      leadKey: null,
      remindMinutesBefore,
    });
  }

  await dedupeOpenLeadTasks(workspaceId, email);
  const tasks = await dbService.listUserTasks(workspaceId, email);
  const openForLead = tasks.filter((t) => t.leadKey === leadKey && t.column !== 'done');

  let keep = null;
  if (preferredTaskId) {
    keep = openForLead.find((t) => t.id === preferredTaskId) || null;
  }
  if (!keep && openForLead.length) {
    openForLead.sort((a, b) => taskRecencyScore(b) - taskRecencyScore(a));
    keep = openForLead[0];
  }

  const saved = await dbService.saveUserTask(workspaceId, email, {
    id: keep ? keep.id : newTaskId(),
    title,
    column: column || keep?.column || 'todo',
    sort: Date.now(),
    createdAt: keep?.createdAt || new Date().toISOString(),
    scheduledAt,
    leadKey,
    remindMinutesBefore:
      remindMinutesBefore != null ? remindMinutesBefore : keep?.remindMinutesBefore ?? null,
  });

  const refreshed = await dbService.listUserTasks(workspaceId, email);
  for (const t of refreshed) {
    if (t.leadKey === leadKey && t.column !== 'done' && t.id !== saved.id) {
      await dbService.deleteUserTask(workspaceId, email, t.id);
    }
  }

  return saved;
}

module.exports = {
  newTaskId,
  dedupeOpenLeadTasks,
  upsertOpenTaskForLead,
  normRemindMinutesBefore,
};
