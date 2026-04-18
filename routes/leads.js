const express = require('express');
const multer = require('multer');
const router = express.Router();
const dbService = require('../services/database');
const firecrawl = require('../services/firecrawl');
const { firecrawlExtractToLeadUpdates } = require('../services/enrichmentNormalize');
const { parseCsvToLeadRecords } = require('../services/csvLeadImport');
const { PIPELINE_STAGES, SCRIPT_LIBRARY, SCRIPT_LIBRARY_KEYS } = require('../services/salesConstants');
const { scoreLeadRecord } = require('../services/opportunityScore');
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
    if (
      ['imported', 'skipped', 'failed', 'rows', 'created', 'updated'].some(
        (k) => req.query[k] != null && req.query[k] !== ''
      )
    ) {
      const rowsQ = parseInt(req.query.rows, 10);
      const createdQ = parseInt(req.query.created, 10);
      const updatedQ = parseInt(req.query.updated, 10);
      importNotice = {
        imported: Math.max(0, parseInt(req.query.imported, 10) || 0),
        skipped: Math.max(0, parseInt(req.query.skipped, 10) || 0),
        failed: Math.max(0, parseInt(req.query.failed, 10) || 0),
        rows: Number.isNaN(rowsQ) ? null : rowsQ,
        created: Number.isNaN(createdQ) ? null : createdQ,
        updated: Number.isNaN(updatedQ) ? null : updatedQ,
      };
    }

    const importError = typeof req.query.importError === 'string' && req.query.importError.trim()
      ? req.query.importError.trim()
      : null;

    res.render('leads', {
      title: 'Saved Leads',
      activePage: sourceFilter === 'inbound' ? 'inbound' : 'leads',
      leads,
      sourceFilter,
      leadSourceCounts,
      importNotice,
      importError,
      pipelineStages: PIPELINE_STAGES,
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
    const {
      title,
      phone,
      website,
      email,
      categoryName,
      address,
      city,
      state,
      totalScore,
      reviewsCount,
      url,
      facebook,
      instagram,
      twitter,
      note,
      source,
    } = req.body;

    if (!title) {
      return res.status(400).json({ error: 'Lead title is required.' });
    }

    const isManual =
      source === 'manual' || source === 'manual_offline' || String(source || '').startsWith('manual');

    const leadData = {
      title,
      phone: phone || 'N/A',
      website: website || 'N/A',
      email: email || 'N/A',
      categoryName:
        categoryName && String(categoryName).trim()
          ? categoryName
          : isManual
            ? 'Offline / word of mouth'
            : 'N/A',
      address: address || 'N/A',
      city: city || '',
      state: state || '',
      totalScore: parseFloat(totalScore) || 0,
      reviewsCount: parseInt(reviewsCount, 10) || 0,
      url: url || '',
      facebook: facebook || 'N/A',
      instagram: instagram || 'N/A',
      twitter: twitter || 'N/A',
      status: 'Not Contacted',
      loomUrl: '',
      savedAt: new Date().toISOString(),
      workspaceId: req.workspaceId || 'default',
    };

    if (isManual) {
      leadData.source = 'manual_offline';
    }

    const noteText = note != null ? String(note).trim() : '';
    if (noteText) {
      leadData.updates = [
        {
          type: 'note',
          value: noteText,
          timestamp: new Date().toISOString(),
        },
      ];
    }

    const key = await dbService.saveLead(leadData);
    if (isManual) {
      try {
        await activationService.recordEvent(userEmail(req), 'manual_lead_added');
      } catch (_) {
        /* non-fatal */
      }
    }
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
      return res.redirect('/leads?rows=0&created=0&updated=0&imported=0&skipped=0&failed=0');
    }

    const records = parseCsvToLeadRecords(req.file.buffer, req.file.originalname || 'import.csv');
    const wid = req.workspaceId || 'default';
    let created = 0;
    let updated = 0;
    let skipped = 0;
    let failed = 0;

    for (const rec of records) {
      if (!rec.title) {
        skipped += 1;
        continue;
      }
      let willMerge = false;
      if (rec.email && rec.email !== 'N/A') {
        const ex = await dbService.findLeadByEmail(rec.email, wid);
        willMerge = !!ex;
      } else if (rec.ip) {
        const ex = await dbService.findLeadByIp(rec.ip, wid);
        willMerge = !!ex;
      }
      try {
        await dbService.saveLead({
          ...rec,
          workspaceId: wid,
        });
        if (willMerge) updated += 1;
        else created += 1;
      } catch (e) {
        console.error('[CSV import] row error:', rec.title, e.message);
        failed += 1;
      }
    }

    const applied = created + updated;
    if (applied > 0) {
      await activationService.recordEvent(userEmail(req), 'csv_import');
    }

    const rows = records.length;
    const q = `rows=${rows}&created=${created}&updated=${updated}&imported=${applied}&skipped=${skipped}&failed=${failed}`;
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      return res.json({
        success: true,
        imported: applied,
        created,
        updated,
        skipped,
        failed,
        totalRows: rows,
      });
    }
    res.redirect(`/leads?${q}`);
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
      category: lead.categoryName,
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
          content: `Write a first-touch email that references 1–2 concrete signals from the JSON (gaps, category, location, warm vs cold source). Offer a low-friction next step (15-minute call).\n\n${JSON.stringify(summary, null, 2)}`,
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

// POST /leads/:key/insights — KIE/OpenAI: best service to sell + rationale (cached 7d)
router.post('/:key/insights', async (req, res, next) => {
  try {
    const key = req.params.key;
    const fullKey = key.startsWith('lead:') ? key : `lead:${key}`;
    const lead = await dbService.getLead(fullKey);
    if (!lead) return res.status(404).json({ success: false, error: 'Lead not found' });

    const refresh = !!(req.body && req.body.refresh);
    const maxAgeMs = 7 * 24 * 60 * 60 * 1000;
    if (
      !refresh &&
      lead.kieServiceInsight &&
      typeof lead.kieServiceInsight === 'object' &&
      lead.kieServiceInsightAt
    ) {
      const age = Date.now() - new Date(lead.kieServiceInsightAt).getTime();
      if (age >= 0 && age < maxAgeMs) {
        return res.json({ success: true, cached: true, ...lead.kieServiceInsight });
      }
    }

    const offeringCatalog = Object.entries(SCRIPT_LIBRARY)
      .map(([id, s]) => `- ${id}: ${s.label} — ${s.valueProp}`)
      .join('\n');
    const serviceKeyList = SCRIPT_LIBRARY_KEYS.join(', ');

    const snapshot = {
      company: lead.title,
      category: lead.categoryName,
      city: lead.city,
      state: lead.state,
      address: lead.address,
      website: lead.website,
      email: lead.email,
      phone: lead.phone,
      mapsRating: lead.totalScore,
      reviewCount: lead.reviewsCount,
      pipelineStage: lead.pipelineStage,
      source: lead.source,
      gaps: {
        hasWebsite: !!(lead.website && lead.website !== 'N/A'),
        hasSchemaMarkup: lead.hasSchemaMarkup,
        hasChatbot: lead.hasChatbot,
        hasClickToCall: lead.hasClickToCall,
        isMobileFriendly: lead.isMobileFriendly,
        isOutdated: lead.isOutdated,
        aeoScore: lead.aeoScore,
        cmsPlatform: lead.cmsPlatform,
      },
      auditSummary: lead.auditSummary,
    };

    const ai = await chatCompletion({
      messages: [
        {
          role: 'system',
          content: `You are a senior agency seller for a local SMB digital agency. Pick exactly ONE primary offering from the catalog that is the most logical first sale for this lead, based on their category, location, ratings/reviews, website presence, and technical gaps.

Catalog (primaryServiceKey must be exactly one of: ${serviceKeyList}):
${offeringCatalog}

Respond with JSON only, no markdown:
{"primaryServiceKey":"<one of the keys above>","primaryServiceLabel":"string","rationale":"2-4 sentences: why this offer fits now","talkTrack":"One conversational sentence to open a call or email"}`,
        },
        {
          role: 'user',
          content: JSON.stringify(snapshot),
        },
      ],
      jsonObject: true,
      max_tokens: 650,
      temperature: 0.35,
    });

    if (!ai.content || ai.error) {
      return res.json({
        success: false,
        error:
          'No AI provider configured (set KIE_AI_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY) or request failed.',
      });
    }

    let parsed;
    try {
      parsed = JSON.parse(ai.content);
    } catch {
      return res.json({ success: false, error: 'Invalid AI response' });
    }

    const keyOk = SCRIPT_LIBRARY_KEYS.includes(parsed.primaryServiceKey);
    const insight = {
      primaryServiceKey: keyOk ? parsed.primaryServiceKey : 'aiWebsites',
      primaryServiceLabel: parsed.primaryServiceLabel || SCRIPT_LIBRARY.aiWebsites.label,
      rationale: parsed.rationale || '',
      talkTrack: parsed.talkTrack || '',
      provider: ai.provider || 'unknown',
    };

    await dbService.updateLead(fullKey, {
      kieServiceInsight: insight,
      kieServiceInsightAt: new Date().toISOString(),
    });

    return res.json({ success: true, cached: false, ...insight });
  } catch (err) {
    next(err);
  }
});

// POST /leads/:key/enhance — Firecrawl scrape/search: contact + reviews + social + audit fields
router.post('/:key/enhance', async (req, res, next) => {
  try {
    const key = req.params.key;
    const fullKey = key.startsWith('lead:') ? key : `lead:${key}`;
    let lead = await dbService.getLead(fullKey);

    let deepData = null;
    let firecrawlViaSearch = false;

    if (lead.website && lead.website !== 'N/A') {
      console.log(`[ENHANCE] Triggering Firecrawl scrape for ${lead.title} (${lead.website})...`);
      deepData = await firecrawl.enrichLead(lead.website);
    } else {
      console.log(`[ENHANCE] Website missing. Triggering Firecrawl search for ${lead.title}...`);
      firecrawlViaSearch = true;
      const searchQuery = `${lead.title} business in ${lead.city}${lead.state ? ', ' + lead.state : ''} official website contact`;
      const searchResults = await firecrawl.searchBusiness(searchQuery);

      if (searchResults && searchResults.length > 0) {
        const bestResult =
          searchResults.find(
            (r) =>
              r.extract &&
              (r.extract.email ||
                r.extract.phone ||
                r.extract.address ||
                r.extract.total_score != null ||
                r.extract.reviews_count != null ||
                r.extract.facebook ||
                r.extract.instagram)
          ) || searchResults[0];
        deepData = bestResult.extract || {};

        if (!lead.website || lead.website === 'N/A') {
          const foundUrl = searchResults.find((r) => r.url)?.url;
          if (foundUrl) {
            await dbService.updateLead(fullKey, { website: foundUrl });
            lead = await dbService.getLead(fullKey);
          }
        }
      }
    }

    const baseUpdates = [...(lead.updates || [])];
    const patch = {};
    const priorUpdateLen = baseUpdates.length;

    if (deepData && Object.keys(deepData).length > 0) {
      const enrichUpdates = firecrawlExtractToLeadUpdates(deepData);
      Object.assign(patch, enrichUpdates);

      if ((!lead.email || lead.email === 'N/A') && deepData.email) patch.email = deepData.email;
      if ((!lead.facebook || lead.facebook === 'N/A') && deepData.facebook) patch.facebook = deepData.facebook;
      if ((!lead.instagram || lead.instagram === 'N/A') && deepData.instagram) patch.instagram = deepData.instagram;
      if ((!lead.twitter || lead.twitter === 'N/A') && deepData.twitter) patch.twitter = deepData.twitter;
      if (!lead.linkedin && deepData.linkedin) patch.linkedin = deepData.linkedin;

      // Do not overwrite existing CRM / Maps contact or ratings with scraped guesses
      if (lead.phone && lead.phone !== 'N/A') delete patch.phone;
      if (lead.address && lead.address !== 'N/A') delete patch.address;
      if (lead.email && lead.email !== 'N/A') delete patch.email;
      if (lead.totalScore != null && Number(lead.totalScore) > 0) delete patch.totalScore;
      if (lead.reviewsCount != null && Number(lead.reviewsCount) > 0) delete patch.reviewsCount;

      baseUpdates.push({
        type: 'enrichment',
        value: `Deep hunt completed${firecrawlViaSearch ? ' via web search' : ''}.`,
        timestamp: new Date().toISOString(),
      });
    }

    const hasNewUpdates = baseUpdates.length > priorUpdateLen;
    const patchKeys = Object.keys(patch).filter((k) => k !== 'updates');

    if (patchKeys.length > 0 || hasNewUpdates) {
      patch.updates = baseUpdates;
      const updatedLead = await dbService.updateLead(fullKey, patch);
      return res.json({ success: true, lead: updatedLead });
    }

    res.json({ success: false, error: 'No new contact data discovered yet.' });
  } catch (err) {
    console.error('Manual enhancement error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
