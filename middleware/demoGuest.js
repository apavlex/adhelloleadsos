/**
 * Live-demo visitors: expire their session with the sandbox, keep them out of
 * account-level settings, and run the rest of the request behind guestEgress.
 */
const guestEgress = require('../lib/guestEgress');
const publicDemo = require('../services/publicDemo');
const { wantsJsonResponse } = require('../lib/httpRequest');

const BLOCKED = [
  { re: /^\/workspaces\/(new|demo|live-demo)(\/|\.json|$)/ },
  { re: /^\/workspaces\/?$/, methods: ['POST'] },
  { re: /^\/workspace\/team\/invite/ },
  { re: /^\/workspace\/integrations(\/|$)/ },
  { re: /^\/workspace\/scripts\/push/ },
  { re: /^\/oauth\// },
  { re: /^\/ceo(\/|$)/ },
  { re: /^\/auth\/google\/drive/ },
  { re: /^\/api\/debug(\/|$)/ },
];

function isBlocked(req) {
  const p = String(req.path || '');
  return BLOCKED.some((rule) => rule.re.test(p) && (!rule.methods || rule.methods.includes(req.method)));
}

function endSession(req, res, redirectTo) {
  req.logout(() => {
    if (req.session) req.session.destroy(() => res.redirect(redirectTo));
    else res.redirect(redirectTo);
  });
}

function demoGuest(req, res, next) {
  const guest = req.user && req.user.demoGuest;
  if (!guest) return next();

  if (req.path === '/logout') {
    if (/prefetch/i.test(String(req.get('sec-purpose') || req.get('purpose') || ''))) return res.status(204).end();
    return endSession(req, res, '/live-demo/ended?by=you');
  }

  if (!publicDemo.isSandboxLive(guest)) {
    if (wantsJsonResponse(req)) {
      return req.logout(() => res.status(401).json({ success: false, error: 'This live demo has ended.' }));
    }
    return endSession(req, res, '/live-demo/ended');
  }

  const cfg = publicDemo.getConfig();
  if (isBlocked(req)) {
    const error = 'That part of the app is turned off in the live demo.';
    if (wantsJsonResponse(req)) return res.status(403).json({ success: false, error, demo: true });
    return res.status(403).render('live_demo', { state: 'blocked', message: error, cta: cfg, key: '', visitor: {} });
  }

  res.locals.liveDemo = { expiresAt: guest.expiresAt, ctaUrl: cfg.ctaUrl, ctaLabel: cfg.ctaLabel };
  const wid = guest.workspaceId;
  return guestEgress.run({ guest: true, workspaceId: wid, onAiCall: () => publicDemo.takeAiCall(wid) }, next);
}

module.exports = demoGuest;
module.exports.isBlocked = isBlocked;
