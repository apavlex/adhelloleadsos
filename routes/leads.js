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
    const { title, phone, website, email, categoryName, address, city, state, totalScore, reviewsCount, url, facebook, instagram, twitter } = req.body;

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
      facebook: facebook || 'N/A',
      instagram: instagram || 'N/A',
      twitter: twitter || 'N/A',
      savedAt: new Date().toISOString(),
    };

    const key = await dbService.saveLead(leadData);
    res.json({ success: true, key });
  } catch (err) {
    next(err);
  }
});

// POST /leads/:key/update — update lead metadata (status, etc.)
router.post('/:key/update', async (req, res, next) => {
  try {
    const key = req.params.key;
    const fullKey = key.startsWith('lead:') ? key : `lead:${key}`;
    const updateData = req.body;
    
    // Add to activity log if status changed
    if (updateData.status) {
      const lead = await dbService.getLead(fullKey);
      const updates = lead.updates || [];
      updates.push({
        type: 'status_change',
        value: updateData.status,
        timestamp: new Date().toISOString()
      });
      updateData.updates = updates;
    }

    const updated = await dbService.updateLead(fullKey, updateData);
    res.json({ success: true, lead: updated });
  } catch (err) {
    next(err);
  }
});

// POST /leads/:key/notes — add a note to a lead
router.post('/:key/notes', async (req, res, next) => {
  try {
    const key = req.params.key;
    const fullKey = key.startsWith('lead:') ? key : `lead:${key}`;
    const { content } = req.body;
    
    const lead = await dbService.getLead(fullKey);
    const updates = lead.updates || [];
    updates.push({
      type: 'note',
      value: content,
      timestamp: new Date().toISOString()
    });

    await dbService.updateLead(fullKey, { updates });
    res.json({ success: true, updates });
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

// POST /leads/:key/generate-prompt — generate personalized outreach
router.post('/:key/generate-prompt', async (req, res, next) => {
  try {
    const key = req.params.key;
    const fullKey = key.startsWith('lead:') ? key : `lead:${key}`;
    const lead = await dbService.getLead(fullKey);

    const prompt = `Hi ${lead.title},\n\nI noticed your business in ${lead.city} has a great ${lead.totalScore} rating with ${lead.reviewsCount} reviews! I'm reaching out because we help ${lead.categoryName} businesses like yours grow their online presence.\n\nWould you be open to a quick chat about how we could help you get even more leads?\n\nBest,\n[Your Name]`;

    await dbService.updateLead(fullKey, { outreachPrompt: prompt });
    res.json({ success: true, prompt });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
