const express = require('express');
const multer = require('multer');
const router = express.Router();
const dbService = require('../services/database');
const firecrawl = require('../services/firecrawl');
const webEnrichment = require('../services/webEnrichment');
const { firecrawlExtractToLeadUpdates } = require('../services/enrichmentNormalize');
const mapsEnrichFallback = require('../services/mapsEnrichFallback');
const { parseCsvToLeadRecords } = require('../services/csvLeadImport');
const { SCRIPT_LIBRARY, SCRIPT_LIBRARY_KEYS } = require('../services/salesConstants');
const pipelineStagesService = require('../services/pipelineStagesService');
const { scoreLeadRecord } = require('../services/opportunityScore');
const { chatCompletion } = require('../services/llmClient');
const { filterLeadsForRequest, userEmail } = require('../services/workspaceService');
const {
  displayStatus,
  applyLeadListFilters,
  mapLeadListJson,
  normalizeLeadListFilters,
  leadListFilterQuerySuffix,
  excludeOutreachFolderLeads,
} = require('../services/leadListFilters');
const activationService = require('../services/activationService');
const sequenceEngine = require('../services/sequenceEngine');
const workspaceService = require('../services/workspaceService');
const workspaceIntegrations = require('../services/workspaceIntegrations');

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

// GET /leads — canonical URL is /prospecting?tab=pipeline (bookmark-safe redirect)
router.get('/', (req, res) => {
  const params = new URLSearchParams();
  Object.entries(req.query).forEach(([k, v]) => {
    if (k === 'tab') return;
    if (v == null || v === '') return;
    if (Array.isArray(v)) v.forEach((x) => params.append(k, String(x)));
    else params.set(k, String(v));
  });
  params.set('tab', 'pipeline');
  res.redirect(302, `/prospecting?${params.toString()}`);
});

// Legacy URL — warm leads now live on the main board with ?source=inbound
router.get('/inbound', (req, res) => {
  res.redirect(302, '/leads?source=inbound');
});

// GET /leads/saved — return all saved lead titles+keys for client-side bookmark state
router.get('/saved', async (req, res, next) => {
  try {
    const leads = filterLeadsForRequest(req, await dbService.getAllLeads(req.workspaceId));
    const saved = leads.map((l) => ({ key: l.key, title: l.title }));
    res.json(saved);
  } catch (err) {
    next(err);
  }
});

// GET /leads/list.json — lightweight list for folders / client filtering
router.get('/list.json', async (req, res, next) => {
  try {
    const all = await dbService.getAllLeads(req.workspaceId);
    const visible = filterLeadsForRequest(req, all);
    const filters = {
      folderKey: req.query.folderKey,
      excludeFolderAssigned:
        req.query.excludeFolderAssigned === '1' || req.query.excludeFolderAssigned === 'true',
      ...normalizeLeadListFilters(req.query),
    };
    const out = applyLeadListFilters(visible, filters);

    res.json({
      success: true,
      leads: out.map(mapLeadListJson),
    });
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
      workspaceId: req.workspaceId,
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
      return res.redirect(`/prospecting?tab=pipeline&importError=${encodeURIComponent(msg)}`);
    }
    next();
  });
}, async (req, res, next) => {
  try {
    if (!req.file || !req.file.buffer) {
      if (req.headers.accept && req.headers.accept.includes('application/json')) {
        return res.status(400).json({ success: false, error: 'No CSV file received (field name: csvfile).' });
      }
      return res.redirect('/prospecting?tab=pipeline&rows=0&created=0&updated=0&imported=0&skipped=0&failed=0');
    }

    const records = parseCsvToLeadRecords(req.file.buffer, req.file.originalname || 'import.csv');
    const wid = req.workspaceId;
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
    res.redirect(`/prospecting?tab=pipeline&${q}`);
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
    const assignee = await workspaceService.pickRoundRobinAssignee(req.workspaceId);
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
    const updateData = { ...req.body };
    const existing = await dbService.getLead(fullKey);
    const wid = req.workspaceId;

    const stages = await pipelineStagesService.listStages(wid);
    if (updateData.stageId != null && String(updateData.stageId).trim() !== '') {
      const sid = String(updateData.stageId).trim();
      if (stages.some((s) => s.id === sid)) {
        Object.assign(updateData, pipelineStagesService.patchLeadStageFields(existing, stages, sid));
      }
      delete updateData.stageId;
    } else if (updateData.pipelineStage !== undefined && updateData.pipelineStage !== null) {
      const next = parseInt(updateData.pipelineStage, 10);
      if (!Number.isNaN(next) && next >= 1 && next <= stages.length) {
        const sid = stages[next - 1].id;
        Object.assign(updateData, pipelineStagesService.patchLeadStageFields(existing, stages, sid));
      }
    }

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

    const updated = await dbService.updateLead(fullKey, updateData, wid);
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
    res.redirect('/prospecting?tab=pipeline');
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
      const hasWarRoomOpener =
        typeof lead.kieServiceInsight.warRoomOpener === 'string' &&
        lead.kieServiceInsight.warRoomOpener.trim().length > 0;
      if (age >= 0 && age < maxAgeMs && hasWarRoomOpener) {
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
{"primaryServiceKey":"<one of the keys above>","primaryServiceLabel":"string","rationale":"2-4 sentences: why this offer fits now","talkTrack":"One conversational sentence to open a call or email","warRoomOpener":"Plain text only: 4-8 short sentences for a respectful cold-call opener. Use placeholders [your name] and optionally [your company]. Only mention technical or conversion gaps that are actually true in the snapshot gaps object—say them in plain English (e.g. mobile experience, lead-capture chat, local/schema SEO for AI search, click-to-call, dated design). Tie those pains naturally to primaryServiceLabel as a logical first project. No bullets, markdown, or nested quotes."}`,
        },
        {
          role: 'user',
          content: JSON.stringify(snapshot),
        },
      ],
      jsonObject: true,
      max_tokens: 1000,
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
      warRoomOpener: typeof parsed.warRoomOpener === 'string' ? parsed.warRoomOpener.trim() : '',
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

// POST /leads/:key/review-intelligence — strengths / weaknesses from review snippets + rating (cached 7d)
router.post('/:key/review-intelligence', async (req, res, next) => {
  try {
    const key = req.params.key;
    const fullKey = key.startsWith('lead:') ? key : `lead:${key}`;
    const lead = await dbService.getLead(fullKey);
    if (!lead) return res.status(404).json({ success: false, error: 'Lead not found' });

    const refresh = !!(req.body && req.body.refresh);
    const maxAgeMs = 7 * 24 * 60 * 60 * 1000;
    if (
      !refresh &&
      lead.reviewIntel &&
      typeof lead.reviewIntel === 'object' &&
      lead.reviewIntelAt
    ) {
      const age = Date.now() - new Date(lead.reviewIntelAt).getTime();
      if (age >= 0 && age < maxAgeMs) {
        const ri = lead.reviewIntel;
        return res.json({
          success: true,
          cached: true,
          strengths: Array.isArray(ri.strengths) ? ri.strengths : [],
          weaknesses: Array.isArray(ri.weaknesses) ? ri.weaknesses : [],
          sourceNote: typeof ri.sourceNote === 'string' ? ri.sourceNote : '',
        });
      }
    }

    const snippets = Array.isArray(lead.reviewSnippets) ? lead.reviewSnippets : [];
    const snapshot = {
      company: lead.title,
      category: lead.categoryName,
      city: lead.city,
      state: lead.state,
      mapsRating: lead.totalScore,
      reviewCount: lead.reviewsCount,
      auditSummary: lead.auditSummary || '',
      reviewSnippets: snippets,
    };

    const ai = await chatCompletion({
      messages: [
        {
          role: 'system',
          content: `You analyze local business reputation for agency sales. Input is JSON with optional verbatim customer quotes in reviewSnippets, star rating mapsRating (0-5), reviewCount, category, location, and auditSummary.

Rules:
- If reviewSnippets has one or more strings: derive strengths and weaknesses only from themes in those quotes plus rating/count. Do not invent incidents not supported by the quotes.
- If reviewSnippets is empty: infer plausible strengths and weaknesses from category, location, mapsRating, reviewCount, and auditSummary only. Use cautious wording ("Often…", "May…", "Typical risk…"). Do not claim you read specific reviews.

Return JSON only, no markdown:
{"strengths":["bullet 1",...],"weaknesses":["bullet 1",...],"sourceNote":"One sentence: cite verbatim snippets vs rating-only inference."}`,
        },
        {
          role: 'user',
          content: JSON.stringify(snapshot),
        },
      ],
      jsonObject: true,
      max_tokens: 800,
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

    const intel = {
      strengths: Array.isArray(parsed.strengths) ? parsed.strengths.map((s) => String(s || '').trim()).filter(Boolean) : [],
      weaknesses: Array.isArray(parsed.weaknesses)
        ? parsed.weaknesses.map((s) => String(s || '').trim()).filter(Boolean)
        : [],
      sourceNote: typeof parsed.sourceNote === 'string' ? parsed.sourceNote.trim() : '',
    };

    await dbService.updateLead(fullKey, {
      reviewIntel: intel,
      reviewIntelAt: new Date().toISOString(),
    });

    return res.json({
      success: true,
      cached: false,
      strengths: intel.strengths,
      weaknesses: intel.weaknesses,
      sourceNote: intel.sourceNote,
    });
  } catch (err) {
    next(err);
  }
});

// POST /leads/:key/enhance — Firecrawl scrape/search + Maps (Outscraper/Apify) fallback
router.post('/:key/enhance', async (req, res, next) => {
  try {
    const key = req.params.key;
    const fullKey = key.startsWith('lead:') ? key : `lead:${key}`;
    let lead = await dbService.getLead(fullKey);

    let deepData = null;
    let firecrawlViaSearch = false;
    let mapsFallbackUsed = false;
    /** When lead has no website: prefer Maps listing site, else Firecrawl result URL */
    let urlToSave = null;

    const leadWorkspaceId = (lead && lead.workspaceId) || req.workspaceId;
    const integrationEnv = await workspaceIntegrations.getResolvedIntegrationEnv(leadWorkspaceId);
    const leadProfile = { title: lead.title, city: lead.city, state: lead.state };

    if (lead.website && lead.website !== 'N/A') {
      console.log(`[ENHANCE] Triggering enrich for ${lead.title} (${lead.website})...`);
      const pack = await webEnrichment.enrichLeadSmartWithMapsFallback(lead.website, leadProfile, {
        integrationEnv,
      });
      deepData = pack.merged;
      mapsFallbackUsed = pack.mapsUsed;
    } else {
      console.log(`[ENHANCE] Website missing. Firecrawl search + Maps fallback for ${lead.title}...`);
      firecrawlViaSearch = true;
      const searchQuery = `${lead.title} business in ${lead.city}${lead.state ? ', ' + lead.state : ''} official website contact`;
      let searchExtract = {};
      let firecrawlFoundUrl = null;
      try {
        const searchResults = await firecrawl.searchBusiness(searchQuery, integrationEnv);

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
          searchExtract = bestResult.extract || {};
          firecrawlFoundUrl = searchResults.find((r) => r.url)?.url || null;
        }
      } catch (e) {
        console.warn('[ENHANCE] Firecrawl search failed:', e.message);
      }

      let websiteHint = null;
      if (!mapsEnrichFallback.extractHasContactSignal(searchExtract)) {
        const pack = await mapsEnrichFallback.enrichFromMapsForLead(lead, integrationEnv);
        if (pack) {
          searchExtract = mapsEnrichFallback.mergeExtractPreferFirecrawl(searchExtract, pack.extract);
          websiteHint = pack.websiteHint;
          mapsFallbackUsed = true;
        }
      }
      deepData = searchExtract;
      if (!lead.website || lead.website === 'N/A') {
        urlToSave = websiteHint || firecrawlFoundUrl || null;
      }
    }

    const baseUpdates = [...(lead.updates || [])];
    const patch = {};
    const priorUpdateLen = baseUpdates.length;

    const hadExtract = deepData && Object.keys(deepData).length > 0;
    if (hadExtract) {
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
    }

    if ((!lead.website || lead.website === 'N/A') && urlToSave) {
      patch.website = urlToSave;
    }

    if (hadExtract || urlToSave || mapsFallbackUsed) {
      const via = [
        firecrawlViaSearch ? 'web search' : null,
        mapsFallbackUsed ? 'Maps backup' : null,
      ]
        .filter(Boolean)
        .join(' + ');
      baseUpdates.push({
        type: 'enrichment',
        value: `Deep hunt completed${via ? ` (${via})` : ''}.`,
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
