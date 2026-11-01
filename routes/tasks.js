const express = require('express');
const router = express.Router();
const dbService = require('../services/database');
const { userEmail, filterLeadsForRequest } = require('../services/workspaceService');
const {
  dedupeOpenLeadTasks,
  upsertOpenTaskForLead,
  filterManualUserTasks,
  TASK_SOURCE_LEAD_TASK,
  TASK_TITLE_MAX_LENGTH,
  validateTaskTitle,
  applyTaskEdits,
} = require('../services/userTasks');
const teamActivity = require('../services/teamActivity');

function taskDueLabel(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? ` · due ${d.toISOString().slice(0, 10)}` : '';
}

const COLUMNS = [
  { id: 'backlog', label: 'Backlog' },
  { id: 'todo', label: 'To Do' },
  { id: 'doing', label: 'Doing' },
  { id: 'done', label: 'Done' },
];

const ALLOWED = new Set(COLUMNS.map((c) => c.id));

function normColumn(c) {
  const s = String(c || '').toLowerCase();
  return ALLOWED.has(s) ? s : 'todo';
}

/** Accept ISO or datetime-local; empty clears */
function normScheduledAt(v) {
  if (v == null || v === '') return null;
  const ts = Date.parse(String(v));
  if (!Number.isFinite(ts)) return null;
  return new Date(ts).toISOString();
}

async function listTasksForRequest(req) {
  const email = userEmail(req);
  await dedupeOpenLeadTasks(req.workspaceId, email);
  const all = await dbService.listUserTasks(req.workspaceId, email);
  return filterManualUserTasks(all);
}

function sanitizeLeadKey(raw) {
  if (raw == null || raw === '') return null;
  let s = String(raw).trim();
  if (!s.startsWith('lead:')) {
    const frag = s.replace(/^lead:/i, '').replace(/[^\w-]/g, '');
    if (!frag) return null;
    s = `lead:${frag}`;
  }
  if (s.length > 200) return null;
  return s;
}

/** Resolve one lead for linking without cold-scanning the whole workspace list. */
async function resolveVisibleLead(req, rawKey) {
  const key = sanitizeLeadKey(rawKey);
  if (!key) return null;
  const lead = await dbService.getLead(key, req.workspaceId);
  if (!lead) return null;
  const visible = filterLeadsForRequest(req, [lead]);
  return visible[0] || null;
}

function enrichTasksWithTitleMap(tasks, titleMap) {
  return tasks.map((t) => {
    const meta = t.leadKey && titleMap.get(t.leadKey);
    const leadTitle = meta ? String(meta.title || '').slice(0, 120) || null : null;
    return { ...t, leadTitle };
  });
}

function titleMapForTasks(tasks, extraKeys) {
  const keys = [];
  (tasks || []).forEach((t) => {
    if (t && t.leadKey) keys.push(t.leadKey);
  });
  (extraKeys || []).forEach((k) => {
    if (k) keys.push(k);
  });
  return dbService.getLeadTitlesByKeys(keys);
}

router.get('/', async (req, res, next) => {
  try {
    const email = userEmail(req);
    const rawTasks = await listTasksForRequest(req);
    let initialLeadKey = String(req.query.leadKey || '').trim();
    if (initialLeadKey && !initialLeadKey.startsWith('lead:')) {
      initialLeadKey = `lead:${initialLeadKey.replace(/^lead:/i, '')}`;
    }
    const titleMap = titleMapForTasks(rawTasks, initialLeadKey ? [initialLeadKey] : []);
    const tasks = enrichTasksWithTitleMap(rawTasks, titleMap);
    let initialLeadLabel = '';
    if (initialLeadKey) {
      const meta = titleMap.get(initialLeadKey);
      if (meta && String(meta.title || '').trim()) {
        initialLeadLabel = String(meta.title || '').slice(0, 100);
      } else {
        /* Unknown / invisible lead — don't prefill a broken link. */
        initialLeadKey = '';
      }
    }
    res.render('tasks', {
      title: 'Tasks | Agency OS',
      activePage: 'tasks',
      tasks,
      taskColumns: COLUMNS,
      taskTitleMaxLength: TASK_TITLE_MAX_LENGTH,
      /* Lead picker searches /leads/search.json — do not SSR thousands of <option>s. */
      leadChoices: [],
      initialLeadKey,
      initialLeadLabel,
      taskOwnerEmail: String(email || '').trim().toLowerCase(),
    });
  } catch (e) {
    next(e);
  }
});

router.get('/api', async (req, res, next) => {
  try {
    const rawTasks = await listTasksForRequest(req);
    const titleMap = titleMapForTasks(rawTasks);
    const tasks = enrichTasksWithTitleMap(rawTasks, titleMap);
    res.json({ success: true, tasks });
  } catch (e) {
    next(e);
  }
});

router.post('/api', express.json(), async (req, res, next) => {
  try {
    const titleCheck = validateTaskTitle(req.body.title);
    if (!titleCheck.ok) return res.status(400).json({ success: false, error: titleCheck.error });
    const { title } = titleCheck;
    const email = userEmail(req);
    const lead = await resolveVisibleLead(req, req.body.leadKey);
    const leadKey = lead ? lead.key : null;
    const scheduledAt = normScheduledAt(req.body.scheduledAt);
    const remindMinutesBefore =
      req.body.remindMinutesBefore != null && req.body.remindMinutesBefore !== ''
        ? parseInt(req.body.remindMinutesBefore, 10)
        : null;
    const saved = await upsertOpenTaskForLead(req.workspaceId, email, {
      title,
      column: normColumn(req.body.column),
      scheduledAt,
      leadKey,
      remindMinutesBefore,
      source: TASK_SOURCE_LEAD_TASK,
    });
    const leadTitle = lead
      ? String(lead.title || lead.company || lead.email || 'Lead').slice(0, 120)
      : null;
    const enriched = { ...saved, leadTitle };
    if (leadKey) {
      teamActivity.record(req, {
        category: 'notes',
        action: 'task_create',
        summary: `Task: ${title.slice(0, 160)}${taskDueLabel(scheduledAt)}`,
        leadKey,
        leadTitle: leadTitle || '',
      });
    }
    res.json({ success: true, task: enriched });
  } catch (e) {
    next(e);
  }
});

router.patch('/api/:taskId', express.json(), async (req, res, next) => {
  try {
    const taskId = String(req.params.taskId || '').trim();
    if (!taskId) return res.status(400).json({ success: false, error: 'Invalid task.' });
    const email = userEmail(req);
    const existing = await listTasksForRequest(req);
    const cur = existing.find((t) => t.id === taskId);
    if (!cur) return res.status(404).json({ success: false, error: 'Task not found.' });
    const patch = { ...req.body };
    if (patch.leadKey !== undefined) {
      if (patch.leadKey == null || patch.leadKey === '') {
        patch.leadKey = null;
      } else {
        const lead = await resolveVisibleLead(req, patch.leadKey);
        if (!lead) return res.status(400).json({ success: false, error: 'Lead not found.' });
        patch.leadKey = lead.key;
      }
    }
    const edit = applyTaskEdits(cur, patch, { normColumn, normScheduledAt });
    if (!edit.ok) return res.status(400).json({ success: false, error: edit.error });
    const nextTask = edit.task;
    const saved = await dbService.saveUserTask(req.workspaceId, email, nextTask);
    const titleMap = titleMapForTasks([saved]);
    const [enriched] = enrichTasksWithTitleMap([saved], titleMap);
    if (nextTask.leadKey && nextTask.column === 'done' && cur.column !== 'done') {
      teamActivity.record(req, {
        category: 'notes',
        action: 'task_done',
        summary: `Completed task: ${String(nextTask.title || '').slice(0, 160)}`,
        leadKey: nextTask.leadKey,
        leadTitle: (enriched && enriched.leadTitle) || '',
      });
    }
    res.json({ success: true, task: enriched });
  } catch (e) {
    next(e);
  }
});

router.delete('/api/:taskId', async (req, res, next) => {
  try {
    const taskId = String(req.params.taskId || '').trim();
    if (!taskId) return res.status(400).json({ success: false, error: 'Invalid task.' });
    const email = userEmail(req);
    const existing = await listTasksForRequest(req);
    if (!existing.some((t) => t.id === taskId)) {
      return res.status(404).json({ success: false, error: 'Task not found.' });
    }
    await dbService.deleteUserTask(req.workspaceId, email, taskId);
    res.json({ success: true });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
