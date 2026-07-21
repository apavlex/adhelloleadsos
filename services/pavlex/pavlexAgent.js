/**
 * Pavlex agent execution engine — central AI gateway with MCP CRM tools.
 */
const dbService = require('../database');
const { connectMCP, invokeMcpTool } = require('../mcp/client');
const { pavlexChatWithCrmTools } = require('../mcp/mcpChatRuntime');
const { assertPavlexAuth, resolvePavlexAuth } = require('./pavlexAuth');
const { buildPavlexContext } = require('./pavlexContext');
const { loadWorkspaceMcpConfig, loadMcpIntegrationRecord } = require('./pavlexMcpConfig');
const pavlexLogger = require('./pavlexLogger');
const { CRM_COMMAND_HINTS } = require('./pavlexConstants');

/**
 * @param {import('express').Request} req
 * @param {object} opts
 * @param {string} opts.message
 * @param {Array<{role:string,content:string}>} [opts.history]
 * @param {string} [opts.conversationId]
 * @param {'automate'|'assistant'|'global'} [opts.platform]
 * @param {string} [opts.page]
 * @param {boolean} [opts.persistHistory]
 */
async function runPavlexChat(req, opts) {
  const started = Date.now();
  const auth = assertPavlexAuth(req);
  const message = String(opts.message || '').trim();
  const history = Array.isArray(opts.history) ? opts.history : [];
  const conversationId = String(opts.conversationId || '').trim() || null;
  const platformRaw = String(opts.platform || 'global').toLowerCase();
  const platform =
    platformRaw === 'assistant' ? 'assistant' : platformRaw === 'automate' ? 'automate' : 'global';
  const page = String(opts.page || '').trim().slice(0, 500);
  const persistHistory =
    opts.persistHistory !== false && (platform === 'automate' || platform === 'global');

  if (!message) {
    const err = new Error('Message is required.');
    err.status = 400;
    throw err;
  }

  const { instructions, mcpConfig } = await buildPavlexContext(req, auth, {
    platform,
    message,
    page,
  });

  const connection = await connectMCP({
    serverUrl: mcpConfig.serverUrl,
    token: mcpConfig.sessionToken,
    userId: auth.userId,
    workspaceId: auth.workspaceId,
    userEmail: auth.email,
  });

  pavlexLogger.chatRequest({
    user: auth.email,
    workspaceId: auth.workspaceId,
    conversationId,
    question: message,
    mcpConnected: connection.connected,
    mcpMode: mcpConfig.responsesMcpReady ? 'responses_remote' : 'inline_tools',
  });

  const chatOut = await pavlexChatWithCrmTools({
    req,
    instructions,
    message,
    history: history.slice(-10),
    mcpConfig,
    maxTokens: platform === 'assistant' ? 1000 : 1200,
    temperature: platform === 'assistant' ? 0.52 : 0.7,
  });

  if (!chatOut.content || chatOut.error) {
    pavlexLogger.error({
      user: auth.email,
      question: message,
      detail: chatOut.detail || chatOut.mcpMode || 'unavailable',
    });
    const err = new Error(
      chatOut.userMessage ||
        'CRM connection unavailable. MCP connection failed.',
    );
    err.status = 502;
    err.detail = chatOut.detail || chatOut.mcpMode || 'unavailable';
    throw err;
  }

  if (persistHistory) {
    const channel = conversationId || 'ceo';
    dbService.saveChatMessage(channel, 'user', message, 'web');
    dbService.saveChatMessage(channel, 'assistant', chatOut.content, 'web');
  }

  const latencyMs = Date.now() - started;
  pavlexLogger.chatResponse({
    user: auth.email,
    question: message,
    mcpEnabled: !!chatOut.mcpEnabled,
    provider: chatOut.provider,
    toolsUsed: chatOut.toolsUsed || [],
    latencyMs,
  });

  return {
    reply: chatOut.content,
    provider: chatOut.provider || 'none',
    mcpEnabled: !!chatOut.mcpEnabled,
    mcpMode: chatOut.mcpMode || null,
    toolsUsed: chatOut.toolsUsed || [],
    conversationId,
    user: {
      email: auth.email,
      workspaceId: auth.workspaceId,
      permissions: auth.permissions,
    },
    mcpConfig: {
      serverUrl: mcpConfig.serverUrl,
      authMethod: mcpConfig.authMethod,
      availableTools: mcpConfig.availableTools,
      connected: connection.connected,
    },
    latencyMs,
  };
}

/**
 * Spec-aligned MCP debug report with live tool probes.
 * @param {import('express').Request} req
 */
async function runPavlexMcpDebug(req) {
  const auth = resolvePavlexAuth(req);
  if (!auth.authenticated) {
    const err = new Error('Sign in required.');
    err.status = 401;
    throw err;
  }

  const mcpConfig = await loadWorkspaceMcpConfig(req);
  const integration = await loadMcpIntegrationRecord(req);

  const connection = await connectMCP({
    serverUrl: mcpConfig.serverUrl,
    token: mcpConfig.sessionToken,
    userId: auth.userId,
    workspaceId: auth.workspaceId,
    userEmail: auth.email,
  });

  const ctx = connection.ctx;
  const test = {};

  const listProbe = await invokeMcpTool(ctx, 'list_folders', {});
  test.list_folders = listProbe.ok ? 'success' : 'failed';

  const countAllProbe = await invokeMcpTool(ctx, 'count_leads', {});
  test.count_leads = countAllProbe.ok ? 'success' : 'failed';

  const countProbe = await invokeMcpTool(ctx, 'count_leads', { folder_name: 'Landscaping' });
  test.count_landscaping =
    countProbe.ok ? 'success' : countProbe.result && countProbe.result.code === 'NOT_FOUND' ? 'folder_not_found' : 'failed';

  const searchProbe = await invokeMcpTool(ctx, 'search_leads', { query: 'test', limit: 1 });
  test.search_leads = searchProbe.ok || (searchProbe.result && searchProbe.result.success) ? 'success' : 'failed';

  return {
    connected: connection.connected,
    user: auth.email,
    workspace: auth.workspaceId,
    server: mcpConfig.serverUrl,
    tools: connection.tools,
    transport: connection.transport,
    integration,
    test,
    probes: {
      list_folders: listProbe.result,
      count_leads: countAllProbe.result,
      count_landscaping: countProbe.result,
      search_leads: searchProbe.result,
    },
    permissions: auth.permissions,
    openaiConfigured: mcpConfig.openaiConfigured,
    runtimeReady: mcpConfig.runtimeReady,
  };
}

module.exports = {
  runPavlexChat,
  runPavlexMcpDebug,
  CRM_COMMAND_HINTS,
};
