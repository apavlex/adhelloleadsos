/**
 * Build a pasteable "continue in Grok" packet so the external Grok / xAI agent
 * can keep working against AdHello via MCP after the browser is closed.
 */
const { getMcpServerUrl } = require('../mcp/connection');
const { createAgentMcpToken } = require('../mcp/mcpAuth');
const { getEmployee } = require('./pavlexEmployees');
const conversations = require('./pavlexConversations');

function clip(text, max) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

function formatHistory(messages, limit = 12) {
  const rows = Array.isArray(messages) ? messages.slice(-limit) : [];
  if (!rows.length) return '(no prior messages in this AdHello chat)';
  return rows
    .map((m) => {
      const role = m.role === 'assistant' ? 'Assistant' : 'User';
      return `${role}: ${clip(m.content, 500)}`;
    })
    .join('\n');
}

/**
 * @param {import('express').Request} req
 * @param {object} auth
 * @param {{ employeeId?: string, conversationId?: string, createToken?: boolean }} opts
 */
async function buildGrokHandoff(req, auth, opts = {}) {
  const employee = getEmployee(opts.employeeId, auth.workspaceId);
  const conversationId = String(opts.conversationId || '').trim() || null;
  let history = [];
  let conversation = null;
  if (conversationId) {
    conversation = conversations.getConversation(auth.workspaceId, auth.email, conversationId);
    if (!conversation) {
      const err = new Error('Conversation not found.');
      err.status = 404;
      throw err;
    }
    history = conversations.getConversationMessages(auth.workspaceId, auth.email, conversationId, 20) || [];
  }

  const endpoint = getMcpServerUrl(req) || '';
  let tokenPayload = null;
  if (opts.createToken !== false) {
    tokenPayload = await createAgentMcpToken(auth.workspaceId, {
      label: clip(employee.name, 40) || 'Grok',
      createdBy: auth.email,
    });
  }

  const workspaceName = String((req.workspace && req.workspace.name) || auth.workspaceId || '').trim();
  const lines = [
    `You are continuing my AdHello work as ${employee.name} (${employee.title}).`,
    employee.blurb ? `Specialty: ${employee.blurb}` : '',
    '',
    'Connect to my AdHello CRM workspace over MCP (Streamable HTTP, JSON-RPC 2.0) and keep working even when I close the AdHello app.',
    '',
    `Workspace: ${workspaceName}`,
    `Chat employee role: ${employee.name} (${employee.id})`,
    endpoint ? `Server URL: ${endpoint}` : 'Server URL: open AdHello → Settings → AI Connector and copy the connector URL',
    tokenPayload ? `Access token: ${tokenPayload.token}` : 'Access token: create an agent token named Grok under Settings → AI Connector',
    '',
    'Send every request as HTTP POST to the server URL with:',
    tokenPayload
      ? `Authorization: Bearer ${tokenPayload.token}`
      : 'Authorization: Bearer <your agent token>',
    'Content-Type: application/json',
    'Accept: application/json, text/event-stream',
    '',
    'Initialize, list tools, then call CRM tools to finish the work below. Prefer tools over guessing.',
    '',
    'Role instructions:',
    clip(employee.identityPrompt, 1200),
    '',
    'Recent AdHello chat to continue from:',
    formatHistory(history),
    '',
    'Pick up where we left off. Confirm the MCP connection with tools/list, then act.',
  ].filter((line, i, arr) => !(line === '' && arr[i - 1] === ''));

  return {
    employeeId: employee.id,
    employeeName: employee.name,
    conversationId: conversation ? conversation.id : null,
    endpoint: endpoint || null,
    token: tokenPayload
      ? {
          id: tokenPayload.id,
          label: tokenPayload.label,
          hint: tokenPayload.hint,
          value: tokenPayload.token,
        }
      : null,
    setupMessage: lines.join('\n'),
  };
}

module.exports = {
  buildGrokHandoff,
  formatHistory,
};
