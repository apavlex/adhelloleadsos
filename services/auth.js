const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;

passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: `${process.env.BASE_URL || 'http://localhost:3000'}/auth/google/callback`
  },
  function(accessToken, refreshToken, profile, done) {
    const email = profile.emails[0].value;
    // Restrict to adhello.ai domain
    if (email.endsWith('@adhello.ai')) {
      return done(null, profile);
    } else {
      return done(null, false, { message: 'Access restricted to adhello.ai workspace.' });
    }
  }
));

passport.serializeUser((user, done) => {
  done(null, user);
});

passport.deserializeUser((user, done) => {
  done(null, user);
});

function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }
  res.redirect('/auth/login');
}

module.exports = { passport, ensureAuthenticated };
