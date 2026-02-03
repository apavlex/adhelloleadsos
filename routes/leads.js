const express = require('express');
const router = express.Router();
const dbService = require('../services/database');

// GET /leads — show all saved leads
router.get('/', async (req, res, next) => {
  try {
    const leads = await dbService.getAllLeads();
    res.render('leads', {
      title: 'Saved Leads',
      activePage: 'leads',
      leads,
    });
  } catch (err) {
    next(err);
  }
});

// GET /leads/saved — return all saved lead titles+keys for client-side bookmark state
router.get('/saved', async (req, res, next) => {
  try {
    const leads = await dbService.getAllLeads();
    const saved = leads.map((l) => ({ key: l.key, title: l.title }));
    res.json(saved);
  } catch (err) {
    next(err);
  }
});

// POST /leads/save — bookmark a lead (called via fetch from client JS)
router.post('/save', async (req, res, next) => {
  try {
    const { title, phone, website, email, categoryName, address, city, state, totalScore, reviewsCount, url } = req.body;

    if (!title) {
      return res.status(400).json({ error: 'Lead title is required.' });
    }

    const leadData = {
      title,
      phone: phone || 'N/A',
      website: website || 'N/A',
      email: email || 'N/A',
      categoryName: categoryName || 'N/A',
      address: address || 'N/A',
      city: city || '',
      state: state || '',
      totalScore: parseFloat(totalScore) || 0,
      reviewsCount: parseInt(reviewsCount, 10) || 0,
      url: url || '',
      savedAt: new Date().toISOString(),
    };

    const key = await dbService.saveLead(leadData);
    res.json({ success: true, key });
  } catch (err) {
    next(err);
  }
});

// POST /leads/:key/delete — remove a saved lead
router.post('/:key/delete', async (req, res, next) => {
  try {
    const key = req.params.key;
    const fullKey = key.startsWith('lead:') ? key : `lead:${key}`;
    await dbService.deleteLead(fullKey);

    // If request is from fetch (JSON), return JSON; otherwise redirect
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      return res.json({ success: true });
    }
    res.redirect('/leads');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
