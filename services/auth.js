const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const dbService = require('./database');
const { getPublicBaseUrl, googleOAuthRedirectUris } = require('../lib/publicBaseUrl');

const isGoogleAuthConfigured = Boolean(
  process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
);

const baseUrl = getPublicBaseUrl();

/** Current Google token endpoint — prefer over legacy oauth package defaults. */
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_TOKEN_TIMEOUT_MS = (() => {
  const n = Number(process.env.GOOGLE_OAUTH_TOKEN_TIMEOUT_MS);
  if (Number.isFinite(n) && n > 0) return Math.floor(n);
  return 12000;
})();

function slimGoogleProfile(profile) {
  return {
    id: profile.id,
    provider: profile.provider,
    displayName: profile.displayName,
    emails: profile.emails,
    photos: profile.photos,
    _json: profile._json,
  };
}

/** Any real email can be invited. Sign-in still requires that Google account. */
function isAllowedWorkspaceEmail(email) {
  const e = String(email || '')
    .trim()
    .toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

function verifyEmailAllowed(profile) {
  const email = (profile.emails && profile.emails[0] && profile.emails[0].value) || '';
  if (isAllowedWorkspaceEmail(email)) return { ok: true, email: String(email).trim().toLowerCase() };
  return { ok: false, email };
}

/**
 * passport-google-oauth20 uses the legacy `oauth` HTTP client. On some hosts
 * (notably Render) that path can hang forever on the token POST or userinfo GET,
 * which surfaces as a stuck Google sign-in and eventually a proxy 502. Native
 * fetch + timeout fails fast and uses the current token URL.
 */
function patchGoogleTokenExchange(strategy, label) {
  const oauth2 = strategy && strategy._oauth2;
  if (!oauth2 || oauth2.__adhelloFetchToken) return;
  oauth2.__adhelloFetchToken = true;
  oauth2._accessTokenUrl = GOOGLE_TOKEN_URL;
  oauth2.getOAuthAccessToken = function getOAuthAccessTokenWithFetch(code, params, callback) {
    const body = Object.assign({}, params || {});
    body.client_id = this._clientId;
    body.client_secret = this._clientSecret;
    const codeParam = body.grant_type === 'refresh_token' ? 'refresh_token' : 'code';
    body[codeParam] = code;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), GOOGLE_TOKEN_TIMEOUT_MS);

    fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams(body).toString(),
      signal: controller.signal,
    })
      .then(async (res) => {
        const text = await res.text();
        let results;
        try {
          results = JSON.parse(text);
        } catch {
          results = Object.fromEntries(new URLSearchParams(text));
        }
        if (!res.ok || !results.access_token) {
          const err = new Error(
            (results && (results.error_description || results.error)) || `token_http_${res.status}`
          );
          err.statusCode = res.status;
          err.data = text;
          err.oauthError = results && results.error;
          throw err;
        }
        const accessToken = results.access_token;
        const refreshToken = results.refresh_token;
        delete results.refresh_token;
        callback(null, accessToken, refreshToken, results);
      })
      .catch((err) => {
        const aborted = err && (err.name === 'AbortError' || /aborted/i.test(String(err.message || '')));
        const message = aborted
          ? `Google token exchange timed out after ${GOOGLE_TOKEN_TIMEOUT_MS}ms`
          : (err && err.message) || 'Google token exchange failed';
        console.error(`[Google OAuth] ${label} token exchange failed:`, message);
        const out = aborted ? new Error(message) : err;
        if (aborted) out.code = 'OAUTH_TOKEN_TIMEOUT';
        callback(out);
      })
      .finally(() => clearTimeout(timer));
  };

  // Profile/userinfo GET — same legacy client hang risk as the token POST.
  if (!oauth2.__adhelloFetchGet) {
    oauth2.__adhelloFetchGet = true;
    oauth2.get = function getWithFetch(url, accessToken, callback) {
      let cb = callback;
      let token = accessToken;
      let endpoint = url;
      if (typeof accessToken === 'function') {
        cb = accessToken;
        token = null;
        endpoint = url;
      }
      if (typeof url === 'object' && url && url.url) {
        endpoint = url.url;
      }
      const headers = {
        Accept: 'application/json',
      };
      if (token) headers.Authorization = `Bearer ${token}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), GOOGLE_TOKEN_TIMEOUT_MS);
      fetch(String(endpoint), {
        method: 'GET',
        headers,
        signal: controller.signal,
      })
        .then(async (res) => {
          const text = await res.text();
          if (!res.ok) {
            const err = new Error(`userinfo_http_${res.status}`);
            err.statusCode = res.status;
            err.data = text;
            throw err;
          }
          cb(null, text);
        })
        .catch((err) => {
          const aborted = err && (err.name === 'AbortError' || /aborted/i.test(String(err.message || '')));
          const message = aborted
            ? `Google profile fetch timed out after ${GOOGLE_TOKEN_TIMEOUT_MS}ms`
            : (err && err.message) || 'Google profile fetch failed';
          console.error(`[Google OAuth] ${label} profile fetch failed:`, message);
          const out = aborted ? new Error(message) : err;
          if (aborted) out.code = 'OAUTH_PROFILE_TIMEOUT';
          cb(out);
        })
        .finally(() => clearTimeout(timer));
    };
  }
}

if (isGoogleAuthConfigured) {
  const clientID = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  const googleStrategy = new GoogleStrategy(
    {
      clientID,
      clientSecret,
      callbackURL: `${baseUrl}/auth/google/callback`,
      tokenURL: GOOGLE_TOKEN_URL,
    },
    function (accessToken, refreshToken, profile, done) {
      const gate = verifyEmailAllowed(profile);
      if (!gate.ok) {
        return done(null, false, { message: 'Google did not return an email address for this account.' });
      }
      return done(null, slimGoogleProfile(profile));
    }
  );
  patchGoogleTokenExchange(googleStrategy, 'sign-in');
  passport.use('google', googleStrategy);

  const googleDriveStrategy = new GoogleStrategy(
    {
      clientID,
      clientSecret,
      callbackURL: `${baseUrl}/auth/google/drive/callback`,
      tokenURL: GOOGLE_TOKEN_URL,
    },
    async function (accessToken, refreshToken, profile, done) {
      const gate = verifyEmailAllowed(profile);
      if (!gate.ok) {
        return done(null, false, { message: 'Google did not return an email address for this account.' });
      }
      try {
        const driveEmail =
          (profile.emails && profile.emails[0] && profile.emails[0].value) || gate.email;
        await dbService.mergeGoogleDriveTokens(String(gate.email).trim().toLowerCase(), {
          accessToken,
          refreshToken,
          expiresIn: 3600,
          googleAccountEmail: driveEmail,
          googleAccountName: profile.displayName || driveEmail,
        });
      } catch (e) {
        return done(e);
      }
      return done(null, slimGoogleProfile(profile));
    }
  );
  patchGoogleTokenExchange(googleDriveStrategy, 'drive');
  passport.use('googleDrive', googleDriveStrategy);
} else {
  console.log('Google Auth: Missing credentials. Login page will be accessible but login will fail.');
}

if (isGoogleAuthConfigured) {
  const uris = googleOAuthRedirectUris(baseUrl);
  console.log('[Google OAuth] Register these Authorized redirect URIs in Google Cloud Console:');
  console.log(`  - ${uris.signIn}`);
  console.log(`  - ${uris.drive}`);
}

passport.serializeUser((user, done) => {
  done(null, user);
});

passport.deserializeUser((user, done) => {
  done(null, user);
});

const { wantsJsonResponse } = require('../lib/httpRequest');

function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) {
    return next();
  }
  // Allow API key auth for programmatic access (cron jobs, scouts, etc.)
  const apiKey = req.headers['x-api-key'] || req.query.api_key;
  if (apiKey && apiKey === (process.env.API_INGEST_KEY || 'adhello_secret_123')) {
    return next();
  }
  if (wantsJsonResponse(req)) {
    return res.status(401).json({ success: false, error: 'Sign in required.' });
  }
  if (req.session) {
    const dest = String(req.originalUrl || '');
    if (dest.startsWith('/') && !dest.startsWith('//') && !dest.startsWith('/auth/')) {
      req.session.returnTo = dest;
    }
  }
  res.redirect('/auth/login');
}

function requireGoogleAuth(req, res, next) {
  if (isGoogleAuthConfigured) return next();
  return res.redirect('/auth/login?error=auth_not_configured');
}

module.exports = {
  passport,
  ensureAuthenticated,
  isGoogleAuthConfigured,
  requireGoogleAuth,
  getPublicBaseUrl,
  googleOAuthRedirectUris,
  isAllowedWorkspaceEmail,
};
