/**
 * OAuth endpoints that let ChatGPT, Claude, and other MCP clients connect to /ceo/mcp
 * with "Sign in with AdHello": discovery, dynamic registration, consent, tokens.
 * Mounted before ensureAuthenticated — /oauth/authorize handles sign-in itself.
 */
const crypto = require('crypto');
const express = require('express');
const dbService = require('../services/database');
const workspaceBootstrap = require('../services/workspaceBootstrap');
const { userEmail } = require('../services/workspaceService');
const { getPublicBaseUrl } = require('../lib/publicBaseUrl');
const oauth = require('../services/mcp/mcpOAuth');

const router = express.Router();

// Agents often guess /mcp; serve the same MCP endpoint as /ceo/mcp.
router.use('/mcp', require('./mcp'));

const ALL_WORKSPACES = '__all__';
const TXN_TTL_MS = 15 * 60 * 1000;
const MAX_TXNS = 5;

function rateLimit({ windowMs, max }) {
  const hits = new Map();
  return (req, res, next) => {
    const key = req.ip || 'unknown';
    const now = Date.now();
    let bucket = hits.get(key);
    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + windowMs };
      hits.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > max) {
      return res.status(429).json({ error: 'slow_down', error_description: 'Too many requests. Try again shortly.' });
    }
    return next();
  };
}

function oauthErrorJson(res, err) {
  if (err instanceof oauth.OAuthError) {
    if (err.status === 401) res.set('WWW-Authenticate', 'Basic realm="oauth"');
    return res.status(err.status).json({ error: err.error, error_description: err.message });
  }
  console.error('[oauth] server error:', err && err.message);
  return res.status(500).json({ error: 'server_error', error_description: 'Something went wrong.' });
}

function pageHeaders(res) {
  res.set('Cache-Control', 'no-store');
  res.set('X-Frame-Options', 'DENY');
  res.set('Content-Security-Policy', "frame-ancestors 'none'");
}

function renderPage(res, status, locals) {
  pageHeaders(res);
  return res.status(status).render('oauth_consent', {
    error: '',
    connector: null,
    workspaces: [],
    allowAll: false,
    selected: '',
    txn: '',
    email: '',
    ...locals,
  });
}

function redirectHost(uri) {
  try {
    const url = new URL(uri);
    return url.host || url.protocol.replace(/:$/, '');
  } catch {
    return '';
  }
}

async function accessibleWorkspaces(email) {
  const ids = await workspaceBootstrap.collectWorkspaceIdsForEmail(email);
  const docs = await Promise.all(ids.map((id) => dbService.getWorkspace(id)));
  return docs
    .filter((ws) => ws && workspaceBootstrap.userCanAccessWorkspace(ws, email))
    .map((ws) => ({ id: ws.id, name: ws.name || 'Workspace' }));
}

/** Where /signup/complete sends a brand-new user: back to this authorize request. */
function rememberConnectSignup(session, url, clientName) {
  session.connectSignup = { url, clientName: String(clientName || 'your AI app').slice(0, 80), at: Date.now() };
}

function rememberTxn(session, txn, value) {
  const now = Date.now();
  const kept = Object.entries(session.oauthTxns || {})
    .filter(([, t]) => t && now - t.at < TXN_TTL_MS)
    .slice(-(MAX_TXNS - 1));
  session.oauthTxns = Object.fromEntries(kept.concat([[txn, value]]));
}

function takeTxn(session, txn) {
  const all = session.oauthTxns || {};
  const found = all[txn];
  delete all[txn];
  session.oauthTxns = all;
  return found && Date.now() - found.at < TXN_TTL_MS ? found : null;
}

// ── Discovery ────────────────────────────────────────────────────────────────

router.get(['/.well-known/oauth-authorization-server', '/.well-known/oauth-authorization-server/*'], (req, res) => {
  res.set('Cache-Control', 'public, max-age=3600');
  res.json(oauth.authorizationServerMetadata(getPublicBaseUrl(req)));
});

router.get(['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/*'], (req, res) => {
  res.set('Cache-Control', 'public, max-age=3600');
  res.json(oauth.protectedResourceMetadata(getPublicBaseUrl(req)));
});

// ── Registration ─────────────────────────────────────────────────────────────

router.post('/oauth/register', rateLimit({ windowMs: 60 * 60 * 1000, max: 20 }), async (req, res) => {
  try {
    const client = await oauth.registerClient(req.body);
    res.set('Cache-Control', 'no-store');
    return res.status(201).json(client);
  } catch (err) {
    return oauthErrorJson(res, err);
  }
});

// ── Authorize + consent ──────────────────────────────────────────────────────

router.get('/oauth/authorize', async (req, res, next) => {
  try {
    const check = await oauth.checkAuthorizeRequest(req.query);
    if (!check.ok && !check.redirect) return renderPage(res, 400, { error: check.error });
    if (!check.ok) {
      return res.redirect(oauth.redirectWith(check.redirectUri, {
        error: check.error,
        error_description: check.description,
        state: check.state,
      }));
    }

    const lockedWs = check.client.manual && !check.client.allWorkspaces ? check.client.workspaceId : '';
    if (!(req.isAuthenticated && req.isAuthenticated())) {
      if (req.session) {
        req.session.returnTo = req.originalUrl;
        // New users can start a free trial and come straight back to this consent screen.
        if (!lockedWs) rememberConnectSignup(req.session, req.originalUrl, check.client.name);
      }
      return res.redirect('/auth/login?connect=1');
    }

    const email = userEmail(req);
    const workspaces = (await accessibleWorkspaces(email)).filter((w) => !lockedWs || w.id === lockedWs);
    if (!workspaces.length) {
      if (!lockedWs && !(req.user && req.user.demoGuest)) {
        rememberConnectSignup(req.session, req.originalUrl, check.client.name);
        return res.redirect('/signup?connect=1');
      }
      return renderPage(res, 403, {
        error: `This app was set up for a workspace ${email} is not on. Sign in with the Google account you use for AdHello.`,
      });
    }

    const txn = crypto.randomBytes(16).toString('hex');
    rememberTxn(req.session, txn, { params: check.params, clientName: check.client.name, lockedWs, at: Date.now() });
    const active = req.session.activeWorkspaceId;
    // Default to one workspace (session/home). "All my workspaces" is opt-in — a shared
    // roaming default previously let bots flip each other between businesses.
    return renderPage(res, 200, {
      connector: { name: check.client.name, redirectHost: redirectHost(check.params.redirectUri) },
      workspaces,
      allowAll: !lockedWs && workspaces.length > 1,
      selected: workspaces.some((w) => w.id === active) ? active : workspaces[0].id,
      txn,
      email,
    });
  } catch (err) {
    return next(err);
  }
});

router.post('/oauth/authorize', async (req, res, next) => {
  try {
    if (!(req.isAuthenticated && req.isAuthenticated())) {
      return renderPage(res, 401, { error: 'Your AdHello sign-in expired. Go back to the app and connect again.' });
    }
    const pending = takeTxn(req.session || {}, String(req.body.txn || ''));
    if (!pending) {
      return renderPage(res, 400, { error: 'This connection request expired. Go back to the app and connect again.' });
    }
    const { params } = pending;
    if (req.body.decision !== 'allow') {
      return res.redirect(oauth.redirectWith(params.redirectUri, {
        error: 'access_denied',
        error_description: 'The user declined access.',
        state: params.state,
      }));
    }

    const email = userEmail(req);
    const workspaces = await accessibleWorkspaces(email);
    const picked = String(req.body.workspaceId || '');
    const allWorkspaces = picked === ALL_WORKSPACES && !pending.lockedWs && workspaces.length > 0;
    const active = req.session.activeWorkspaceId;
    const workspaceId = allWorkspaces
      ? (workspaces.find((w) => w.id === active) || workspaces[0]).id
      : picked;
    if (!workspaces.some((w) => w.id === workspaceId) || (pending.lockedWs && pending.lockedWs !== workspaceId)) {
      return renderPage(res, 403, { error: 'You do not have access to that workspace.' });
    }

    const code = await oauth.issueAuthorizationCode({ params, workspaceId, userEmail: email, allWorkspaces });
    return res.redirect(oauth.redirectWith(params.redirectUri, {
      code,
      state: params.state,
      iss: getPublicBaseUrl(req),
    }));
  } catch (err) {
    return next(err);
  }
});

// ── Tokens ───────────────────────────────────────────────────────────────────

function clientCredentials(req) {
  const body = req.body || {};
  const basic = /^Basic\s+(.+)$/i.exec(String(req.get('authorization') || ''));
  if (basic) {
    const decoded = Buffer.from(basic[1], 'base64').toString('utf8');
    const idx = decoded.indexOf(':');
    const id = idx >= 0 ? decoded.slice(0, idx) : decoded;
    const secret = idx >= 0 ? decoded.slice(idx + 1) : '';
    return { clientId: decodeURIComponent(id), clientSecret: decodeURIComponent(secret) };
  }
  return { clientId: String(body.client_id || ''), clientSecret: String(body.client_secret || '') };
}

router.post('/oauth/token', rateLimit({ windowMs: 60 * 1000, max: 60 }), async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.set('Pragma', 'no-cache');
  try {
    const body = req.body || {};
    const creds = clientCredentials(req);
    let tokens;
    if (body.grant_type === 'authorization_code') {
      tokens = await oauth.exchangeAuthorizationCode({
        code: String(body.code || ''),
        redirectUri: String(body.redirect_uri || ''),
        codeVerifier: String(body.code_verifier || ''),
        ...creds,
      });
    } else if (body.grant_type === 'refresh_token') {
      tokens = await oauth.refreshAccessToken({ refreshToken: String(body.refresh_token || ''), ...creds });
    } else {
      throw new oauth.OAuthError('unsupported_grant_type', 'Use authorization_code or refresh_token.');
    }
    return res.json(tokens);
  } catch (err) {
    return oauthErrorJson(res, err);
  }
});

router.post('/oauth/revoke', rateLimit({ windowMs: 60 * 1000, max: 30 }), async (req, res) => {
  try {
    await oauth.revokeToken(String((req.body && req.body.token) || ''));
  } catch (err) {
    console.error('[oauth] revoke failed:', err.message);
  }
  return res.status(200).end();
});

module.exports = router;
