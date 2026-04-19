const express = require('express');
const router = express.Router();
const dbService = require('../services/database');
const { userEmail } = require('../services/workspaceService');

const COLUMNS = [
  { id: 'backlog', label: 'Backlog' },
  { id: 'todo', label: 'To do' },
  { id: 'doing', label: 'Doing' },
  { id: 'done', label: 'Done' },
];

const ALLOWED = new Set(COLUMNS.map((c) => c.id));

function normColumn(c) {
  const s = String(c || '').toLowerCase();
  return ALLOWED.has(s) ? s : 'todo';
}

function newTaskId() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

router.get('/', async (req, res, next) => {
  try {
    const email = userEmail(req);
    const tasks = await dbService.listUserTasks(req.workspaceId, email);
    res.render('tasks', {
      title: 'Tasks | Agency OS',
      activePage: 'tasks',
      tasks,
      taskColumns: COLUMNS,
    });
  } catch (e) {
    next(e);
  }
});

router.get('/api', async (req, res, next) => {
  try {
    const email = userEmail(req);
    const tasks = await dbService.listUserTasks(req.workspaceId, email);
    res.json({ success: true, tasks });
  } catch (e) {
    next(e);
  }
});

router.post('/api', express.json(), async (req, res, next) => {
  try {
    const title = String(req.body.title || '').trim();
    if (!title) return res.status(400).json({ success: false, error: 'Title is required.' });
    const email = userEmail(req);
    const task = {
      id: newTaskId(),
      title,
      column: normColumn(req.body.column),
      sort: Date.now(),
      createdAt: new Date().toISOString(),
    };
    const saved = await dbService.saveUserTask(req.workspaceId, email, task);
    res.json({ success: true, task: saved });
  } catch (e) {
    next(e);
  }
});

router.patch('/api/:taskId', express.json(), async (req, res, next) => {
  try {
    const taskId = String(req.params.taskId || '').trim();
    if (!taskId) return res.status(400).json({ success: false, error: 'Invalid task.' });
    const email = userEmail(req);
    const existing = await dbService.listUserTasks(req.workspaceId, email);
    const cur = existing.find((t) => t.id === taskId);
    if (!cur) return res.status(404).json({ success: false, error: 'Task not found.' });
    const nextTask = {
      ...cur,
      title: req.body.title != null ? String(req.body.title).trim() || cur.title : cur.title,
      column: req.body.column != null ? normColumn(req.body.column) : cur.column,
      sort: req.body.sort != null ? Number(req.body.sort) || cur.sort : cur.sort,
    };
    const saved = await dbService.saveUserTask(req.workspaceId, email, nextTask);
    res.json({ success: true, task: saved });
  } catch (e) {
    next(e);
  }
});

router.delete('/api/:taskId', async (req, res, next) => {
  try {
    const taskId = String(req.params.taskId || '').trim();
    if (!taskId) return res.status(400).json({ success: false, error: 'Invalid task.' });
    const email = userEmail(req);
    const existing = await dbService.listUserTasks(req.workspaceId, email);
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
