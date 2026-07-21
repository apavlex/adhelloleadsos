/**
 * Hidden debug routes for Pavlex MCP runtime verification.
 */
const express = require('express');
const router = express.Router();
const { runPavlexMcpDebug } = require('../services/pavlex/pavlexAgent');

/** Spec-aligned MCP debug: GET /api/debug/mcp */
router.get('/mcp', async (req, res, next) => {
  try {
    const report = await runPavlexMcpDebug(req);
    res.json({ success: true, ...report });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ success: false, error: err.message });
    }
    next(err);
  }
});

/** Legacy alias */
router.get('/pavlex-mcp', async (req, res, next) => {
  try {
    const report = await runPavlexMcpDebug(req);
    res.json({ success: true, ...report });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ success: false, error: err.message });
    }
    next(err);
  }
});

module.exports = router;
