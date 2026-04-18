require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const session = require('express-session');
const { passport, ensureAuthenticated } = require('./services/auth');
const { enrichLead } = require('./services/firecrawl');
const scheduler = require('./services/scheduler');
const { migrateLegacyPipelineStages } = require('./services/pipelineMigration');

const indexRoutes = require('./routes/index');
const searchRoutes = require('./routes/search');
const historyRoutes = require('./routes/history');
const leadsRoutes = require('./routes/leads');
const apiRoutes = require('./routes/api');
const analyticsRoutes = require('./routes/analytics');
const salesRoutes = require('./routes/sales');
const coachRoutes = require('./routes/coach');
const sequencesRoutes = require('./routes/sequences');
const workspaceRoutes = require('./routes/workspace');
const activationRoutes = require('./routes/activation');
const outreachRoutes = require('./routes/outreach');
const foldersRoutes = require('./routes/folders');
const attachWorkspace = require('./middleware/attachWorkspace');
const iaNav = require('./middleware/iaNav');
const iaRedirects = require('./routes/iaRedirects');
const todayRoutes = require('./routes/today');

const app = express();
const PORT = process.env.PORT || 3000;

// Cloud Run / reverse proxy: required for secure cookies and req.protocol
app.set('trust proxy', 1);

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware
app.use(cors());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: process.env.SESSION_SECRET || 'adhello-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  },
}));
app.use(passport.initialize());
app.use(passport.session());

// Global middleware for templates
app.use((req, res, next) => {
  res.locals.user = req.user || null;
  next();
});

app.get('/health', (req, res) => {
  res.status(200).json({
    ok: true,
    service: process.env.K_SERVICE || 'adhelloleadsos',
  });
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
    res.redirect('/today');
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

// Public API Routes (Security handled within router)
app.use('/api', apiRoutes);

// Public enrichment (must stay before auth stack)
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

// Protected routes (IA Phase 1: iaNav + canonical redirects + /today)
app.use(ensureAuthenticated);
app.use(attachWorkspace);
app.use(iaNav);
app.use(iaRedirects);
app.use('/today', todayRoutes);
app.use('/', indexRoutes);
app.use('/search', searchRoutes);
app.use('/history', historyRoutes);
app.use('/leads', leadsRoutes);
app.use('/folders', foldersRoutes);
app.use('/outreach', outreachRoutes);
app.use('/analytics', analyticsRoutes);
app.use('/sales', salesRoutes);
app.use('/coach', coachRoutes);
app.use('/sequences', sequencesRoutes);
app.use('/workspace', workspaceRoutes);
app.use('/activation', activationRoutes);

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).render('error', {
    message: err.message || 'Something went wrong',
    activePage: '',
  });
});

async function boot() {
  await migrateLegacyPipelineStages();

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on 0.0.0.0:${PORT}`);
  });

  server.setTimeout(600000);
  scheduler.init();
}

boot().catch((err) => {
  console.error('[BOOT] Fatal:', err);
  process.exit(1);
});
