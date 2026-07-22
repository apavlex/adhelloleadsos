const express = require('express');
const router = express.Router();
const dbService = require('../services/database');
const webEnrichment = require('../services/webEnrichment');
const workspaceIntegrations = require('../services/workspaceIntegrations');
const { firecrawlExtractToLeadUpdates } = require('../services/enrichmentNormalize');
const { summaryForApi, normalizeSignalLead } = require('../services/signalChannels');
const {
  fromNewsletterPayload,
  fromBookingPayload,
  fromInboundFormPayload,
} = require('../services/inboundWebhookNormalize');
const { cleanBusinessName } = require('../utils/nameCleaner');
const { defaultPipelineStageForSource, clampPipelineStage } = require('../services/pipelineConstants');
const signalwire = require('../services/signalwire');
const agentSessionStore = require('../services/agentSessionStore');
const { autoAttachCadenceIfNeeded } = require('../services/leadCadence');
const dialerPacing = require('../services/dialerPacing');
const inboundForwardStats = require('../services/inboundForwardStats');
const ghlSync = require('../services/ghlSync');
const commsClient = require('../services/commsClient');
const commsSync = require('../services/commsSync');

// Middleware to check API Key
const validateApiKey = (req, res, next) => {
  const apiKey = req.headers['x-api-key'] || req.query.api_key;
  const expectedKey = process.env.API_INGEST_KEY || 'adhello_secret_123';
  
  if (!apiKey || apiKey !== expectedKey) {
    return res.status(401).json({ error: 'Unauthorized: Invalid API Key' });
  }
  next();
};

function workspaceIdFromReq(req) {
  const h = req.headers['x-workspace-id'];
  return typeof h === 'string' && h.trim() ? h.trim() : 'default';
}

function xmlEscape(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function telephonyAuthorized(req) {
  const cfg = signalwire.envConfig();
  if (!cfg.webhookToken) return true;
  const token = String((req.query && req.query.token) || req.headers['x-telephony-token'] || '').trim();
  return !!token && token === cfg.webhookToken;
}

async function ghlWebhookAuthorized(req) {
  const token = String(
    (req.query && req.query.token) ||
      req.headers['x-ghl-webhook-token'] ||
      req.headers['x-api-key'] ||
      '',
  ).trim();
  if (!token) return false;

  const globalSecret = String(process.env.GHL_WEBHOOK_SECRET || '').trim();
  const ingestKey = String(process.env.API_INGEST_KEY || 'adhello_secret_123').trim();
  if (globalSecret && token === globalSecret) return true;
  if (token === ingestKey) return true;

  const wid = workspaceIdFromReq(req);
  const ws = await dbService.getWorkspace(wid);
  const plain = workspaceIntegrations.decryptedFromWorkspace(ws);
  const wsSecret = String(plain.ghlWebhookSecret || '').trim();
  return !!(wsSecret && token === wsSecret);
}

async function commsWebhookAuthorized(req) {
  const token = String(
    (req.query && req.query.token) ||
      req.headers['x-comms-webhook-token'] ||
      req.headers['x-api-key'] ||
      '',
  ).trim();
  if (!token) return false;

  const globalSecret = String(process.env.COMMS_WEBHOOK_SECRET || '').trim();
  const ingestKey = String(process.env.API_INGEST_KEY || 'adhello_secret_123').trim();
  if (globalSecret && token === globalSecret) return true;
  if (token === ingestKey) return true;

  const wid = workspaceIdFromReq(req);
  const ws = await dbService.getWorkspace(wid);
  const plain = workspaceIntegrations.decryptedFromWorkspace(ws);
  const wsSecret = String(plain.commsWebhookSecret || '').trim();
  return !!(wsSecret && token === wsSecret);
}

async function findLeadForTelephonyEvent({ leadKey, workspaceId, from, to }) {
  if (leadKey) {
    const lead = await dbService.getLead(String(leadKey));
    if (lead) return { key: String(leadKey), lead };
  }
  const candidates = workspaceId
    ? await dbService.getAllLeads(String(workspaceId))
    : await dbService.getAllLeadsUnscoped();
  const normalizedFrom = signalwire.normalizePhone(from);
  const normalizedTo = signalwire.normalizePhone(to);
  const match = candidates.find((l) => {
    const lp = signalwire.normalizePhone(l.phone);
    if (!lp) return false;
    return lp === normalizedFrom || lp === normalizedTo;
  });
  if (!match) return null;
  return { key: match.key, lead: match };
}

async function appendTelephonyUpdate(match, entry, extras) {
  if (!match || !match.lead || !match.key) return;
  const updates = Array.isArray(match.lead.updates) ? [...match.lead.updates] : [];
  updates.push({
    timestamp: new Date().toISOString(),
    ...entry,
  });
  await dbService.updateLead(match.key, {
    ...(extras || {}),
    updates,
    logs: [
      {
        type: entry.type || 'telephony',
        message: entry.value || entry.type || 'Telephony event',
        timestamp: new Date().toISOString(),
      },
    ],
  });
}

/**
 * POST /api/leads/ingest
 * Receives leads from adhello.ai when someone submits email + domain for an audit scan.
 * Headers: x-api-key (or ?api_key=) = API_INGEST_KEY; optional x-workspace-id (default default).
 * Body: at least one of title, email, website; recommend email + website + source: "adhello_audit".
 * Saves into the same lead store as /leads (warm inbound filter applies to adhello_* sources).
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
      vibe,
      pipelineStage: pipelineStageBody,
    } = req.body;

    if (!title && !email && !website) {
      return res.status(400).json({ error: 'Business title, Website, or Email is required.' });
    }

    // Clean the business name if it's a domain/URL
    const normalizedTitle = title ? cleanBusinessName(title) : (website ? cleanBusinessName(website) : 'New Lead');

    const clientIp = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();

    const src = source || 'adhello_audit';
    const requestedPs = parseInt(pipelineStageBody, 10);
    const resolvedStage = Number.isFinite(requestedPs)
      ? clampPipelineStage(requestedPs)
      : defaultPipelineStageForSource(src);

    // Prepare lead data for merge/save
    const leadData = {
      title: normalizedTitle,
      website: website || 'N/A',
      email: email || 'N/A',
      phone: phone || 'N/A',
      city: city || '',
      state: state || '',
      ip: clientIp,
      source: src,
      pipelineStage: resolvedStage,
      totalScore: parseFloat(totalScore) || 0,
      auditUrl: auditUrl || null,
      blueprintId: blueprintId || null,
      auditData: auditData || null,
      adBriefData: adBriefData || null,
      chatHistory: chatHistory || [],
      industry: industry || '',
      goal: goal || '',
      vibe: vibe || '',
      lastActivity: new Date().toISOString(),
      workspaceId: workspaceIdFromReq(req),
    };

    // Auto-status mapping
    if (src === 'adhello_chatbot') leadData.status = 'Lead Captured';
    if (src === 'adhello_audit') leadData.status = 'Discovery Done';
    if (src === 'adhello_strategy') leadData.status = 'Strategy Created';
    if (src === 'adhello_brief') leadData.status = 'Sales Briefing';

    // Add activity log
    leadData.logs = [{
      type: 'ingest',
      source: source || 'external',
      message: message || `Data received via ${source || 'AdHello'}`,
      timestamp: new Date().toISOString()
    }];

    // Save/Merge via DB Service
    const leadKey = await dbService.saveLead(leadData);
    try {
      await autoAttachCadenceIfNeeded({ leadKey, workspaceId: workspaceIdFromReq(req) });
    } catch (_) {
      /* non-fatal */
    }
    
    // Background enrichment if new or missing data
    if (leadData.website && leadData.website !== 'N/A') {
      const ingestWid = workspaceIdFromReq(req);
      setImmediate(async () => {
        try {
          const integrationEnv = await workspaceIntegrations.getResolvedIntegrationEnv(ingestWid);
          const { merged: enrichment } = await webEnrichment.enrichLeadSmartWithMapsFallback(
            leadData.website,
            { title: leadData.title, city: leadData.city, state: leadData.state },
            { integrationEnv }
          );
          if (enrichment && Object.keys(enrichment).length > 0) {
            await dbService.updateLead(leadKey, firecrawlExtractToLeadUpdates(enrichment));
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
 * POST /api/webhooks/newsletter
 * Beehiiv / ConvertKit / generic — send JSON with at least email (flat or nested subscriber.contact).
 */
router.post('/webhooks/newsletter', validateApiKey, async (req, res, next) => {
  try {
    const payload = fromNewsletterPayload(req.body || {});
    if (!payload.email || payload.email === 'N/A') {
      return res.status(400).json({ error: 'email is required (top-level or subscriber.email).' });
    }
    const key = await dbService.saveLead({ ...payload, workspaceId: workspaceIdFromReq(req) });
    try {
      await autoAttachCadenceIfNeeded({ leadKey: key, workspaceId: workspaceIdFromReq(req) });
    } catch (_) {
      /* non-fatal */
    }
    res.json({ success: true, key, message: 'Newsletter subscriber saved as lead.' });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/webhooks/booking
 * Calendly / Cal.com-style payload — creates warm lead at CQI (stage 4) by default.
 */
router.post('/webhooks/booking', validateApiKey, async (req, res, next) => {
  try {
    const payload = fromBookingPayload(req.body || {});
    if (!payload.email || payload.email === 'N/A') {
      return res.status(400).json({
        error: 'invitee email required (email, invitee.email, attendees[0].email, etc.).',
      });
    }
    const key = await dbService.saveLead({ ...payload, workspaceId: workspaceIdFromReq(req) });
    try {
      await autoAttachCadenceIfNeeded({ leadKey: key, workspaceId: workspaceIdFromReq(req) });
    } catch (_) {
      /* non-fatal */
    }
    res.json({ success: true, key, message: 'Booking saved as inbound lead.' });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/webhooks/form
 * Typeform / Tally / custom — same email rules as newsletter; optional form_name, form_id, UTM fields.
 */
router.post('/webhooks/form', validateApiKey, async (req, res, next) => {
  try {
    const payload = fromInboundFormPayload(req.body || {});
    if (!payload.email || payload.email === 'N/A') {
      return res.status(400).json({ error: 'email is required.' });
    }
    const key = await dbService.saveLead({ ...payload, workspaceId: workspaceIdFromReq(req) });
    try {
      await autoAttachCadenceIfNeeded({ leadKey: key, workspaceId: workspaceIdFromReq(req) });
    } catch (_) {
      /* non-fatal */
    }
    res.json({ success: true, key, message: 'Form submission saved as inbound lead.' });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/webhooks/ghl
 * Go High Level ContactCreate / ContactUpdate + InboundMessage / OutboundMessage SMS.
 * Auth: ?token=GHL_WEBHOOK_SECRET or x-ghl-webhook-token (or x-api-key / workspace ghlWebhookSecret).
 * Workspace is resolved from payload locationId when x-workspace-id is not set.
 */
router.post('/webhooks/ghl', express.json(), async (req, res, next) => {
  try {
    if (!(await ghlWebhookAuthorized(req))) {
      return res.status(401).json({ error: 'Unauthorized: invalid webhook token' });
    }
    const headerWid = req.headers['x-workspace-id'];
    const workspaceId =
      typeof headerWid === 'string' && headerWid.trim() ? headerWid.trim() : undefined;
    const body = req.body || {};
    const msgResult = await ghlSync.processMessageWebhook(body, { workspaceId });
    if (!msgResult.ignored || msgResult.reason !== 'not_sms_message') {
      return res.json({ success: true, ...msgResult });
    }
    const result = await ghlSync.processWebhook(body, { workspaceId });
    return res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/webhooks/comms
 * Comms by Osis inbound message events (message.received, delivery status, etc.).
 * Auth: ?token=COMMS_WEBHOOK_SECRET or x-comms-webhook-token (or workspace commsWebhookSecret).
 */
router.post('/webhooks/comms', express.json(), async (req, res, next) => {
  try {
    if (!(await commsWebhookAuthorized(req))) {
      return res.status(401).json({ error: 'Unauthorized: invalid webhook token' });
    }
    const workspaceId = workspaceIdFromReq(req);
    const body = req.body || {};
    const result = await commsSync.processWebhook(body, { workspaceId });
    return res.json({ success: true, ...result });
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

    const result = await dbService.saveVisit(visitData);
    res.json({ success: true, deduped: result.deduped === true });
  } catch (err) {
    console.error('[ANALYTICS] Tracking error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/acquisition-channels
 * Roadmap + env hints for Maps-adjacent channels (jobs, ads, intent, creators).
 */
router.get('/acquisition-channels', async (req, res) => {
  try {
    res.json({ channels: summaryForApi() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/leads/signal-ingest
 * Ingest leads from jobs boards, ads libraries, community intent, etc. (same API key as ingest).
 */
router.post('/leads/signal-ingest', validateApiKey, async (req, res, next) => {
  try {
    const payload = normalizeSignalLead(req.body);
    const hasIdentity =
      (payload.title && payload.title !== 'Untitled prospect') ||
      (payload.website && payload.website !== 'N/A');
    if (!hasIdentity) {
      return res.status(400).json({ error: 'Provide title, company_name, or website.' });
    }

    const key = await dbService.saveLead({ ...payload, workspaceId: workspaceIdFromReq(req) });
    res.json({ success: true, key, message: 'Signal lead saved.' });
  } catch (err) {
    next(err);
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
    const widRaw = (req.body && req.body.workspaceId) || req.headers['x-workspace-id'];
    const wid =
      typeof widRaw === 'string' && widRaw.trim()
        ? widRaw.trim()
        : workspaceIdFromReq(req);
    const leads = await dbService.listLeads(wid);
    const existing = leads.find(l => 
        (website && l.website && l.website === website) || 
        (title && l.title && String(l.title).toLowerCase() === String(title).toLowerCase())
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

// POST /api/telephony/sms/inbound — SignalWire inbound SMS webhook
router.post('/telephony/sms/inbound', async (req, res) => {
  try {
    if (!telephonyAuthorized(req)) return res.status(401).send('Unauthorized');
    const from = req.body.From || req.body.from || '';
    const to = req.body.To || req.body.to || '';
    const body = String(req.body.Body || req.body.body || '').trim();
    const leadKey = String((req.query && req.query.leadKey) || '').trim();
    const workspaceId = String((req.query && req.query.workspaceId) || '').trim();
    const match = await findLeadForTelephonyEvent({ leadKey, workspaceId, from, to });
    if (match && body) {
      await appendTelephonyUpdate(match, {
        type: 'sms_inbound',
        value: body,
        from,
        to,
        messageSid: String(req.body.MessageSid || req.body.SmsSid || ''),
        provider: 'signalwire',
      });
    }
    res.type('text/xml').send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
  } catch (err) {
    console.error('[telephony:sms:inbound]', err.message);
    res.type('text/xml').send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
  }
});

// POST /api/telephony/sms/status — SignalWire delivery updates
router.post('/telephony/sms/status', async (req, res) => {
  try {
    if (!telephonyAuthorized(req)) return res.status(401).json({ success: false });
    const leadKey = String((req.query && req.query.leadKey) || '').trim();
    const workspaceId = String((req.query && req.query.workspaceId) || '').trim();
    const from = req.body.From || '';
    const to = req.body.To || '';
    const status = String(req.body.MessageStatus || req.body.SmsStatus || '').trim();
    const sid = String(req.body.MessageSid || req.body.SmsSid || '').trim();
    const match = await findLeadForTelephonyEvent({ leadKey, workspaceId, from, to });
    if (match && status) {
      await appendTelephonyUpdate(match, {
        type: 'sms_status',
        value: `SMS status: ${status}`,
        from,
        to,
        messageSid: sid,
        provider: 'signalwire',
      });
    }
    res.json({ success: true });
  } catch (err) {
    console.error('[telephony:sms:status]', err.message);
    res.json({ success: true });
  }
});

// POST /api/telephony/voice/status — call state updates
router.post('/telephony/voice/status', async (req, res) => {
  try {
    if (!telephonyAuthorized(req)) return res.status(401).json({ success: false });
    const leadKey = String((req.query && req.query.leadKey) || '').trim();
    let workspaceId = String((req.query && req.query.workspaceId) || '').trim();
    const from = req.body.From || '';
    const to = req.body.To || '';
    const callStatus = String(req.body.CallStatus || '').trim();
    const sid = String(req.body.CallSid || '').trim();
    const action = String((req.query && req.query.action) || 'call').trim();
    const direction = String(req.body.Direction || req.body.CallDirection || '').trim().toLowerCase();
    const isInbound = direction.includes('inbound');

    if (!workspaceId && isInbound && to) {
      workspaceId = await inboundForwardStats.findWorkspaceIdForDid(dbService, to);
    }

    const match = await findLeadForTelephonyEvent({ leadKey, workspaceId, from, to });
    if (match && callStatus) {
      await appendTelephonyUpdate(
        match,
        {
          type: action === 'voicemail_drop' ? 'voicemail_status' : 'call_status',
          value: `${action === 'voicemail_drop' ? 'Voicemail' : 'Call'} status: ${callStatus}`,
          from,
          to,
          callSid: sid,
          provider: 'signalwire',
        },
        callStatus === 'completed' ? { lastActivity: new Date().toISOString() } : null
      );
    }
    if (workspaceId && callStatus && !isInbound) {
      try {
        const ws = await dbService.getWorkspace(workspaceId);
        if (ws && ws.telephony && typeof ws.telephony === 'object') {
          const changed = dialerPacing.recordCallOutcome(ws.telephony, {
            from,
            to,
            callStatus,
            callSid: sid,
          });
          if (changed) await dbService.saveWorkspace(workspaceId, ws);
        }
      } catch (_) {
        /* non-fatal */
      }

      // Clean up agent session when the agent's call leg completes
      if (callStatus === 'completed' && sid) {
        const session = agentSessionStore.getSession(workspaceId);
        if (session && session.callSid === sid) {
          agentSessionStore.removeSession(workspaceId);
        }
      }
    }
    if (workspaceId && isInbound) {
      try {
        const ws = await dbService.getWorkspace(workspaceId);
        if (ws) {
          const changed = inboundForwardStats.recordInboundTerminalEvent(ws, req.body);
          if (changed) await dbService.saveWorkspace(workspaceId, ws);
        }
      } catch (_) {
        /* non-fatal */
      }
    }
    res.json({ success: true });
  } catch (err) {
    console.error('[telephony:voice:status]', err.message);
    res.json({ success: true });
  }
});

// POST /api/telephony/voice/recording-status — optional RecordingStatusCallback for live recordings
router.post('/telephony/voice/recording-status', async (req, res) => {
  try {
    if (!telephonyAuthorized(req)) return res.status(401).json({ success: false });
    res.status(204).end();
  } catch (err) {
    console.error('[telephony:voice:recording-status]', err.message);
    res.status(204).end();
  }
});

// POST /api/telephony/voice/amd — machine-detection updates
router.post('/telephony/voice/amd', async (req, res) => {
  try {
    if (!telephonyAuthorized(req)) return res.status(401).json({ success: false });
    const leadKey = String((req.query && req.query.leadKey) || '').trim();
    const workspaceId = String((req.query && req.query.workspaceId) || '').trim();
    const from = req.body.From || '';
    const to = req.body.To || '';
    const direction = String(req.body.Direction || req.body.CallDirection || '').trim().toLowerCase();
    const isInbound = direction.includes('inbound');
    const result =
      String(req.body.AnsweredBy || req.body.MachineDetectionResult || req.body.AmdStatus || '').trim() ||
      'unknown';
    const sid = String(req.body.CallSid || '').trim();
    const match = await findLeadForTelephonyEvent({ leadKey, workspaceId, from, to });
    if (match) {
      await appendTelephonyUpdate(match, {
        type: 'voicemail_amd',
        value: `Voicemail detection result: ${result}`,
        from,
        to,
        callSid: sid,
        provider: 'signalwire',
      });
    }
    if (workspaceId && !isInbound) {
      try {
        const ws = await dbService.getWorkspace(workspaceId);
        if (ws && ws.telephony && typeof ws.telephony === 'object') {
          const changed = dialerPacing.recordCallOutcome(ws.telephony, {
            from,
            to,
            callStatus: '',
            callSid: sid,
            answeredBy: result,
          });
          if (changed) await dbService.saveWorkspace(workspaceId, ws);
        }
      } catch (_) {
        /* non-fatal */
      }
    }
    res.json({ success: true });
  } catch (err) {
    console.error('[telephony:voice:amd]', err.message);
    res.json({ success: true });
  }
});

// POST|GET /api/telephony/voice/twiml — dynamic call script for calls/voicemail drops
router.all('/telephony/voice/twiml', async (req, res) => {
  try {
    if (!telephonyAuthorized(req)) return res.status(401).send('Unauthorized');
    const q = req.query || {};
    const agentFirst = String(q.agentFirst || '').trim() === '1';
    if (agentFirst) {
      const dialTo = signalwire.normalizePhone(q.dialTo || '');
      const bridgeFrom = signalwire.normalizePhone(q.bridgeFrom || '');
      if (!dialTo) {
        return res
          .type('text/xml')
          .send(
            '<?xml version="1.0" encoding="UTF-8"?><Response><Say>Missing destination number.</Say><Hangup/></Response>',
          );
      }
      const callerId =
        signalwire.normalizePhone(q.leadCallerId || '') ||
        bridgeFrom ||
        String(process.env.SIGNALWIRE_FROM_NUMBER || '').trim();
      const workspaceId = String(q.workspaceId || '').trim();
      const isSession = String(q.session || '').trim() === '1';

      let dialExtra = '';
      if (isSession && workspaceId) {
        const waitUrl = signalwire.buildAppUrl('/api/telephony/voice/twiml/wait', {
          workspaceId,
          from: callerId,
        });
        if (waitUrl) {
          dialExtra = ` action="${xmlEscape(waitUrl)}"`;
        }
      }

      const n = `<?xml version="1.0" encoding="UTF-8"?><Response><Dial answerOnBridge="true" timeout="45" callerId="${xmlEscape(
        callerId,
      )}"${dialExtra}><Number>${xmlEscape(dialTo)}</Number></Dial></Response>`;
      return res.type('text/xml').send(n);
    }
    const action = String((q && q.action) || 'call').trim();
    const script = String(process.env.VOICEMAIL_DROP_SCRIPT || '').trim();
    const voiceLang = String(process.env.TELEPHONY_VOICE_LANGUAGE || 'en-US').trim();
    const voiceName = String(process.env.TELEPHONY_VOICE_NAME || 'alice').trim();
    const voicemailAudioUrl =
      String(
        (req.query && req.query.audioUrl) ||
          process.env.VOICEMAIL_DROP_AUDIO_URL ||
          ''
      ).trim();
    const followupNumber = String(process.env.SIGNALWIRE_CALLBACK_NUMBER || process.env.SIGNALWIRE_FROM_NUMBER || '')
      .trim();

    let body = '<?xml version="1.0" encoding="UTF-8"?><Response>';
    if (action === 'voicemail_drop') {
      body += '<Pause length="2"/>';
      if (voicemailAudioUrl) {
        body += `<Play>${xmlEscape(voicemailAudioUrl)}</Play>`;
      } else if (script) {
        body += `<Say voice="${xmlEscape(voiceName)}" language="${xmlEscape(voiceLang)}">${xmlEscape(script)}</Say>`;
      } else {
        body += `<Say voice="${xmlEscape(voiceName)}" language="${xmlEscape(voiceLang)}">Hi, this is AdHello with a quick idea for your business. Please call us back at ${xmlEscape(followupNumber)}. We will follow up with a text as well. Thank you.</Say>`;
      }
      body += '<Hangup/>';
    } else {
      body += `<Say voice="${xmlEscape(voiceName)}" language="${xmlEscape(voiceLang)}">Hi, this is AdHello calling with a quick follow-up. Please call us back at ${xmlEscape(followupNumber)} or reply to our text message. Thank you.</Say>`;
      body += '<Hangup/>';
    }
    body += '</Response>';
    res.type('text/xml').send(body);
  } catch (err) {
    console.error('[telephony:voice:twiml]', err.message);
    res.type('text/xml').send('<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>');
  }
});

// POST|GET /api/telephony/voice/twiml/wait — session: called when lead hangs up, keeps agent on line
router.all('/telephony/voice/twiml/wait', async (req, res) => {
  try {
    if (!telephonyAuthorized(req)) return res.status(401).send('Unauthorized');
    const q = req.query || {};
    const workspaceId = String(q.workspaceId || '').trim();
    const from = String(q.from || '').trim();
    const pollUrl = signalwire.buildAppUrl('/api/telephony/voice/twiml/poll', { workspaceId, from });
    if (!pollUrl) {
      return res.type('text/xml').send(
        '<?xml version="1.0" encoding="UTF-8"?><Response><Say>Session error.</Say><Hangup/></Response>',
      );
    }
    res.type('text/xml').send(
      `<?xml version="1.0" encoding="UTF-8"?><Response><Redirect>${xmlEscape(pollUrl)}</Redirect></Response>`,
    );
  } catch (err) {
    console.error('[twiml:wait]', err.message);
    res.type('text/xml').send('<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>');
  }
});

// POST|GET /api/telephony/voice/twiml/poll — session: check for next queued lead
router.all('/telephony/voice/twiml/poll', async (req, res) => {
  try {
    if (!telephonyAuthorized(req)) return res.status(401).send('Unauthorized');
    const q = req.query || {};
    const workspaceId = String(q.workspaceId || '').trim();
    const from = String(q.from || process.env.SIGNALWIRE_FROM_NUMBER || '').trim();
    const voiceLang = String(process.env.TELEPHONY_VOICE_LANGUAGE || 'en-US').trim();
    const voiceName = String(process.env.TELEPHONY_VOICE_NAME || 'alice').trim();

    function pollAgain() {
      const u = signalwire.buildAppUrl('/api/telephony/voice/twiml/poll', { workspaceId, from });
      if (!u) {
        return '<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>';
      }
      return `<?xml version="1.0" encoding="UTF-8"?><Response><Pause length="3"/><Redirect>${xmlEscape(u)}</Redirect></Response>`;
    }

    const session = agentSessionStore.getSession(workspaceId);
    if (!session) {
      return res.type('text/xml').send(
        '<?xml version="1.0" encoding="UTF-8"?><Response><Say>Calling session ended. Goodbye.</Say><Hangup/></Response>',
      );
    }

    const nextLeadKey = agentSessionStore.popNextLead(workspaceId);
    if (!nextLeadKey) {
      return res.type('text/xml').send(pollAgain());
    }

    try {
      const lead = await dbService.getLead(nextLeadKey);
      if (!lead || !lead.phone) {
        // Lead not found or no phone — skip and poll again
        return res.type('text/xml').send(pollAgain());
      }

      const dialTo = signalwire.normalizePhone(lead.phone);
      const callerId = from;
      const waitUrl = signalwire.buildAppUrl('/api/telephony/voice/twiml/wait', { workspaceId, from: callerId });

      const dialAction = waitUrl ? ` action="${xmlEscape(waitUrl)}"` : '';

      res.type('text/xml').send(
        `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="${xmlEscape(voiceName)}" language="${xmlEscape(voiceLang)}">Next lead.</Say><Dial answerOnBridge="true" timeout="45" callerId="${xmlEscape(callerId)}"${dialAction}><Number>${xmlEscape(dialTo)}</Number></Dial></Response>`,
      );
    } catch (lookupErr) {
      console.error('[twiml:poll:lookup]', lookupErr.message);
      return res.type('text/xml').send(pollAgain());
    }
  } catch (err) {
    console.error('[twiml:poll]', err.message);
    res.type('text/xml').send('<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>');
  }
});

// ── Chat History API (for cross-platform context) ──────────────────────────────

// GET /api/chat/history — return CEO chat history (requires API key)
router.get('/chat/history', validateApiKey, (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const history = dbService.getChatHistory('ceo', limit);
    res.json({ success: true, messages: history });
  } catch (err) {
    console.error('[API CHAT HISTORY] Error:', err.message);
    res.status(500).json({ error: 'Failed to load chat history.' });
  }
});

// POST /api/chat/message — add a message from another platform (e.g. Telegram relay)
router.post('/chat/message', validateApiKey, express.json(), (req, res) => {
  try {
    const { role, content, source } = req.body;
    if (!role || !content) {
      return res.status(400).json({ error: 'role and content are required.' });
    }
    const msg = dbService.saveChatMessage('ceo', role, content, source || 'api');
    res.json({ success: true, message: msg });
  } catch (err) {
    console.error('[API CHAT MESSAGE] Error:', err.message);
    res.status(500).json({ error: 'Failed to save message.' });
  }
});

// GET /api/chat/sync-status — check cross-platform sync health
router.get('/chat/sync-status', validateApiKey, async (req, res) => {
  try {
    const history = dbService.getChatHistory('ceo', 5);
    const lastMsg = history.length > 0 ? history[history.length - 1] : null;
    res.json({
      success: true,
      totalMessages: history.length,
      lastMessage: lastMsg,
      telegramConfigured: !!process.env.TELEGRAM_BOT_TOKEN,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get sync status.' });
  }
});

module.exports = router;
