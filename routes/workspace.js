const express = require('express');
const router = express.Router();
const dbService = require('../services/database');
const workspaceService = require('../services/workspaceService');

router.get('/', async (req, res, next) => {
  try {
    const ws = await dbService.getWorkspace(req.workspaceId || 'default');
    const pool = workspaceService.assignablePool(ws);
    res.render('workspace', {
      title: 'Workspace & team',
      activePage: 'workspace',
      workspace: ws,
      assignPool: pool,
      envHintSdr: !!process.env.WORKSPACE_SDR_EMAILS,
    });
  } catch (e) {
    next(e);
  }
});

/** Switch workspace (stub — only default until multi-workspace IDs are exposed). */
router.post('/switch', express.urlencoded({ extended: true }), async (req, res) => {
  const id = (req.body.workspaceId || 'default').trim();
  if (req.session) req.session.workspaceId = id;
  res.redirect('/workspace');
});

module.exports = router;
