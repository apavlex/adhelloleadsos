const express = require('express');
const router = express.Router();

const dbService = require('../services/database');
const workspaceIntegrations = require('../services/workspaceIntegrations');
const { filterLeadsForRequest } = require('../services/workspaceService');
const { excludeOutreachFolderLeads } = require('../services/leadListFilters');
const { parseBulkSelectionKeys, orderLeadsByKeys, resolveLeadsBySelectedKeys } = require('../services/bulkSelectionKeys');
const lobClient = require('../services/lobClient');
const lobDirectMail = require('../services/lobDirectMail');
const directMailQueue = require('../services/directMailQueue');
const kieImageClient = require('../services/kieImageClient');
const { chatCompletion, parseLlmJson } = require('../services/llmClient');

function appendLeadUpdate(lead, entry) {
  const updates = Array.isArray(lead && lead.updates) ? [...lead.updates] : [];
  updates.push({ timestamp: new Date().toISOString(), ...entry });
  return updates;
}

function leadKeyFromParam(raw) {
  return String(raw || '').trim();
}

function collectRecentSends(leads, limit = 30) {
  const rows = [];
  for (const lead of leads) {
    const logs = Array.isArray(lead.logs) ? lead.logs : [];
    for (const log of logs) {
      if (!log || log.type !== 'direct_mail_outbound') continue;
      rows.push({
        leadKey: lead.key,
        title: lead.title || 'Lead',
        message: log.message || 'Postcard sent',
        timestamp: log.timestamp || '',
        postcardId: log.postcardId || '',
      });
    }
  }
  rows.sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
  return rows.slice(0, limit);
}

router.get('/', async (req, res, next) => {
  try {
    const integrationEnv = await workspaceIntegrations.getResolvedIntegrationEnv(req.workspaceId);
    const ready = lobDirectMail.directMailReady(integrationEnv);

    const all = await dbService.getAllLeads(req.workspaceId);
    const visible = filterLeadsForRequest(req, all);
    const pipelineVisible = excludeOutreachFolderLeads(visible);
    const selectedKeyOrder = parseBulkSelectionKeys(req.query.keys);
    const selectedOnly = selectedKeyOrder.length > 0;

    let tableLeads;
    let dmIsQueueSession = false;
    let dmQueueEmpty = false;

    if (selectedOnly) {
      tableLeads = await resolveLeadsBySelectedKeys({
        dbService,
        workspaceId: req.workspaceId,
        visibleLeads: visible,
        keyOrder: selectedKeyOrder,
      });
    } else {
      const queue = await directMailQueue.listDirectMailQueueLeads(req.workspaceId, visible);
      if (queue.leads.length) {
        dmIsQueueSession = true;
        const byKey = new Map(visible.map((l) => [l.key, l]));
        tableLeads = [];
        for (const q of queue.leads) {
          const lead = byKey.get(q.key);
          if (lead) tableLeads.push(lead);
        }
      } else {
        dmQueueEmpty = true;
        tableLeads = pipelineVisible.filter((l) => lobDirectMail.hasMailableAddress(l));
      }
    }

    const mailableLeads = tableLeads.map((l) => ({
      key: l.key,
      title: l.title || 'Untitled',
      address: l.address || '',
      city: l.city || '',
      state: l.state || '',
      status: l.status || '',
      nextChannel: l.next_channel || '',
      website: l.website || '',
      stitchDesignUrl: l.stitchDesignUrl || '',
      stitchScreenshotUrl: l.stitchScreenshotUrl || '',
      mailable: lobDirectMail.hasMailableAddress(l),
      preselected: selectedOnly,
    }));

    const mailableCount = mailableLeads.filter((l) => l.mailable).length;
    const skippedCount = selectedOnly ? mailableLeads.length - mailableCount : 0;

    res.render('direct-mail', {
      activePage: 'direct-mail',
      lobReady: ready,
      kieImageReady: kieImageClient.isConfigured(),
      mailableLeads,
      dmSelectionCount: selectedOnly ? selectedKeyOrder.length : null,
      dmIsSelectionSession: selectedOnly,
      dmIsQueueSession,
      dmQueueEmpty,
      dmMailableCount: mailableCount,
      dmSkippedCount: skippedCount,
      recentSends: collectRecentSends(visible),
      canManageWorkspace: !!req.canManageWorkspace,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/api/status', async (req, res, next) => {
  try {
    const integrationEnv = await workspaceIntegrations.getResolvedIntegrationEnv(req.workspaceId);
    const ready = lobDirectMail.directMailReady(integrationEnv);
    res.json({ success: true, ...ready, kieImageReady: kieImageClient.isConfigured() });
  } catch (err) {
    next(err);
  }
});

router.post('/api/design-chat', async (req, res, next) => {
  try {
    const body = req.body || {};
    const userMessage = String(body.message || '').trim();
    if (!userMessage) {
      return res.status(400).json({ success: false, error: 'Message is required.' });
    }

    const history = (Array.isArray(body.history) ? body.history : [])
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .slice(-12)
      .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));

    const slot = String(body.slot || 'front').toLowerCase() === 'back' ? 'back' : 'front';
    const headline = String(body.headline || '').trim();
    const bodyText = String(body.bodyText || '').trim();
    const ctaUrl = String(body.ctaUrl || '').trim();

    const messages = [
      {
        role: 'system',
        content: `You are a direct-mail postcard design coach for a local marketing agency. The user is designing a 4×6 postcard (${slot} side) to mail to local business owners.

Postcard copy context:
- Headline: ${headline || '(not set yet)'}
- Body: ${bodyText || '(not set yet)'}
- CTA URL: ${ctaUrl || '(none)'}

Merge tokens for per-recipient personalization (substituted at send time): {business}, {city}, {state}, {audit_url}. Use these in copy fields. For AI image prompts when mailing many leads, do not bake one specific business name into the artwork — leave the lower third clear for a text overlay with {business} and copy.

Help the user brainstorm visuals and write a strong GPT Image 2 prompt. Images will be generated via KIE GPT Image 2 (text-to-image or image-to-image).

Respond with JSON only, no markdown:
{"reply":"2-4 sentences: coaching, questions, or creative direction","imagePrompt":"null or a detailed English prompt ready for GPT Image 2 — photorealistic or polished graphic design, specify layout, typography zones (leave space for headline if front), colors, mood, 4×6 postcard composition. Null if the user is still exploring ideas."}

Rules:
- imagePrompt must be null until the user wants to generate or asks for a final prompt.
- If the user asks you to generate, create, or make the design (e.g. "make it for me", "generate it", "go ahead"), set imagePrompt from the conversation so far — do not leave it null.
- When writing imagePrompt, optimize for print: high contrast, readable at postcard size, professional local-business marketing aesthetic.
- For the back side, assume minimal copy and return-address / compliance space unless the user says otherwise.
- Escape double quotes inside strings as \\".`,
      },
      ...history,
      { role: 'user', content: userMessage.slice(0, 4000) },
    ];

    const ai = await chatCompletion({ messages, jsonObject: true, max_tokens: 900, temperature: 0.65 });
    if (!ai.content) {
      return res.status(502).json({
        success: false,
        error: ai.error || 'Design coach is unavailable. Check AI provider keys on the server.',
      });
    }

    const parsed = parseLlmJson(ai.content) || {};
    res.json({
      success: true,
      reply: String(parsed.reply || 'Tell me more about the look you want — brand colors, photo vs illustration, and the main hook.').trim(),
      imagePrompt: parsed.imagePrompt ? String(parsed.imagePrompt).trim() : null,
      provider: ai.provider || null,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/api/generate-image', async (req, res, next) => {
  try {
    if (!kieImageClient.isConfigured()) {
      return res.status(400).json({
        success: false,
        error: 'KIE API key is not configured. Set KIE_AI_API_KEY or KIE_API_KEY on the server.',
      });
    }

    const body = req.body || {};
    const prompt = String(body.prompt || '').trim();
    if (!prompt) {
      return res.status(400).json({ success: false, error: 'Image prompt is required.' });
    }
    if (kieImageClient.isVagueImagePrompt(prompt)) {
      return res.status(400).json({
        success: false,
        error: kieImageClient.friendlyKieImageError('', { prompt }),
      });
    }

    const slot = String(body.slot || 'front').toLowerCase() === 'back' ? 'back' : 'front';
    const aspectRatio = String(body.aspectRatio || '2:3').trim() || '2:3';
    const resolution = String(body.resolution || '2K').trim() || '2K';
    const inputUrls = Array.isArray(body.inputUrls)
      ? body.inputUrls.map((u) => String(u || '').trim()).filter(Boolean)
      : body.referenceUrl
        ? [String(body.referenceUrl).trim()].filter(Boolean)
        : [];

    const result = await kieImageClient.generate({
      prompt,
      inputUrls,
      aspectRatio,
      resolution,
      maxWaitMs: 120000,
      intervalMs: 4000,
    });

    res.json({
      success: true,
      slot,
      taskId: result.taskId,
      model: result.model,
      imageUrl: result.imageUrl,
      urls: result.urls,
    });
  } catch (err) {
    if (err && err.message) {
      const friendly =
        err.kieFriendly || kieImageClient.friendlyKieImageError(err.message, {
          prompt: req.body && req.body.prompt,
        });
      return res.status(err.status === 400 ? 400 : 502).json({ success: false, error: friendly });
    }
    next(err);
  }
});

router.post('/api/send', async (req, res, next) => {
  try {
    const keys = Array.isArray(req.body && req.body.keys)
      ? req.body.keys.map((k) => String(k || '').trim()).filter(Boolean)
      : req.body && req.body.key
        ? [String(req.body.key).trim()].filter(Boolean)
        : [];
    if (!keys.length) {
      return res.status(400).json({ success: false, error: 'Select at least one lead.' });
    }

    const integrationEnv = await workspaceIntegrations.getResolvedIntegrationEnv(req.workspaceId);
    if (!lobClient.isConfigured(integrationEnv)) {
      return res.status(400).json({
        success: false,
        error: 'Connect Lob in Workspace → Integrations before sending mail.',
      });
    }

    const headline = String((req.body && req.body.headline) || '').trim();
    const bodyText = String((req.body && req.body.bodyText) || '').trim();
    const ctaUrl = String((req.body && req.body.ctaUrl) || '').trim();
    const frontImageUrl = String((req.body && req.body.frontImageUrl) || '').trim();
    const backImageUrl = String((req.body && req.body.backImageUrl) || '').trim();
    const personalizeOverlay = req.body && req.body.personalizeOverlay !== false;

    const results = [];
    for (const key of keys) {
      const fullKey = leadKeyFromParam(key);
      const lead = await dbService.getLead(fullKey);
      if (!lead) {
        results.push({ key: fullKey, ok: false, error: 'Lead not found' });
        continue;
      }
      try {
        const sent = await lobDirectMail.sendPostcardToLead({
          lead,
          integrationEnv,
          headline: headline || undefined,
          bodyText: bodyText || undefined,
          ctaUrl: ctaUrl || undefined,
          frontImageUrl: frontImageUrl || undefined,
          backImageUrl: backImageUrl || undefined,
          personalizeOverlay,
        });
        const updates = appendLeadUpdate(lead, {
          type: 'direct_mail_outbound',
          value: sent.postcardId || 'postcard',
          provider: 'lob',
          postcardId: sent.postcardId || '',
        });
        await dbService.updateLead(fullKey, {
          status: lead.status === 'Not Contacted' ? 'Mail Sent' : lead.status,
          updates,
          logs: [
            {
              type: 'direct_mail_outbound',
              message: `Lob postcard queued${sent.postcardId ? ` (${sent.postcardId})` : ''}${sent.testMode ? ' [test]' : ''}`,
              timestamp: new Date().toISOString(),
              postcardId: sent.postcardId || '',
              provider: 'lob',
            },
          ],
        });
        results.push({
          key: fullKey,
          ok: true,
          postcardId: sent.postcardId,
          expectedDeliveryDate: sent.expectedDeliveryDate,
          testMode: sent.testMode,
        });
      } catch (e) {
        results.push({ key: fullKey, ok: false, error: e && e.message ? e.message : 'Send failed' });
      }
    }

    const okCount = results.filter((r) => r.ok).length;
    res.json({
      success: okCount > 0,
      sent: okCount,
      failed: results.length - okCount,
      results,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/api/queue', express.json(), async (req, res, next) => {
  try {
    const leadKeysRaw = Array.isArray(req.body && req.body.leadKeys) ? req.body.leadKeys : [];
    const leadKeys = leadKeysRaw.map((k) => String(k || '').trim()).filter(Boolean);
    if (!leadKeys.length) {
      return res.status(400).json({ success: false, error: 'leadKeys is required.' });
    }

    const all = await dbService.getAllLeads(req.workspaceId);
    const visible = filterLeadsForRequest(req, all);
    const result = await directMailQueue.addLeadsToDirectMailQueue(req.workspaceId, leadKeys, visible);

    if (!result.leads.length && leadKeys.length) {
      return res.status(404).json({
        success: false,
        error: 'Could not queue those leads. Open a saved lead or check your access.',
        ...result,
      });
    }

    res.json({
      success: true,
      ...result,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/api/queue', async (req, res, next) => {
  try {
    const all = await dbService.getAllLeads(req.workspaceId);
    const visible = filterLeadsForRequest(req, all);
    const result = await directMailQueue.listDirectMailQueueLeads(req.workspaceId, visible);
    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
