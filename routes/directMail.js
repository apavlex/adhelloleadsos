const express = require('express');
const router = express.Router();

const dbService = require('../services/database');
const workspaceIntegrations = require('../services/workspaceIntegrations');
const { filterLeadsForRequest } = require('../services/workspaceService');
const { excludeOutreachFolderLeads } = require('../services/leadListFilters');
const lobClient = require('../services/lobClient');
const lobDirectMail = require('../services/lobDirectMail');
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
    const mailableLeads = pipelineVisible
      .filter((l) => lobDirectMail.hasMailableAddress(l))
      .map((l) => ({
        key: l.key,
        title: l.title || 'Untitled',
        address: l.address || '',
        city: l.city || '',
        state: l.state || '',
        status: l.status || '',
        nextChannel: l.next_channel || '',
      }))
      .sort((a, b) => String(a.title).localeCompare(String(b.title)));

    res.render('direct-mail', {
      activePage: 'direct-mail',
      lobReady: ready,
      kieImageReady: kieImageClient.isConfigured(),
      mailableLeads,
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

Help the user brainstorm visuals and write a strong GPT Image 2 prompt. Images will be generated via KIE GPT Image 2 (text-to-image or image-to-image).

Respond with JSON only, no markdown:
{"reply":"2-4 sentences: coaching, questions, or creative direction","imagePrompt":"null or a detailed English prompt ready for GPT Image 2 — photorealistic or polished graphic design, specify layout, typography zones (leave space for headline if front), colors, mood, 4×6 postcard composition. Null if the user is still exploring ideas."}

Rules:
- imagePrompt must be null until the user wants to generate or asks for a final prompt.
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
      return res.status(502).json({ success: false, error: err.message });
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

module.exports = router;
