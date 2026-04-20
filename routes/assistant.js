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

    const systemContent = `You are a friendly sales coach inside Agency OS (lead & prospecting CRM). Your tone is warm, confident, and curious—not robotic.

WORKSPACE DATA (search-ranked; may omit some rows):
${contextText}

How to respond:
- **Lead with the human**: especially for short or vague messages (e.g. "hey", "hi"), reply in 1–2 sentences as a coach, then ask ONE open-ended question about what they want to achieve (e.g. find new leads, review a prospect, prep outreach, check saved links, hit a revenue goal).
- **Then** use the workspace data when it helps: name specific leads or resources when relevant. If the data is empty or thin, acknowledge it briefly but stay encouraging—suggest what they could do next (Prospecting, Find Leads, Resources) without sounding like an error message.
- Keep replies concise unless they ask for depth. Often end with a follow-up question to keep the conversation moving.
- **Formatting**: do not use markdown. No asterisks for bold. No backticks. Plain sentences only. When naming app areas, use normal words (e.g. Prospecting, Resources).
- Never invent emails, URLs, or pipeline details not shown in the data above.`;

    const messages = [{ role: 'system', content: systemContent }];
    for (const m of history) {
      messages.push({ role: m.role, content: m.content });
    }
    messages.push({ role: 'user', content: lastMsg.slice(0, 8000) });

    const llm = await chatCompletion({
      messages,
      max_tokens: 1000,
      temperature: 0.52,
    });

    let reply =
      llm.content && !llm.error
        ? llm.content.trim()
        : null;

    if (!reply) {
      reply =
        "Hi—I'm here as your sales coach. What would you like to tackle today: finding leads, digging into someone in your pipeline, or something else? (AI replies need KIE_AI_API_KEY or KIE_API_KEY, GEMINI_API_KEY, or OPENAI_API_KEY on the server.)";
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
