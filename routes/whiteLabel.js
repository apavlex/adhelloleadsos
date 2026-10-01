/**
 * Public white-label assets. Phones fetch the manifest and Home Screen icon
 * without the session cookie, so these sit before ensureAuthenticated.
 */
const express = require('express');
const dbService = require('../services/database');
const whiteLabel = require('../services/whiteLabel');

const router = express.Router();

async function loadWorkspace(req) {
  const id = String(req.params.workspaceId || '').trim();
  if (!id || id.length > 80) return null;
  const ws = await dbService.getWorkspace(id);
  return ws && ws.id ? ws : null;
}

router.get('/brand/ws/:workspaceId/logo.png', async (req, res) => {
  try {
    const ws = await loadWorkspace(req);
    const logo = ws ? await whiteLabel.getLogo(ws.id) : null;
    if (!logo) return res.status(404).end();
    res.setHeader('Content-Type', logo.contentType);
    res.setHeader('Cache-Control', 'public, max-age=604800');
    return res.end(logo.buffer);
  } catch (err) {
    return res.status(404).end();
  }
});

router.get('/brand/ws/:workspaceId/icon-:size.png', async (req, res) => {
  try {
    const ws = await loadWorkspace(req);
    if (!ws) return res.status(404).end();
    const png = await whiteLabel.renderIcon(ws, parseInt(req.params.size, 10));
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=604800');
    return res.end(png);
  } catch (err) {
    console.error('[white-label] icon failed:', err.message);
    return res.status(500).end();
  }
});

router.get('/brand/ws/:workspaceId/manifest.webmanifest', async (req, res) => {
  try {
    const ws = await loadWorkspace(req);
    if (!ws) return res.status(404).end();
    res.setHeader('Content-Type', 'application/manifest+json');
    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.send(JSON.stringify(whiteLabel.manifest(ws)));
  } catch (err) {
    return res.status(404).end();
  }
});

module.exports = router;
