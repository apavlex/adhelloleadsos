const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const dbService = require('./database');
const { getPublicBaseUrl, googleOAuthRedirectUris } = require('../lib/publicBaseUrl');

const isGoogleAuthConfigured = Boolean(
  process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
);

const baseUrl = getPublicBaseUrl();

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

function verifyEmailAllowed(profile) {
  const email = (profile.emails && profile.emails[0] && profile.emails[0].value) || '';
  if (email.endsWith('@adhello.ai')) return { ok: true, email };
  return { ok: false, email };
}

if (isGoogleAuthConfigured) {
  const clientID = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  passport.use(
    'google',
    new GoogleStrategy(
      {
        clientID,
        clientSecret,
        callbackURL: `${baseUrl}/auth/google/callback`,
      },
      function (accessToken, refreshToken, profile, done) {
        const gate = verifyEmailAllowed(profile);
        if (!gate.ok) {
          return done(null, false, { message: 'Access restricted to adhello.ai workspace.' });
        }
        return done(null, slimGoogleProfile(profile));
      }
    )
  );

  passport.use(
    'googleDrive',
    new GoogleStrategy(
      {
        clientID,
        clientSecret,
        callbackURL: `${baseUrl}/auth/google/drive/callback`,
      },
      async function (accessToken, refreshToken, profile, done) {
        const gate = verifyEmailAllowed(profile);
        if (!gate.ok) {
          return done(null, false, { message: 'Access restricted to adhello.ai workspace.' });
        }
        try {
          await dbService.mergeGoogleDriveTokens(String(gate.email).trim().toLowerCase(), {
            accessToken,
            refreshToken,
            expiresIn: 3600,
          });
        } catch (e) {
          return done(e);
        }
        return done(null, slimGoogleProfile(profile));
      }
    )
  );
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
  if (wantsJsonResponse(req)) {
    return res.status(401).json({ success: false, error: 'Sign in required.' });
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
};
