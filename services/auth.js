const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;

const isGoogleAuthConfigured = Boolean(
  process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
);

if (isGoogleAuthConfigured) {
  passport.use(new GoogleStrategy({
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: `${process.env.BASE_URL || 'http://localhost:3000'}/auth/google/callback`
    },
    async function(accessToken, refreshToken, profile, done) {
      const email = profile.emails[0].value;
      
      // Restrict access explicitly to the @adhello.ai workspace
      if (email.endsWith('@adhello.ai')) {
        // App uses Replit / file-backed KV (see services/database.js), not SQL — persist user in session only
        return done(null, profile);
      } else {
        return done(null, false, { message: 'Access restricted to adhello.ai workspace.' });
      }
    }
  ));
} else {
  console.log('Google Auth: Missing credentials. Login page will be accessible but login will fail.');
}

passport.serializeUser((user, done) => {
  done(null, user);
});

passport.deserializeUser((user, done) => {
  done(null, user);
});

function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) {
    return next();
  }
  res.redirect('/auth/login');
}

function requireGoogleAuth(req, res, next) {
  if (isGoogleAuthConfigured) return next();
  return res.redirect('/auth/login?error=auth_not_configured');
}

module.exports = { passport, ensureAuthenticated, isGoogleAuthConfigured, requireGoogleAuth };
