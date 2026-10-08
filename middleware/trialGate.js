/**
 * Trial workspaces: show days left, meter paid outbound calls during the
 * trial, and lock the workspace once it ends (platform admins still get in).
 */
const guestEgress = require('../lib/guestEgress');
const trials = require('../services/trials');
const { wantsJsonResponse } = require('../lib/httpRequest');

const OPEN_WHEN_LOCKED = [/^\/workspaces\/(switch|open)(\/|$)/, /^\/logout$/];

function trialGate(req, res, next) {
  const ws = req.workspace;
  const st = ws && trials.status(ws);
  if (!st || st.state === 'active') return next();

  const contact = trials.contactInfo();
  res.locals.trial = { ...st, contact };
  const path = String(req.path || '');

  if (st.state === 'expired') {
    if (res.locals.canManageDemo || OPEN_WHEN_LOCKED.some((re) => re.test(path))) return next();
    const error = 'Your free trial has ended. Contact us to keep using Agency OS.';
    if (wantsJsonResponse(req)) return res.status(402).json({ success: false, error, trialEnded: true });
    return res.status(402).render('trial_ended', {
      title: 'Trial ended | Agency OS',
      workspaceName: ws.name || 'Your workspace',
      contact,
      switcher: res.locals.workspaceSwitcherList || [],
      currentId: ws.id,
    });
  }

  if (/^\/workspaces\/new(\/|$)/.test(path)) {
    const error = 'Extra workspaces are available after your trial. Contact us to upgrade.';
    if (wantsJsonResponse(req)) return res.status(403).json({ success: false, error });
    return res.status(403).render('error', { message: error, activePage: '' });
  }

  if (guestEgress.current()) return next();
  return guestEgress.run({ trial: true, workspaceId: ws.id, check: trials.egressCheck(ws) }, next);
}

module.exports = trialGate;
