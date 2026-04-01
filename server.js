require('dotenv').config();
const express = require('express');
const path = require('path');
const session = require('express-session');
const { passport, ensureAuthenticated } = require('./services/auth');
const { enrichLead } = require('./services/firecrawl');
const scheduler = require('./services/scheduler');

const indexRoutes = require('./routes/index');
const searchRoutes = require('./routes/search');
const historyRoutes = require('./routes/history');
const leadsRoutes = require('./routes/leads');

const app = express();
const PORT = process.env.PORT || 3000;

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: process.env.SESSION_SECRET || 'adhello-secret-key',
  resave: false,
  saveUninitialized: false
}));
app.use(passport.initialize());
app.use(passport.session());

// Global middleware for templates
app.use((req, res, next) => {
  res.locals.user = req.user || null;
  next();
});

// Auth Routes
app.get('/auth/login', (req, res) => {
  res.render('login', { error: req.query.error });
});

app.get('/auth/google',
  passport.authenticate('google', { scope: ['profile', 'email'] })
);

app.get('/auth/google/callback', 
  passport.authenticate('google', { failureRedirect: '/auth/login?error=unauthorized' }),
  function(req, res) {
    res.redirect('/');
  }
);

app.get('/logout', (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    res.redirect('/auth/login');
  });
});

// Autopilot Heartbeat (Public but secret-protected for Google Cloud Scheduler)
app.get('/api/cron/heartbeat', async (req, res) => {
  const secret = req.headers['x-cron-secret'] || req.query.secret;
  const expectedSecret = process.env.CRON_SECRET || 'fallback-secret-for-setup-only';

  if (!secret || secret !== expectedSecret) {
    console.warn('[SECURITY] Unauthorized heartbeat attempt rejected.');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  console.log('[API-CRON] External heartbeat triggered. Checking for due jobs...');
  try {
    // We run it as a background task to avoid timing out the scheduler request
    // if there are many jobs to process.
    scheduler.runDueSchedules();
    res.json({ success: true, message: 'Heartbeat received, jobs processing in background.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Protected Routes
app.use('/', ensureAuthenticated, indexRoutes);
app.use('/search', ensureAuthenticated, searchRoutes);
app.use('/history', ensureAuthenticated, historyRoutes);
app.use('/leads', ensureAuthenticated, leadsRoutes);

// Firecrawl Enrichment Route
app.post('/enrich', async (req, res) => {
  try {
    const { url, title, city, state } = req.body;
    
    if (url && url !== 'N/A') {
      const data = await enrichLead(url);
      return res.json({ success: true, data });
    } else if (title && city) {
      console.log(`[ENRICH] No URL provided. Searching for ${title} in ${city}...`);
      const { searchBusiness } = require('./services/firecrawl');
      const searchQuery = `${title} business in ${city}${state ? ', ' + state : ''} official website contact`;
      const searchResults = await searchBusiness(searchQuery);
      
      if (searchResults && searchResults.length > 0) {
        const bestResult = searchResults.find(r => r.extract && (r.extract.email || r.extract.facebook || r.extract.instagram)) || searchResults[0];
        return res.json({ success: true, data: bestResult.extract || {}, foundUrl: bestResult.url });
      }
    }
    
    res.status(400).json({ success: false, error: 'Insufficient data for enrichment (need URL or Title+City).' });
  } catch (err) {
    console.error('Enrichment Server Error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).render('error', {
    message: err.message || 'Something went wrong',
    activePage: '',
  });
});

const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Allow long-running requests for Apify calls (10 minutes)
server.setTimeout(600000);

// Initialize Background Autopilot
scheduler.init();
