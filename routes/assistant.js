const express = require('express');
const router = express.Router();
const workspaceService = require('../services/workspaceService');
const { chatCompletion } = require('../services/llmClient');
const { buildAssistantContext } = require('../services/assistantSearch');

router.post('/chat', express.json({ limit: '120kb' }), async (req, res) => {
  try {
    const email = workspaceService.userEmail(req);
    if (!email) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const wid = req.workspaceId;
    if (!wid) {
      return res.status(400).json({ error: 'No active workspace' });
    }

    const lastMsg = String(req.body.message || '').trim();
    let history = Array.isArray(req.body.history) ? req.body.history : [];
    history = history
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && m.content)
      .slice(-14)
      .map((m) => ({
        role: m.role,
        content: String(m.content).slice(0, 6000),
      }));

    if (!lastMsg) {
      return res.status(400).json({ error: 'message is required' });
    }

    const { contextText, citations } = await buildAssistantContext({
      workspaceId: wid,
      email,
      query: lastMsg,
    });

    const systemContent = `You are a concise assistant inside Agency OS (lead & prospecting CRM). You only know this workspace's data below.

WORKSPACE DATA (search-ranked; may omit some rows):
${contextText}

Rules:
- Use this data when answering about leads, contacts, or saved resources.
- Name specific leads/resources when relevant. Be brief unless asked for detail.
- If something is not in the data, say you don't see it in this workspace and point users to Prospecting or Resources in the app.
- Do not invent emails, URLs, or pipeline stages not shown above.`;

    const messages = [{ role: 'system', content: systemContent }];
    for (const m of history) {
      messages.push({ role: m.role, content: m.content });
    }
    messages.push({ role: 'user', content: lastMsg.slice(0, 8000) });

    const llm = await chatCompletion({
      messages,
      max_tokens: 1000,
      temperature: 0.35,
    });

    let reply =
      llm.content && !llm.error
        ? llm.content.trim()
        : null;

    if (!reply) {
      reply =
        'I matched items in your workspace (see links below), but no AI provider returned a reply. Set KIE_AI_API_KEY (or KIE_API_KEY), GEMINI_API_KEY, and/or OPENAI_API_KEY on the server — we try KIE first, then Gemini, then OpenAI.';
    }

    const citationsOut = citations.slice(0, 12);

    res.json({
      reply,
      citations: citationsOut,
      provider: llm.provider || 'none',
    });
  } catch (e) {
    console.warn('[assistant/chat]', e.message);
    res.status(500).json({ error: e.message || 'Server error' });
  }
});

module.exports = router;
