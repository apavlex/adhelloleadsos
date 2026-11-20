/**
 * Pavlex agent API — central AI gateway for all website chat surfaces.
 */
const express = require('express');
const router = express.Router();
const { runPavlexChat } = require('../services/pavlex/pavlexAgent');
const { assertPavlexAuth } = require('../services/pavlex/pavlexAuth');
const { pinPavlexWorkspace } = require('../services/pavlex/pavlexWorkspaceScope');
const pavlexConversations = require('../services/pavlex/pavlexConversations');
const {
  listEmployees,
  DEFAULT_EMPLOYEE_ID,
  resolveEmployeeId,
} = require('../services/pavlex/pavlexEmployees');
const employeeStore = require('../services/pavlex/pavlexEmployeeStore');
const { buildGrokHandoff } = require('../services/pavlex/pavlexGrokHandoff');

router.get('/employees', async (req, res, next) => {
  try {
    await pinPavlexWorkspace(req, req.query.workspaceId);
    const auth = assertPavlexAuth(req);
    res.json({
      success: true,
      defaultEmployeeId: DEFAULT_EMPLOYEE_ID,
      employees: listEmployees(auth.workspaceId),
    });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ success: false, error: err.message });
    }
    next(err);
  }
});

router.post('/employees', express.json({ limit: '64kb' }), async (req, res, next) => {
  try {
    await pinPavlexWorkspace(req, req.body.workspaceId);
    const auth = assertPavlexAuth(req);
    if (!req.canManageWorkspace) {
      return res.status(403).json({ success: false, error: 'Only owners or admins can add custom employees.' });
    }
    const employee = employeeStore.upsertWorkspaceEmployee(auth.workspaceId, req.body);
    res.status(201).json({ success: true, employee, employees: listEmployees(auth.workspaceId) });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ success: false, error: err.message });
    }
    next(err);
  }
});

router.delete('/employees/:id', async (req, res, next) => {
  try {
    await pinPavlexWorkspace(req, req.query.workspaceId || req.body.workspaceId);
    const auth = assertPavlexAuth(req);
    if (!req.canManageWorkspace) {
      return res.status(403).json({ success: false, error: 'Only owners or admins can remove custom employees.' });
    }
    const ok = employeeStore.deleteWorkspaceEmployee(auth.workspaceId, req.params.id);
    if (!ok) return res.status(404).json({ success: false, error: 'Custom employee not found.' });
    res.json({ success: true, employees: listEmployees(auth.workspaceId) });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ success: false, error: err.message });
    }
    next(err);
  }
});

/** Paste into Grok / xAI so the agent keeps working via MCP after AdHello is closed. */
router.post('/handoff', express.json({ limit: '32kb' }), async (req, res, next) => {
  try {
    await pinPavlexWorkspace(req, req.body.workspaceId);
    const auth = assertPavlexAuth(req);
    const employeeId = resolveEmployeeId(req.body.employeeId, auth.workspaceId);
    const handoff = await buildGrokHandoff(req, auth, {
      employeeId,
      conversationId: req.body.conversationId,
      createToken: req.body.createToken !== false,
    });
    res.json({ success: true, ...handoff });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ success: false, error: err.message });
    }
    next(err);
  }
});

router.post('/chat', express.json({ limit: '120kb' }), async (req, res, next) => {
  try {
    assertPavlexAuth(req);
    await pinPavlexWorkspace(req, req.body.workspaceId);

    const message = String(req.body.message || '').trim();
    let history = Array.isArray(req.body.history) ? req.body.history : [];
    history = history
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && m.content)
      .slice(-14)
      .map((m) => ({
        role: m.role,
        content: String(m.content).slice(0, 6000),
      }));

    let conversationId = String(req.body.conversationId || '').trim() || undefined;
    const platformRaw = String(req.body.platform || 'global').toLowerCase();
    const platform =
      platformRaw === 'assistant'
        ? 'assistant'
        : platformRaw === 'automate'
          ? 'automate'
          : platformRaw === 'chat'
            ? 'chat'
            : 'global';
    const page = String(req.body.page || '').trim().slice(0, 500) || undefined;
    const pageTitle = String(req.body.pageTitle || '').trim().slice(0, 200) || undefined;
    const ui =
      req.body.ui && typeof req.body.ui === 'object' && !Array.isArray(req.body.ui)
        ? req.body.ui
        : null;
    const auth = assertPavlexAuth(req);
    let employeeId = resolveEmployeeId(req.body.employeeId, auth.workspaceId);
    let createdConversation = null;
    if (conversationId) {
      const existing = pavlexConversations.getConversation(auth.workspaceId, auth.email, conversationId);
      if (!existing) {
        return res.status(404).json({ success: false, error: 'Conversation not found.' });
      }
      // Lock the employee to whoever started this chat.
      employeeId = resolveEmployeeId(existing.employeeId || employeeId, auth.workspaceId);
    } else if (platform === 'chat' && message) {
      createdConversation = pavlexConversations.createConversation(auth.workspaceId, auth.email, {
        employeeId,
      });
      conversationId = createdConversation.id;
    }
    if (conversationId) {
      const stored = pavlexConversations.getConversationMessages(auth.workspaceId, auth.email, conversationId, 14);
      if (stored && stored.length) {
        history = stored.map((m) => ({ role: m.role, content: String(m.content).slice(0, 6000) }));
      }
    }

    let result;
    try {
      result = await runPavlexChat(req, {
        message,
        history,
        conversationId,
        platform,
        page,
        pageTitle,
        ui,
        employeeId,
        persistHistory: platform === 'automate' || platform === 'global' || platform === 'chat',
      });
    } catch (err) {
      if (createdConversation) {
        pavlexConversations.deleteConversation(auth.workspaceId, auth.email, createdConversation.id);
      }
      throw err;
    }

    const conversation = conversationId
      ? pavlexConversations.recordExchange(auth.workspaceId, auth.email, conversationId, {
          userMessage: message,
          reply: result.reply,
          toolsUsed: result.toolsUsed,
        })
      : null;

    res.json({
      success: true,
      ...result,
      ...(conversation ? { conversation } : {}),
    });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({
        success: false,
        error: err.message,
        detail: err.detail || null,
      });
    }
    next(err);
  }
});

module.exports = router;
