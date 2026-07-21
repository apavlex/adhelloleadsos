/**
 * Unified Pavlex chat runtime: direct CRM → Responses MCP → inline tools → general chat.
 */
const { userEmail } = require('../workspaceService');
const {
  getMcpServerUrl,
  resolveMcpBearerTokenForChat,
  isResponsesMcpReady,
} = require('./mcpConnection');
const { chiefOfStaffResponsesWithMcp } = require('./mcpResponsesClient');
const { inlineCrmToolChat } = require('./mcpInlineTools');
const { isCrmIntent, crmUnavailableMessage } = require('../pavlex/pavlexCrmIntent');
const { tryDirectCrmChat } = require('../pavlex/pavlexCrmDirect');
const { hasPavlexToolLlm, resolveOpenAiDirectKey } = require('../pavlex/pavlexLlmConfig');
const { pavlexGeneralChat } = require('../pavlex/pavlexGeneralChat');
const mcpLogger = require('./mcpLogger');

function responsesUsedTools(toolActivity) {
  if (!toolActivity) return false;
  return Array.isArray(toolActivity.toolCalls) && toolActivity.toolCalls.length > 0;
}

function setupUnavailableMessage(detail) {
  const d = String(detail || '').toLowerCase();
  if (!hasPavlexToolLlm()) {
    return (
      'Pavlex needs an AI key on the server. Add OPENAI_API_KEY or OPENROUTER_API_KEY in Render → Environment, ' +
      'then redeploy. CRM shortcuts work now: "List my folders", "How many leads do I have?", "Find Acme Roofing".'
    );
  }
  if (d.includes('openai')) {
    return crmUnavailableMessage(detail);
  }
  return crmUnavailableMessage(detail);
}

async function pavlexChatWithCrmTools({
  req,
  instructions,
  message,
  history = [],
  mcpConfig = null,
  maxTokens = 1200,
  temperature = 0.7,
}) {
  const ctx = {
    workspaceId: req.workspaceId,
    userEmail: userEmail(req),
  };

  let serverUrl = getMcpServerUrl(req);
  let sessionBearer = resolveMcpBearerTokenForChat(req);

  if (mcpConfig) {
    if (mcpConfig.serverUrl) serverUrl = mcpConfig.serverUrl;
    if (mcpConfig.sessionToken) {
      sessionBearer = {
        token: mcpConfig.sessionToken,
        authMethod: mcpConfig.authMethod || 'session_token',
      };
    }
  }

  const openaiKey = resolveOpenAiDirectKey();
  const toolLlmReady = hasPavlexToolLlm();
  const crmRequired = isCrmIntent(message);
  const failures = [];

  mcpLogger.chatRuntime({
    phase: 'start',
    workspaceId: ctx.workspaceId,
    userEmail: ctx.userEmail,
    serverUrl,
    hasSessionToken: Boolean(sessionBearer.token),
    hasOpenAiKey: Boolean(openaiKey),
    hasToolLlm: toolLlmReady,
    configLoaded: Boolean(mcpConfig),
    crmRequired,
  });

  if (!toolLlmReady) {
    failures.push('No LLM key (OPENAI_API_KEY or OPENROUTER_API_KEY)');
  }

  if (!ctx.workspaceId || !ctx.userEmail) {
    failures.push('missing workspace or user context');
  }

  // Tier 0: Direct CRM tools (no LLM)
  if (ctx.workspaceId && ctx.userEmail) {
    mcpLogger.chatRuntime({ phase: 'direct_tools', workspaceId: ctx.workspaceId });
    const directOut = await tryDirectCrmChat(ctx, message);
    if (directOut && directOut.content && !directOut.error) {
      mcpLogger.chatRuntime({
        phase: 'direct_tools_ok',
        toolsUsed: directOut.toolsUsed || [],
      });
      return directOut;
    }
    if (directOut && directOut.error && directOut.detail) {
      failures.push(directOut.detail);
    }
  }

  // Tier 1: OpenAI Responses API + remote MCP
  if (
    openaiKey &&
    sessionBearer.token &&
    isResponsesMcpReady({ serverUrl, bearerToken: sessionBearer.token, openaiApiKey: openaiKey })
  ) {
    mcpLogger.chatRuntime({ phase: 'responses_api', workspaceId: ctx.workspaceId });
    const mcpOut = await chiefOfStaffResponsesWithMcp({
      instructions,
      message,
      history,
      serverUrl,
      bearerToken: sessionBearer.token,
      workspaceId: ctx.workspaceId,
      userEmail: ctx.userEmail,
    });

    if (mcpOut.content && !mcpOut.error) {
      const toolsUsed = responsesUsedTools(mcpOut.toolActivity);
      if (!crmRequired || toolsUsed) {
        return {
          content: mcpOut.content,
          provider: mcpOut.provider,
          mcpEnabled: true,
          mcpMode: 'responses_remote',
          toolsUsed: toolsUsed ? mcpOut.toolActivity.toolCalls.map((c) => c.name) : [],
        };
      }
      failures.push('Responses API answered without calling CRM tools');
    } else {
      failures.push(mcpOut.detail || 'Responses API failed');
    }
  }

  // Tier 2: Inline function tools (OpenAI or OpenRouter)
  if (toolLlmReady && ctx.workspaceId && ctx.userEmail) {
    mcpLogger.chatRuntime({ phase: 'inline_tools', workspaceId: ctx.workspaceId, crmRequired });
    const inlineOut = await inlineCrmToolChat({
      instructions,
      message,
      history,
      ctx,
      requireTools: crmRequired,
    });

    if (inlineOut.content && !inlineOut.error) {
      return {
        content: inlineOut.content,
        provider: inlineOut.provider,
        mcpEnabled: true,
        mcpMode: 'inline_tools',
        toolsUsed: inlineOut.toolsUsed || [],
      };
    }

    failures.push(inlineOut.detail || 'Inline CRM tools failed');
  }

  const detail = failures.filter(Boolean).join('; ') || 'unavailable';

  // Tier 3: General chat (non-CRM) via OpenRouter / KIE / Gemini
  if (!crmRequired) {
    mcpLogger.chatRuntime({ phase: 'general_chat', workspaceId: ctx.workspaceId });
    const generalOut = await pavlexGeneralChat({ instructions, message, history });
    if (generalOut.content && !generalOut.error) {
      return generalOut;
    }
    failures.push(generalOut.detail || 'General chat failed');
  }

  mcpLogger.chatRuntime({ phase: 'failed', workspaceId: ctx.workspaceId, detail, crmRequired });

  return {
    content: null,
    provider: 'none',
    mcpEnabled: false,
    mcpMode: crmRequired ? 'crm_tools_required' : 'unavailable',
    error: true,
    detail,
    userMessage: setupUnavailableMessage(detail),
  };
}

module.exports = {
  pavlexChatWithCrmTools,
};
