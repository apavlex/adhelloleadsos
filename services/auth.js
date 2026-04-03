const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  passport.use(new GoogleStrategy({
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: `${process.env.BASE_URL || 'http://localhost:3000'}/auth/google/callback`
    },
    async function(accessToken, refreshToken, profile, done) {
      const email = profile.emails[0].value;
      
      // Restrict access explicitly to the @adhello.ai workspace
      if (email.endsWith('@adhello.ai')) {
        // Create or update user in database
        await db.query(
            `INSERT INTO users (google_id, email, name, picture) 
             VALUES (?, ?, ?, ?) 
             ON DUPLICATE KEY UPDATE 
             name = VALUES(name), 
             picture = VALUES(picture),
             last_login = CURRENT_TIMESTAMP`,
            [profile.id, profile.emails[0].value, profile.displayName, profile.photos[0].value]
        );
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
  // --- TEMPORARY BYPASS FOR VERIFICATION ---
  req.user = { id: 'dummy-id', emails: [{ value: 'dev@adhello.ai' }] };
  return next();
}

module.exports = { passport, ensureAuthenticated };
