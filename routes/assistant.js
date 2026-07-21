const express = require('express');
const router = express.Router();
const workspaceService = require('../services/workspaceService');
const { pavlexChatWithCrmTools } = require('../services/mcp/mcpChatRuntime');
const { runMcpDiagnostics } = require('../services/mcp/mcpDiagnostics');
const { buildAssistantContext } = require('../services/assistantSearch');
const fs = require('fs');

const MEMORY_FILE = '/opt/data/memories/MEMORY.md';
const USER_FILE = '/opt/data/memories/USER.md';

function readMemoryFile(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return raw.split('§').map(s => s.trim()).filter(Boolean).join('\n');
  } catch {
    return '';
  }
}

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

    // ── Build shared context: memory files + workspace data ──
    const memoryCtx = readMemoryFile(MEMORY_FILE);
    const userCtx = readMemoryFile(USER_FILE);
    const { contextText, citations } = await buildAssistantContext({
      workspaceId: wid,
      email,
      query: lastMsg,
    });

    const systemContent = `You are Pavlex, the AI Chief of Staff for Alex Pavlenko. You operate across all his ventures: AdHello.ai agency, personal brand, futures trading coach, coffee shop, and client consulting.

You have the SAME memory and context as the Hermes agent on Telegram and the CEO Command Center chat. When Alex talks to you here, it should feel identical — same knowledge, same tasks, same personality.

USER PROFILE:
${userCtx}

MEMORY / CONTEXT:
${memoryCtx}

CURRENT SESSION:
- Platform: Agency OS floating chat (sales coach widget)
- User: Alex Pavlenko (logged in)
- Time: ${new Date().toISOString()}

WORKSPACE DATA (leads, pipeline, resources):
${contextText}

RULES:
- Be extremely concise. One-word directions from Alex are normal.
- Immediate action over analysis. Strategy → execute.
- You can see the user's leads, pipeline, and resources above. Reference them naturally.
- You have live CRM MCP tools for folders, lead counts, listing leads, search, read, and update. Use them when Alex asks about pipeline data.
- If Alex asks you to do something (create task, research, write content), DO it — don't suggest.
- Keep responses under 300 words unless asked for detail.
- Same tone as Telegram: direct, pragmatic, no hand-holding.
- Plain text only. No markdown asterisks or backticks. Normal sentences.`;

    const messages = [{ role: 'system', content: systemContent }];
    for (const m of history) {
      messages.push({ role: m.role, content: m.content });
    }
    messages.push({ role: 'user', content: lastMsg.slice(0, 8000) });

    const chatOut = await pavlexChatWithCrmTools({
      req,
      instructions: systemContent,
      message: lastMsg.slice(0, 8000),
      history,
      legacyMessages: messages,
      maxTokens: 1000,
      temperature: 0.52,
    });

    let reply = '';
    if (chatOut.content && !chatOut.error) {
      reply = String(chatOut.content).replace(/\0/g, '').trim();
    }
    if (!reply) {
      reply = "I'm here. What do you want to work on?";
    }

    const citationsOut = citations.slice(0, 12);

    res.json({
      reply: reply,
      citations: citationsOut,
      provider: chatOut.provider || 'none',
      mcpEnabled: !!chatOut.mcpEnabled,
      mcpMode: chatOut.mcpMode || null,
      llmDegraded: !chatOut.content || chatOut.error,
    });
  } catch (e) {
    console.warn('[assistant/chat]', e.message);
    res.status(500).json({ error: e.message || 'Server error' });
  }
});

router.get('/mcp-diagnostics', async (req, res, next) => {
  try {
    const report = await runMcpDiagnostics(req);
    res.json({ success: true, ...report });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
