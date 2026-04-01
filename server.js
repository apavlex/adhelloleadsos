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

// Protected Routes
app.use('/', ensureAuthenticated, indexRoutes);
app.use('/search', ensureAuthenticated, searchRoutes);
app.use('/history', ensureAuthenticated, historyRoutes);
app.use('/leads', ensureAuthenticated, leadsRoutes);

// Firecrawl Enrichment Route
app.post('/enrich', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ error: 'URL is required for enrichment.' });
    }
    
    const data = await enrichLead(url);
    res.json({ success: true, data });
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
