const express = require('express');
const multer = require('multer');
const router = express.Router();
const dbService = require('../services/database');
const firecrawl = require('../services/firecrawl');
const { firecrawlExtractToLeadUpdates } = require('../services/enrichmentNormalize');
const { parseCsvToLeadRecords } = require('../services/csvLeadImport');
const { PIPELINE_STAGES } = require('../services/salesConstants');
const { getLeadsCoachPayload, scoreLeadRecord } = require('../services/opportunityScore');
const { chatCompletion } = require('../services/llmClient');
const { filterLeadsForRequest, userEmail } = require('../services/workspaceService');
const activationService = require('../services/activationService');
const sequenceEngine = require('../services/sequenceEngine');
const workspaceService = require('../services/workspaceService');

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

// GET /leads — unified pipeline (cold + inbound); ?source=inbound | cold | all
router.get('/', async (req, res, next) => {
  try {
    const allLeads = await dbService.getAllLeads();
    const visible = filterLeadsForRequest(req, allLeads);
    const sourceFilter = String(req.query.source || 'all').toLowerCase();
    let leads = visible;
    if (sourceFilter === 'inbound') {
      leads = visible.filter((l) => l.source && l.source.startsWith('adhello_'));
    } else if (sourceFilter === 'cold') {
      leads = visible.filter((l) => !l.source || !l.source.startsWith('adhello_'));
    }

    const leadSourceCounts = {
      all: visible.length,
      cold: visible.filter((l) => !l.source || !l.source.startsWith('adhello_')).length,
      inbound: visible.filter((l) => l.source && l.source.startsWith('adhello_')).length,
    };

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
      activePage: sourceFilter === 'inbound' ? 'inbound' : 'leads',
      leads,
      sourceFilter,
      leadSourceCounts,
      importNotice,
      importError,
      pipelineStages: PIPELINE_STAGES,
      flowCoach,
      canManageWorkspace: req.canManageWorkspace,
    });
  } catch (err) {
    next(err);
  }
});

// Legacy URL — warm leads now live on the main board with ?source=inbound
router.get('/inbound', (req, res) => {
  res.redirect(302, '/leads?source=inbound');
});

// GET /leads/saved — return all saved lead titles+keys for client-side bookmark state
router.get('/saved', async (req, res, next) => {
  try {
    const leads = filterLeadsForRequest(req, await dbService.getAllLeads());
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
      workspaceId: req.workspaceId || 'default',
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
        await dbService.saveLead({
          ...rec,
          workspaceId: req.workspaceId || 'default',
        });
        imported += 1;
      } catch (e) {
        console.error('[CSV import] row error:', rec.title, e.message);
        failed += 1;
      }
    }

    if (imported > 0) {
      await activationService.recordEvent(userEmail(req), 'csv_import');
    }

    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      return res.json({ success: true, imported, skipped, failed, totalRows: records.length });
    }
    res.redirect(`/leads?imported=${imported}&skipped=${skipped}&failed=${failed}`);
  } catch (err) {
    next(err);
  }
});

function leadKeyFromParam(key) {
  return key.startsWith('lead:') ? key : `lead:${key}`;
}

// POST /leads/:key/sequence/start — attach persona cadence (Clay / Paul / Bob templates)
router.post('/:key/sequence/start', async (req, res, next) => {
  try {
    const fullKey = leadKeyFromParam(req.params.key);
    const templateId = (req.body && req.body.templateId) || 'clay_standard';
    await sequenceEngine.startSequence(fullKey, templateId);
    await activationService.recordEvent(userEmail(req), 'sequence_started');
    res.json({ success: true, templateId });
  } catch (err) {
    next(err);
  }
});

// POST /leads/:key/sequence/pause
router.post('/:key/sequence/pause', async (req, res, next) => {
  try {
    const fullKey = leadKeyFromParam(req.params.key);
    await sequenceEngine.pauseSequence(fullKey);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// POST /leads/:key/assign — owner/admin only
router.post('/:key/assign', async (req, res, next) => {
  try {
    if (!req.canManageWorkspace) {
      return res.status(403).json({ success: false, error: 'Team admin required' });
    }
    const fullKey = leadKeyFromParam(req.params.key);
    const assignee =
      (req.body && (req.body.assigneeEmail || req.body.email || '').trim().toLowerCase()) || '';
    if (!assignee) return res.status(400).json({ success: false, error: 'assigneeEmail required' });
    await dbService.updateLead(fullKey, {
      assignedTo: assignee,
      logs: [
        {
          type: 'assignment',
          message: `Assigned to ${assignee}`,
          timestamp: new Date().toISOString(),
        },
      ],
    });
    res.json({ success: true, assignedTo: assignee });
  } catch (err) {
    next(err);
  }
});

// POST /leads/:key/assign-round-robin — owner/admin only
router.post('/:key/assign-round-robin', async (req, res, next) => {
  try {
    if (!req.canManageWorkspace) {
      return res.status(403).json({ success: false, error: 'Team admin required' });
    }
    const fullKey = leadKeyFromParam(req.params.key);
    const assignee = await workspaceService.pickRoundRobinAssignee(req.workspaceId || 'default');
    if (!assignee) return res.status(400).json({ success: false, error: 'No assignees in pool' });
    await dbService.updateLead(fullKey, {
      assignedTo: assignee,
      logs: [
        {
          type: 'assignment',
          message: `Round-robin assigned to ${assignee}`,
          timestamp: new Date().toISOString(),
        },
      ],
    });
    res.json({ success: true, assignedTo: assignee });
  } catch (err) {
    next(err);
  }
});

// POST /leads/:key/update — update lead metadata (status, etc.)
router.post('/:key/update', async (req, res, next) => {
  try {
    const key = req.params.key;
    const fullKey = leadKeyFromParam(key);
    const updateData = req.body;
    const existing = await dbService.getLead(fullKey);

    if (
      existing &&
      updateData.pipelineStage !== undefined &&
      updateData.pipelineStage !== null
    ) {
      const prev = parseInt(existing.pipelineStage, 10) || 1;
      const next = parseInt(updateData.pipelineStage, 10);
      if (!Number.isNaN(next) && next >= 2 && next !== prev) {
        await activationService.recordEvent(userEmail(req), 'pipeline_advanced');
      }
    }

    // Add to activity log if status changed
    if (updateData.status && existing) {
      const lead = existing;
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

// POST /leads/:key/generate-prompt — personalized outreach (KIE.ai preferred, then OpenAI, else template)
router.post('/:key/generate-prompt', async (req, res, next) => {
  try {
    const key = req.params.key;
    const fullKey = key.startsWith('lead:') ? key : `lead:${key}`;
    const lead = await dbService.getLead(fullKey);

    const scored = scoreLeadRecord(lead);
    const summary = {
      title: lead.title,
      city: lead.city,
      state: lead.state,
      niche: lead.categoryName,
      rating: lead.totalScore,
      reviews: lead.reviewsCount,
      website: lead.website,
      source: lead.source,
      pipelineStage: lead.pipelineStage,
      cmsPlatform: lead.cmsPlatform,
      gapTier: scored.tier,
      gapReasons: scored.reasons,
    };

    let prompt = '';
    let llm = 'template';

    const ai = await chatCompletion({
      messages: [
        {
          role: 'system',
          content:
            'You write credible B2B agency / SaaS outreach emails. Do not invent metrics or claims not in context. Plain text only (no subject line). Under 170 words. Sign off as [Your Name].',
        },
        {
          role: 'user',
          content: `Write a first-touch email that references 1–2 concrete signals from the JSON (gaps, niche, location, warm vs cold source). Offer a low-friction next step (15-minute call).\n\n${JSON.stringify(summary, null, 2)}`,
        },
      ],
      jsonObject: false,
      max_tokens: 520,
      temperature: 0.55,
    });

    if (ai.content && !ai.error) {
      prompt = ai.content.trim();
      llm = ai.provider || 'template';
    } else {
      prompt = `Hi ${lead.title},\n\nI noticed your business in ${lead.city} has a ${lead.totalScore} rating with ${lead.reviewsCount} reviews. We help ${lead.categoryName} operators like you turn visibility into booked calls.\n\nOpen to a 15-minute fit call next week?\n\nBest,\n[Your Name]`;
    }

    await dbService.updateLead(fullKey, { outreachPrompt: prompt });
    res.json({ success: true, prompt, llm });
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
      const enrichUpdates = firecrawlExtractToLeadUpdates(deepData);
      const updateData = { ...enrichUpdates, updates };

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
