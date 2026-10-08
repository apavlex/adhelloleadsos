/**
 * Platform admin (PUBLIC_DEMO_ADMIN_EMAILS or owners/admins of AdHello Agency):
 * every self-serve signup, their contact info, workspace and trial controls.
 */
const express = require('express');
const dbService = require('../services/database');
const trials = require('../services/trials');
const publicDemo = require('../services/publicDemo');
const workspaceService = require('../services/workspaceService');
const withWorkspace = require('../middleware/withWorkspace');
const { wantsJsonResponse } = require('../lib/httpRequest');
const { getPublicBaseUrl } = require('../lib/publicBaseUrl');

const router = express.Router();

async function requirePlatformAdmin(req, res, next) {
  try {
    if (await publicDemo.canManage(workspaceService.userEmail(req))) return next();
    if (wantsJsonResponse(req)) return res.status(403).json({ success: false, error: 'Admins only.' });
    return res.status(403).render('error', { message: 'Only AdHello admins can open this page.', activePage: '' });
  } catch (e) {
    return next(e);
  }
}

router.use(requirePlatformAdmin);

async function signupRows(now = Date.now()) {
  const signups = trials.listSignups();
  const docs = await Promise.all(signups.map((s) => (s.workspaceId ? dbService.getWorkspace(s.workspaceId) : null)));
  return signups.map((s, i) => {
    const ws = docs[i];
    const st = ws ? trials.status(ws, now) : null;
    const usage = ws ? trials.usageFor(ws.id, now) : { paid: 0, ai: 0 };
    const members = ws && ws.members ? Object.keys(ws.members) : [];
    return {
      ...s,
      workspace: ws
        ? { id: ws.id, name: ws.name, slug: ws.slug, archived: !!ws.archivedAt, memberCount: members.length }
        : null,
      status: st,
      usage,
      log: (ws && ws.trial && Array.isArray(ws.trial.log) ? ws.trial.log : []).slice(-3).reverse(),
    };
  });
}

router.get('/signups', async (req, res, next) => {
  try {
    const rows = await signupRows();
    const counts = { total: rows.length, trial: 0, expired: 0, active: 0 };
    rows.forEach((r) => {
      if (r.status && counts[r.status.state] != null) counts[r.status.state] += 1;
    });
    res.render('admin_signups', {
      title: 'Signups | Agency OS',
      activePage: 'admin-signups',
      rows,
      counts,
      defaults: trials.defaults(),
      signupUrl: `${getPublicBaseUrl(req)}/signup`,
      mcpUrl: `${getPublicBaseUrl(req)}/ceo/mcp`,
      flash: String(req.query.ok || req.query.error || '').slice(0, 200),
      flashError: !!req.query.error,
    });
  } catch (e) {
    next(e);
  }
});

router.post('/signups/:workspaceId/trial', express.urlencoded({ extended: false }), async (req, res) => {
  const wid = String(req.params.workspaceId || '').trim();
  const action = String(req.body.action || '').trim();
  try {
    await trials.adminUpdate(wid, {
      action,
      days: req.body.days,
      paidCallsPerDay: req.body.paidCallsPerDay,
      aiCallsPerDay: req.body.aiCallsPerDay,
      by: workspaceService.userEmail(req),
    });
    const labels = {
      extend: 'Trial extended.',
      end: 'Trial ended — workspace is locked.',
      activate: 'Activated — no trial limits.',
      deactivate: 'Back on trial limits.',
      limits: 'Daily limits saved.',
    };
    return res.redirect(`/admin/signups?ok=${encodeURIComponent(labels[action] || 'Saved.')}#ws-${wid}`);
  } catch (e) {
    return res.redirect(`/admin/signups?error=${encodeURIComponent(e.message)}`);
  }
});

/** Join the signup's workspace as admin and jump to its Integrations page. */
router.post('/signups/:workspaceId/open', async (req, res) => {
  const wid = String(req.params.workspaceId || '').trim();
  const email = workspaceService.userEmail(req);
  try {
    await trials.grantAdminAccess(wid, email);
    withWorkspace.clearSwitcherCache(email);
    const next = String((req.body && req.body.next) || '') === 'today' ? '/today' : '/workspace/integrations';
    return res.redirect(`/workspaces/open?workspaceId=${encodeURIComponent(wid)}&next=${encodeURIComponent(next)}`);
  } catch (e) {
    return res.redirect(`/admin/signups?error=${encodeURIComponent(e.message)}`);
  }
});

module.exports = router;
