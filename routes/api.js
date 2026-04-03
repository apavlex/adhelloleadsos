const express = require('express');
const router = express.Router();
const dbService = require('../services/database');
const { enrichLead } = require('../services/firecrawl');
const { cleanBusinessName } = require('../utils/nameCleaner');

// Middleware to check API Key
const validateApiKey = (req, res, next) => {
  const apiKey = req.headers['x-api-key'] || req.query.api_key;
  const expectedKey = process.env.API_INGEST_KEY || 'adhello_secret_123';
  
  if (!apiKey || apiKey !== expectedKey) {
    return res.status(401).json({ error: 'Unauthorized: Invalid API Key' });
  }
  next();
};

/**
 * POST /api/leads/ingest
 * Receives leads from adhello.ai audit report
 */
router.post('/ingest', validateApiKey, async (req, res, next) => {
  try {
    const { 
      title, 
      website, 
      email, 
      phone,
      totalScore,
      auditUrl,
      blueprintId,
      auditData,
      adBriefData,
      chatHistory,
      source,
      message,
      city,
      state,
      industry,
      goal,
      vibe
    } = req.body;

    if (!title && !email && !website) {
      return res.status(400).json({ error: 'Business title, Website, or Email is required.' });
    }

    // Clean the business name if it's a domain/URL
    const normalizedTitle = title ? cleanBusinessName(title) : (website ? cleanBusinessName(website) : 'New Lead');

    const clientIp = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();

    // Prepare lead data for merge/save
    const leadData = {
      title: normalizedTitle,
      website: website || 'N/A',
      email: email || 'N/A',
      phone: phone || 'N/A',
      city: city || '',
      state: state || '',
      ip: clientIp,
      source: source || 'adhello_audit',
      totalScore: parseFloat(totalScore) || 0,
      auditUrl: auditUrl || null,
      blueprintId: blueprintId || null,
      auditData: auditData || null,
      adBriefData: adBriefData || null,
      chatHistory: chatHistory || [],
      industry: industry || '',
      goal: goal || '',
      vibe: vibe || '',
      lastActivity: new Date().toISOString()
    };

    // Auto-status mapping
    if (source === 'adhello_chatbot') leadData.status = 'Lead Captured';
    if (source === 'adhello_audit') leadData.status = 'Discovery Done';
    if (source === 'adhello_strategy') leadData.status = 'Strategy Created';
    if (source === 'adhello_brief') leadData.status = 'Sales Briefing';

    // Add activity log
    leadData.logs = [{
      type: 'ingest',
      source: source || 'external',
      message: message || `Data received via ${source || 'AdHello'}`,
      timestamp: new Date().toISOString()
    }];

    // Save/Merge via DB Service
    const leadKey = await dbService.saveLead(leadData);
    
    // Background enrichment if new or missing data
    if (leadData.website && leadData.website !== 'N/A') {
      setImmediate(async () => {
        try {
          const enrichment = await enrichLead(leadData.website);
          if (enrichment) {
            await dbService.updateLead(leadKey, enrichment);
          }
        } catch (e) {
          console.error(`[API-INGEST] Auto-enrichment failed for ${leadKey}:`, e.message);
        }
      });
    }

    res.json({ 
      success: true, 
      key: leadKey, 
      message: 'Lead data ingested successfully.',
      lead: leadData
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/track
 * Receives pings from adhello.ai to track traffic
 */
router.post('/track', async (req, res) => {
  try {
    const ip = req.body.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const { path, referrer, userAgent } = req.body;
    
    // Default to 'Inland Empire, CA' placeholder if IP lookup fails or is local
    let location = { city: 'Unknown', region: 'Unknown', country: 'Unknown' };
    
    if (ip && ip !== '127.0.0.1' && ip !== '::1') {
      try {
        const geoRes = await fetch(`http://ip-api.com/json/${ip.split(',')[0]}`);
        const geoData = await geoRes.json();
        if (geoData.status === 'success') {
          location = {
            city: geoData.city,
            region: geoData.regionName,
            country: geoData.country
          };
        }
      } catch (e) {
        console.error('[ANALYTICS] IP lookup failed:', e.message);
      }
    }

    const visitData = {
      ip: ip.split(',')[0],
      path: path || '/',
      referrer: referrer || 'direct',
      userAgent: userAgent || 'unknown',
      ...location
    };

    await dbService.saveVisit(visitData);
    res.json({ success: true });
  } catch (err) {
    console.error('[ANALYTICS] Tracking error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/status
 * Returns current background job status and latest notification
 */
router.get('/status', async (req, res) => {
  try {
    const activeJob = await dbService.getActiveJob();
    const latestFinished = await dbService.getLatestFinishedJob();
    
    res.json({
      isProcessing: !!activeJob,
      activeJob: activeJob || null,
      notification: latestFinished || null
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/notifications/read
 * Marks the latest notification as read
 */
router.post('/notifications/read', async (req, res) => {
  try {
    await dbService.markNotificationRead();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/leads/stitch-sync
 * Syncs AI-generated design data (Stitch) to an existing lead record
 */
router.post('/leads/stitch-sync', validateApiKey, async (req, res, next) => {
  try {
    const { website, title, stitchDesignUrl, stitchScreenshotUrl, stitchScreenId } = req.body;
    
    if (!website && !title) {
        return res.status(400).json({ error: 'Missing website or business title' });
    }

    console.log(`[STITCH-SYNC] Syncing design for: ${website || title}`);

    // Update existing lead with stitch design info
    // We'll search by website URL first, then title
    let leadKey = null;
    const leads = await dbService.listLeads();
    const existing = leads.find(l => 
        (website && l.website && l.website === website) || 
        (title && l.title && l.title.toLowerCase() === title.toLowerCase())
    );

    if (existing) {
        leadKey = existing.key;
        await dbService.updateLead(leadKey, {
            stitchDesignUrl: stitchDesignUrl || null,
            stitchScreenshotUrl: stitchScreenshotUrl || null,
            stitchScreenId: stitchScreenId || null,
            status: 'Design Built' // Update status to reflect design progress
        });
        
        // Add activity log
        await dbService.addLog(leadKey, {
            type: 'stitch_sync',
            message: `AI Design Blueprint generated: ${stitchScreenId}`,
            timestamp: new Date().toISOString()
        });
    }

    res.json({ success: !!leadKey, key: leadKey, message: leadKey ? 'Design synced successfully' : 'Lead not found for sync' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
