const express = require('express');
const multer = require('multer');
const router = express.Router();
const dbService = require('../services/database');
const firecrawl = require('../services/firecrawl');
const { parseCsvToLeadRecords } = require('../services/csvLeadImport');
const { PIPELINE_STAGES } = require('../services/salesConstants');
const { getLeadsCoachPayload } = require('../services/opportunityScore');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const name = (file.originalname || '').toLowerCase();
    const ok =
      name.endsWith('.csv') ||
      file.mimetype === 'text/csv' ||
      file.mimetype === 'application/csv' ||
      file.mimetype === 'application/vnd.ms-excel';
    if (ok) cb(null, true);
    else cb(new Error('Upload a .csv file only.'));
  },
});

// GET /leads — show all saved leads (excluding inbound AdHello leads)
router.get('/', async (req, res, next) => {
  try {
    const allLeads = await dbService.getAllLeads();
    // Exclude leads from adhello sources as they go to the inbound tab
    const leads = allLeads.filter(l => !l.source || !l.source.startsWith('adhello_'));
    
    let importNotice = null;
    if (['imported', 'skipped', 'failed'].some((k) => req.query[k] != null && req.query[k] !== '')) {
      importNotice = {
        imported: Math.max(0, parseInt(req.query.imported, 10) || 0),
        skipped: Math.max(0, parseInt(req.query.skipped, 10) || 0),
        failed: Math.max(0, parseInt(req.query.failed, 10) || 0),
      };
    }

    const importError = typeof req.query.importError === 'string' && req.query.importError.trim()
      ? req.query.importError.trim()
      : null;

    const flowCoach = getLeadsCoachPayload(leads);

    res.render('leads', {
      title: 'Saved Leads',
      activePage: 'leads',
      leads,
      importNotice,
      importError,
      pipelineStages: PIPELINE_STAGES,
      flowCoach,
    });
  } catch (err) {
    next(err);
  }
});

// GET /leads/inbound — show leads from adhello.ai
router.get('/inbound', async (req, res, next) => {
  try {
    const allLeads = await dbService.getAllLeads();
    const leads = allLeads.filter(l => l.source && l.source.startsWith('adhello_'));
    res.render('inbound', {
      title: 'Inbound Leads',
      activePage: 'inbound',
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
      status: 'Needs Video', // Default pipeline stage
      loomUrl: '',
      savedAt: new Date().toISOString(),
    };

    const key = await dbService.saveLead(leadData);
    res.json({ success: true, key });
  } catch (err) {
    next(err);
  }
});

// POST /leads/import — bulk import from CSV (Agency OS / enrichment export shape)
router.post('/import', (req, res, next) => {
  upload.single('csvfile')(req, res, (err) => {
    if (err) {
      const wantsJson = req.get('accept') && req.get('accept').includes('application/json');
      const msg = err instanceof multer.MulterError ? err.message : err.message || 'Upload failed';
      if (wantsJson) {
        return res.status(400).json({ success: false, error: msg });
      }
      return res.redirect(`/leads?importError=${encodeURIComponent(msg)}`);
    }
    next();
  });
}, async (req, res, next) => {
  try {
    if (!req.file || !req.file.buffer) {
      if (req.headers.accept && req.headers.accept.includes('application/json')) {
        return res.status(400).json({ success: false, error: 'No CSV file received (field name: csvfile).' });
      }
      return res.redirect('/leads?imported=0&skipped=0&failed=0');
    }

    const records = parseCsvToLeadRecords(req.file.buffer, req.file.originalname || 'import.csv');
    let imported = 0;
    let skipped = 0;
    let failed = 0;

    for (const rec of records) {
      if (!rec.title) {
        skipped += 1;
        continue;
      }
      try {
        await dbService.saveLead(rec);
        imported += 1;
      } catch (e) {
        console.error('[CSV import] row error:', rec.title, e.message);
        failed += 1;
      }
    }

    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      return res.json({ success: true, imported, skipped, failed, totalRows: records.length });
    }
    res.redirect(`/leads?imported=${imported}&skipped=${skipped}&failed=${failed}`);
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

// POST /leads/:key/enhance — manual Firecrawl enrichment for a single lead
router.post('/:key/enhance', async (req, res, next) => {
  try {
    const key = req.params.key;
    const fullKey = key.startsWith('lead:') ? key : `lead:${key}`;
    const lead = await dbService.getLead(fullKey);

    let deepData = null;
    
    if (lead.website && lead.website !== 'N/A') {
      console.log(`[ENHANCE] Triggering Firecrawl scrape for ${lead.title} (${lead.website})...`);
      deepData = await firecrawl.enrichLead(lead.website);
    } else {
      console.log(`[ENHANCE] Website missing. Triggering Firecrawl search for ${lead.title}...`);
      const searchQuery = `${lead.title} business in ${lead.city}${lead.state ? ', ' + lead.state : ''} official website contact`;
      const searchResults = await firecrawl.searchBusiness(searchQuery);
      
      if (searchResults && searchResults.length > 0) {
        // Find the result with the most data or just the first successful extraction
        const bestResult = searchResults.find(r => r.extract && (r.extract.email || r.extract.facebook || r.extract.instagram)) || searchResults[0];
        deepData = bestResult.extract || {};
        
        // If we found a website in the search but didn't have one, save it
        if (!lead.website || lead.website === 'N/A') {
           const foundUrl = searchResults.find(r => r.url)?.url;
           if (foundUrl) {
              await dbService.updateLead(fullKey, { website: foundUrl });
           }
        }
      }
    }
    
    if (deepData && Object.keys(deepData).length > 0) {
      const updates = lead.updates || [];
      const updateData = { updates };

      if ((!lead.email || lead.email === 'N/A') && deepData.email) updateData.email = deepData.email;
      if ((!lead.facebook || lead.facebook === 'N/A') && deepData.facebook) updateData.facebook = deepData.facebook;
      if ((!lead.instagram || lead.instagram === 'N/A') && deepData.instagram) updateData.instagram = deepData.instagram;
      if ((!lead.twitter || lead.twitter === 'N/A') && deepData.twitter) updateData.twitter = deepData.twitter;
      if (!lead.linkedin && deepData.linkedin) updateData.linkedin = deepData.linkedin;

      updates.push({
        type: 'enrichment',
        value: `Deep hunt completed${(!lead.website || lead.website === 'N/A') ? ' via web search' : ''}.`,
        timestamp: new Date().toISOString()
      });

      const updatedLead = await dbService.updateLead(fullKey, updateData);
      return res.json({ success: true, lead: updatedLead });
    }

    res.json({ success: false, error: 'No new contact data discovered yet.' });
  } catch (err) {
    console.error('Manual enhancement error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
