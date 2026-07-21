/**
 * Hidden debug routes for Pavlex MCP runtime verification.
 */
const express = require('express');
const router = express.Router();
const { runPavlexMcpDebug } = require('../services/pavlex/pavlexAgent');

router.get('/pavlex-mcp', async (req, res, next) => {
  try {
    if (!req.workspaceId) {
      return res.status(400).json({ success: false, error: 'No active workspace.' });
    }
    const report = await runPavlexMcpDebug(req);
    res.json({ success: true, ...report });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
