const express = require('express');
const router = express.Router();
const dbService = require('../services/database');
const { enrichLead } = require('../services/firecrawl');

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
      totalScore,
      auditData,
      phone,
      address,
      city,
      state,
      categoryName
    } = req.body;

    if (!title) {
      return res.status(400).json({ error: 'Business title is required.' });
    }

    const leadData = {
      title,
      website: website || 'N/A',
      email: email || 'N/A',
      phone: phone || 'N/A',
      address: address || 'N/A',
      city: city || '',
      state: state || '',
      categoryName: categoryName || 'Audit Lead',
      totalScore: parseFloat(totalScore) || 0,
      auditData: auditData || null, // Stores { mobileScore, leadsScore, aiReadyScore, summary }
      status: 'Discovery Done', // New leads from audit are automatically in Discovery Done
      source: 'adhello_audit',
      savedAt: new Date().toISOString(),
      updates: [{
        type: 'status_change',
        value: 'Discovery Done',
        timestamp: new Date().toISOString(),
        note: 'Lead ingested via AdHello Audit'
      }]
    };

    const key = await dbService.saveLead(leadData);
    
    // Background enrichment
    if (website && website !== 'N/A') {
      setImmediate(async () => {
        try {
          console.log(`[API-INGEST] Triggering auto-enrichment for ${website}...`);
          const enrichment = await enrichLead(website);
          if (enrichment) {
            await dbService.updateLead(key, { 
              ...enrichment, 
              // Don't overwrite existing audit data if enrichment returns less
            });
          }
        } catch (e) {
          console.error(`[API-INGEST] Auto-enrichment failed for ${key}:`, e.message);
        }
      });
    }

    res.json({ 
      success: true, 
      key, 
      message: 'Lead ingested successfully. Background enrichment triggered.',
      lead: leadData
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
