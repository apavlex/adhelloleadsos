require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const session = require('express-session');
const {
  passport,
  ensureAuthenticated,
  isGoogleAuthConfigured,
  requireGoogleAuth,
  getPublicBaseUrl,
} = require('./services/auth');
const webEnrichment = require('./services/webEnrichment');
const mapsEnrichFallback = require('./services/mapsEnrichFallback');
const workspaceIntegrations = require('./services/workspaceIntegrations');
const scheduler = require('./services/scheduler');
const nightlyPrepService = require('./services/nightlyPrep');
const { migrateLegacyPipelineStages } = require('./services/pipelineMigration');
const { runGlobalPipelineSeedOnce } = require('./services/pipelineStagesService');
const { logStartupPersistenceStatus } = require('./services/dataPersistence');

const indexRoutes = require('./routes/index');
const searchRoutes = require('./routes/search');
const historyRoutes = require('./routes/history');
const leadsRoutes = require('./routes/leads');
const socialsRoutes = require('./routes/socials');
const apiRoutes = require('./routes/api');
const analyticsRoutes = require('./routes/analytics');
const salesRoutes = require('./routes/sales');
const coachRoutes = require('./routes/coach');
const sequencesRoutes = require('./routes/sequences');
const workspaceRoutes = require('./routes/workspace');
const workspacesRoutes = require('./routes/workspaces');
const activationRoutes = require('./routes/activation');
const tasksRoutes = require('./routes/tasks');
const activityRoutes = require('./routes/activity');
const resourcesRoutes = require('./routes/resources');
const assistantRoutes = require('./routes/assistant');
const outreachRoutes = require('./routes/outreach');
const prospectingRoutes = require('./routes/prospecting');
const newsletterRoutes = require('./routes/newsletter');
const socialPostsRoutes = require('./routes/socialPosts');
const directMailRoutes = require('./routes/directMail');
const foldersRoutes = require('./routes/folders');
const tagsRoutes = require('./routes/tags');
const ghlRoutes = require('./routes/ghl');
const attachWorkspace = require('./middleware/attachWorkspace');
const socialBrandIcons = require('./services/socialBrandIcons');
const iaNav = require('./middleware/iaNav');
const leadRunBanner = require('./middleware/leadRunBanner');
const iaRedirects = require('./routes/iaRedirects');
const todayRoutes = require('./routes/today');
const focusRoutes = require('./routes/focus');
const pipelineRoutes = require('./routes/pipeline');
const auditReportPublicRoutes = require('./routes/auditReportPublic');
const aiToolsReportPublicRoutes = require('./routes/aiToolsReportPublic');
const sharePhoneAnalyticsRoutes = require('./routes/sharePhoneAnalytics');
const dbService = require('./services/database');
const ceoRoutes = require('./routes/ceo');
const mcpRoutes = require('./routes/mcp');
const pavlexRoutes = require('./routes/pavlex');
const debugRoutes = require('./routes/debug');
const autonomousRoutes = require('./routes/autonomous');
const realEstateRoutes = require('./routes/realEstate');
const listingsSearchRoutes = require('./routes/listingsSearch');
const permitsRoutes = require('./routes/permits');
const businessFormationsRoutes = require('./routes/businessFormations');
const mobileHomesRoutes = require('./routes/mobileHomes');
const scrapeJobDisplay = require('./services/scrapeJobTypes');
const scheduleDisplay = require('./services/scheduleHelpers');

const app = express();
const { DEFAULT_SEQUENCE_TEMPLATES } = require('./services/sequenceTemplates');
try {
  app.locals.assetVersion = process.env.ASSET_VERSION || require('./package.json').version;
} catch (_) {
  app.locals.assetVersion = '1';
}
app.locals.scheduleDisplayTitle = scrapeJobDisplay.scheduleDisplayTitle;
app.locals.scheduleDisplaySubtitle = scrapeJobDisplay.scheduleDisplaySubtitle;
app.locals.JOB_TYPE_LABELS = scrapeJobDisplay.JOB_TYPE_LABELS;
app.locals.normalizeJobType = scrapeJobDisplay.normalizeJobType;
app.locals.scheduleFrequencyLabel = scheduleDisplay.scheduleFrequencyLabel;
const { safeJsonForScript } = require('./services/safeJson');
app.locals.safeJsonForScript = safeJsonForScript;
const {
  formatLeadSourceLabel,
  formatSourceChannelLabel,
  resolveLeadSourceChannel,
} = require('./services/sourceChannelLabels');
app.locals.formatLeadSourceLabel = formatLeadSourceLabel;
app.locals.formatSourceChannelLabel = formatSourceChannelLabel;
app.locals.resolveLeadSourceChannel = resolveLeadSourceChannel;
/** Outreach playbooks for lead sidebar + sequences page (id, steps, hints). */
app.locals.sequenceTemplates = DEFAULT_SEQUENCE_TEMPLATES.map((t) => ({
  id: t.id,
  persona: t.persona,
  name: t.name,
  description: t.description,
  stepCount: t.steps.length,
  steps: t.steps.map((s) => ({
    dayOffset: s.dayOffset,
    channel: s.channel,
    title: s.title,
    hint: s.hint || '',
  })),
}));
const PORT = process.env.PORT || 3000;

// Cloud Run / reverse proxy: required for secure cookies and req.protocol
app.set('trust proxy', 1);

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
// Root-relative EJS includes: `include('/partials/foo')` resolves under views/ from any nested partial (Replit-safe).
app.set('view options', { root: path.join(__dirname, 'views') });

const { wantsJsonResponse } = require('./lib/httpRequest');

// Middleware
app.use(cors());
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use((req, res, next) => {
  const largeBody =
    req.method === 'POST' &&
    (req.path === '/leads/google-drive/upload-csv' ||
      req.path === '/leads/ai-analysis/export-csv');
  express.json({ limit: largeBody ? '15mb' : '1mb' })(req, res, next);
});
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

app.locals.renderSocialBrandLinks = (links) => socialBrandIcons.renderLinks(links);

const { getQuickLogClientPayload, resolveActiveQuickLogFromLead } = require('./services/quickLogConfig');
const quickLogClientPayload = getQuickLogClientPayload();
app.locals.resolveActiveQuickLogFromLead = resolveActiveQuickLogFromLead;

// Global middleware for templates
app.use((req, res, next) => {
  res.locals.user = req.user || null;
  res.locals.hermesWebUiUrl = process.env.HERMES_WEBUI_URL || '';
  res.locals.ghlDashboardUrl = process.env.GHL_DASHBOARD_URL || '';
  res.locals.quickLogClient = quickLogClientPayload;
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
  res.render('login', {
    error: req.query.error,
    googleAuthConfigured: isGoogleAuthConfigured,
  });
});

app.get('/auth/google',
  requireGoogleAuth,
  passport.authenticate('google', { scope: ['profile', 'email'] })
);

app.get('/auth/google/callback',
  requireGoogleAuth,
  passport.authenticate('google', { failureRedirect: '/auth/login?error=unauthorized' }),
  function(req, res) {
    res.redirect('/today');
  }
);

/** OAuth with Drive read + file scope — import from Drive and export lists back to Drive. */
function driveOAuthCallbackUrl(req) {
  return `${getPublicBaseUrl(req)}/auth/google/drive/callback`;
}

app.get('/auth/google/drive-link', ensureAuthenticated, requireGoogleAuth, (req, res, next) => {
  const callbackURL = driveOAuthCallbackUrl(req);
  passport.authenticate('googleDrive', {
    scope: [
      'profile',
      'email',
      'https://www.googleapis.com/auth/drive.readonly',
      'https://www.googleapis.com/auth/drive.file',
    ],
    accessType: 'offline',
    prompt: 'consent',
    callbackURL,
  })(req, res, next);
});

app.get(
  '/auth/google/drive/callback',
  requireGoogleAuth,
  (req, res, next) => {
    passport.authenticate('googleDrive', {
      failureRedirect: '/prospecting?tab=pipeline&driveError=oauth',
      callbackURL: driveOAuthCallbackUrl(req),
    })(req, res, next);
  },
  function (req, res) {
    res.redirect('/prospecting?tab=pipeline&driveConnected=1');
  }
);

app.get('/logout', (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    res.redirect('/auth/login');
  });
});

// Scheduled scrape heartbeat (Public but secret-protected for Google Cloud Scheduler)
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

/** Render cron / external scheduler: overnight Maps prep for workspaces with nightly prep enabled */
app.get('/api/cron/nightly-prep', async (req, res) => {
  const secret = req.headers['x-cron-secret'] || req.query.secret;
  const expectedSecret = process.env.CRON_SECRET || 'fallback-secret-for-setup-only';

  if (!secret || secret !== expectedSecret) {
    console.warn('[SECURITY] Unauthorized nightly-prep cron rejected.');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { ids, skipEnabledCheck } = await nightlyPrepService.getCronNightlyPrepTargets();
    if (!ids.length) {
      return res.json({
        success: true,
        message: 'No workspaces to process (enable nightly prep on Find leads or set NIGHTLY_PREP_WORKSPACE_IDS).',
        workspaces: [],
      });
    }

    setImmediate(() => {
      (async () => {
        for (const wid of ids) {
          try {
            await nightlyPrepService.runNightlyPrep(wid, { skipEnabledCheck });
          } catch (e) {
            console.error('[API-CRON] nightly-prep failed for', wid, e && e.message);
          }
        }
      })().catch((e) => console.error('[API-CRON] nightly-prep runner:', e));
    });

    res.json({
      success: true,
      message: 'Nightly prep queued (runs in background).',
      workspaces: ids,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Public API Routes (Security handled within router)
app.use('/api', apiRoutes);

// Scout ingest endpoint (bypasses session auth, API key only)
app.post('/api/scout/ingest', express.json(), async (req, res) => {
  const apiKey = req.headers['x-api-key'] || req.query.api_key;
  const expectedKey = process.env.API_INGEST_KEY || 'adhello_secret_123';
  console.log('[SCOUT] API key received:', !!apiKey, 'expected:', !!expectedKey);
  if (!apiKey || apiKey !== expectedKey) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  try {
    const { title, phone, city, state, source, industry, message } = req.body;
    console.log('[SCOUT] Ingesting:', title, city, state);
    if (!title) return res.status(400).json({ error: 'title required' });
    const leadData = {
      title, phone: phone || 'N/A', website: 'N/A', email: 'N/A',
      city: city || '', state: state || '', source: source || 'scout',
      pipelineStage: 0, industry: industry || '',
      message: message || `Scouted via ${source}`,
      workspaceId: 'default',
      ip: (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim(),
    };
    console.log('[SCOUT] Calling saveLead...');
    const leadKey = await dbService.saveLead(leadData);
    console.log('[SCOUT] Saved:', leadKey);
    res.json({ success: true, key: leadKey, next_channel: leadData.next_channel || 'cold_call' });
  } catch (err) {
    console.error('[SCOUT] Error:', err.message, err.stack);
    res.status(500).json({ error: err.message });
  }
});

// Public enrichment (must stay before auth stack)
app.post('/enrich', async (req, res) => {
  try {
    const { url, title, city, state } = req.body;
    const wid = String(req.body.workspaceId || req.query.workspaceId || 'default').trim() || 'default';
    const integrationEnv = await workspaceIntegrations.getResolvedIntegrationEnv(wid);

    if (url && url !== 'N/A') {
      const pack = await webEnrichment.enrichLeadSmartWithMapsFallback(
        url,
        { title, city, state },
        { integrationEnv }
      );
      return res.json({
        success: true,
        data: pack.merged,
        mapsFallback: pack.mapsUsed,
        foundUrl: pack.websiteHint || undefined,
      });
    } else if (title && city) {
      console.log(`[ENRICH] No URL provided. Searching for ${title} in ${city}...`);
      const { searchBusiness } = require('./services/firecrawl');
      const searchQuery = `${title} business in ${city}${state ? ', ' + state : ''} official website contact`;
      let data = {};
      let foundUrl = null;
      try {
        const searchResults = await searchBusiness(searchQuery, integrationEnv);
        if (searchResults && searchResults.length > 0) {
          const bestResult =
            searchResults.find((r) => r.extract && (r.extract.email || r.extract.facebook || r.extract.instagram)) ||
            searchResults[0];
          data = bestResult.extract || {};
          foundUrl = bestResult.url || null;
        }
      } catch (e) {
        console.warn('[ENRICH] Firecrawl search failed:', e.message);
      }
      if (!mapsEnrichFallback.extractHasContactSignal(data)) {
        const pack = await mapsEnrichFallback.enrichFromMapsForLead({ title, city, state }, integrationEnv);
        if (pack) {
          data = mapsEnrichFallback.mergeExtractPreferFirecrawl(data, pack.extract);
          if (!foundUrl && pack.websiteHint) foundUrl = pack.websiteHint;
        }
      }
      return res.json({ success: true, data, foundUrl: foundUrl || undefined });
    }

    res.status(400).json({ success: false, error: 'Insufficient data for enrichment (need URL or Title+City).' });
  } catch (err) {
    console.error('Enrichment Server Error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Public hosted website audit (signed token; no session — share on cold calls)
app.use('/', sharePhoneAnalyticsRoutes);
app.use('/', auditReportPublicRoutes);
app.use('/', aiToolsReportPublicRoutes);

// Autonomous prospecting API (API key auth, no session required)
app.use('/autonomous', autonomousRoutes);

// GBP Audit Generator (public API + page, no session required)
const auditRoutes = require('./routes/audit');
app.use('/api/audit', auditRoutes);
app.get('/audit', (req, res) => {
  const apiKey = req.query.api_key || process.env.API_INGEST_KEY || '';
  res.render('audit', { title: 'GBP Audit | Agency OS', activePage: 'audit', apiKey });
});

// Prospecting Enrichment API (buying signals, outreach, demos)
const prospectingApiRoutes = require('./routes/prospectingApi');
app.use('/api/prospecting', prospectingApiRoutes);

// Prospect Research API + page
const researchRoutes = require('./routes/research');
app.use('/api/research', researchRoutes);
app.get('/research', (req, res) => {
  const apiKey = req.query.api_key || process.env.API_INGEST_KEY || '';
  res.render('research', { title: 'Prospect Research | Agency OS', activePage: 'research', apiKey });
});

// Demo page renderer
app.get('/demo/:type', (req, res) => {
  const demoType = req.params.type;
  const business = {
    title: req.query.business || 'Your Business',
    categoryName: req.query.category || 'Home Service',
    city: req.query.city || '',
    state: req.query.state || '',
    phone: req.query.phone || '',
    website: req.query.website || '',
  };
  const demo = demoGenerator.generateDemo(business, demoType);
  res.render('demo', { title: `${demo.title} | AdHello`, demo });
});

// Course landing page (public, no auth required)
app.use('/course', express.static(path.join(__dirname, 'public', 'course')));

// Course email capture (public API)
app.post('/api/course/capture', express.json(), async (req, res) => {
  try {
    const { email, name, source } = req.body;
    if (!email || !email.includes('@')) {
      return res.status(400).json({ success: false, error: 'Valid email required' });
    }
    const captureData = {
      email: email.trim().toLowerCase(),
      name: (name || '').trim(),
      source: source || 'course_landing_page',
      captured_at: new Date().toISOString(),
      ip: (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim(),
    };
    // Store in a simple JSON file (no DB dependency for this)
    const fs = require('fs');
    const captureFile = path.join(__dirname, 'data', 'course-captures.json');
    let captures = [];
    try {
      if (fs.existsSync(captureFile)) {
        captures = JSON.parse(fs.readFileSync(captureFile, 'utf8'));
      }
    } catch (e) { captures = []; }
    // Deduplicate
    if (!captures.find(c => c.email === captureData.email)) {
      captures.push(captureData);
      fs.mkdirSync(path.dirname(captureFile), { recursive: true });
      fs.writeFileSync(captureFile, JSON.stringify(captures, null, 2));
    }
    res.json({ success: true, message: 'Captured' });
  } catch (err) {
    console.error('[COURSE CAPTURE] Error:', err.message);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// Public API endpoint — auto-import real estate listings (called by scraper cron)
app.get('/api/leads/import-real-estate', async (req, res) => {
  // Redirect to docs
  res.json({ usage: 'POST JSON array of listings to this endpoint' });
});

app.post('/api/leads/import-real-estate', express.json({ limit: '5mb' }), async (req, res) => {
  try {
    const listings = req.body;
    if (!Array.isArray(listings) || listings.length === 0) {
      return res.json({ success: false, error: 'POST a JSON array of listings.' });
    }
    const dbService = require('./services/database');
    const wid = process.env.DEFAULT_WORKSPACE_ID || 'default';
    
    let created = 0, skipped = 0;
    for (const item of listings) {
      if (item._imported) { skipped++; continue; }
      const sourceLabel = item.source === 'facebook' ? 'FB' : item.source === 'craigslist' ? 'CL' : (item.source || '??');
      const title = `${sourceLabel}: ${item.title || 'Mobile Home Listing'}`;
      const location = (item.location || '').trim();
      const cityState = location.split(',').map(s => s.trim());
      const leadData = {
        title, phone: 'N/A', website: item.url || 'N/A', email: 'N/A',
        categoryName: 'Real Estate - Mobile Home', address: location || 'N/A',
        city: cityState[0] || '', state: cityState[1] || '',
        totalScore: 0, reviewsCount: 0, url: item.url || '',
        status: 'Lead Captured',
        source: item.source === 'facebook' ? 'facebook marketplace' : 'craigslist',
        jobType: 'real_estate',
        sourceType: 'real_estate',
        folderKey: 'real-estate', workspaceId: wid, pipelineStage: 1,
        updates: [{ type: 'note', value: `Price: ${item.price_str || '$?'}\nBeds: ${item.beds || '?'} | Baths: ${item.baths || '?'}\n${item.cross_listed ? 'Cross-listed (CL + FB)' : ''}\nScraped: ${item.date || 'unknown'}`, timestamp: new Date().toISOString() }],
      };
      try {
        const key = await dbService.saveLead(leadData);
        if (key) { created++; }
        else { skipped++; }
      } catch (e) { console.error('[import-real-estate]', e.message); skipped++; }
    }
    res.json({ success: true, created, skipped, total: listings.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// MCP server — authenticated via session or Bearer token (must be reachable by OpenAI)
app.use('/ceo/mcp', mcpRoutes);

// Protected routes (IA Phase 1: iaNav + canonical redirects + /today)
app.use(ensureAuthenticated);
app.use(attachWorkspace);
app.use(iaNav);
app.use(leadRunBanner);
app.use(iaRedirects);
app.use('/today', todayRoutes);
app.use('/focus', focusRoutes);
app.use('/', indexRoutes);
app.use('/search', searchRoutes);
app.use('/permits', permitsRoutes);
app.use('/formations', businessFormationsRoutes);
app.use('/real-estate/search', realEstateRoutes);
app.use('/listings/search', listingsSearchRoutes);
app.use('/mobile-homes/search', mobileHomesRoutes);
app.use('/history', historyRoutes);
app.use('/leads', leadsRoutes);
app.use('/api/socials', socialsRoutes);
app.use('/folders', foldersRoutes);
app.use('/tags', tagsRoutes);
app.use('/ghl', ghlRoutes);
app.use('/prospecting', prospectingRoutes);
app.use('/outreach', outreachRoutes);
app.use('/reports', analyticsRoutes);
app.use('/sales', salesRoutes);
app.use('/coach', coachRoutes);
app.use('/sequences', sequencesRoutes);
app.use('/workspace', workspaceRoutes);
app.use('/workspaces', workspacesRoutes);
app.use('/pipeline', pipelineRoutes);
app.use('/activation', activationRoutes);
app.use('/tasks', tasksRoutes);
app.use('/activity', activityRoutes);
app.use('/resources', resourcesRoutes);
const prospectingOutreachRoutes = require('./routes/prospectingOutreach');
app.use('/api/prospecting', prospectingOutreachRoutes);
app.use('/api/pavlex', pavlexRoutes);
app.use('/api/debug', debugRoutes);
app.use('/api/assistant', assistantRoutes);
app.use('/ceo', ceoRoutes);
app.use('/newsletter', newsletterRoutes);
app.use('/social-posts', socialPostsRoutes);
app.use('/direct-mail', directMailRoutes);

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  const status = err.status || err.statusCode || 500;
  if (wantsJsonResponse(req)) {
    const msg =
      status === 413
        ? 'Request too large. Try exporting fewer leads or use Download CSV.'
        : err.message || 'Something went wrong';
    return res.status(status).json({ success: false, error: msg });
  }
  res.status(status >= 400 && status < 600 ? status : 500).render('error', {
    message: err.message || 'Something went wrong',
    activePage: '',
  });
});

function startServer() {
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on 0.0.0.0:${PORT}`);
  });
  server.setTimeout(600000);
  scheduler.init();
  return server;
}

async function runStartupTasks() {
  logStartupPersistenceStatus();
  await migrateLegacyPipelineStages();
  runGlobalPipelineSeedOnce();
}

function boot() {
  startServer();
  runStartupTasks().catch((err) => {
    console.error('[BOOT] Startup task failed:', err);
  });
}

boot();
