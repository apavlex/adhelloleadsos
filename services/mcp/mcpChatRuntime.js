/**
 * Unified Pavlex chat runtime: OpenAI Responses API + remote MCP, with inline CRM tool fallback.
 */
const { userEmail } = require('../workspaceService');
const { chatCompletion } = require('../llmClient');
const {
  getMcpServerUrl,
  resolveMcpBearerTokenForChat,
  isResponsesMcpReady,
} = require('./mcpConnection');
const { chiefOfStaffResponsesWithMcp } = require('./mcpResponsesClient');
const { inlineCrmToolChat } = require('./mcpInlineTools');
const mcpLogger = require('./mcpLogger');

/**
 * @param {object} opts
 * @param {import('express').Request} opts.req
 * @param {string} opts.instructions
 * @param {string} opts.message
 * @param {Array<{role:string,content:string}>} [opts.history]
 * @param {Array<{role:string,content:string}>} [opts.legacyMessages] — full messages for legacy fallback
 * @param {number} [opts.maxTokens]
 * @param {number} [opts.temperature]
 */
async function pavlexChatWithCrmTools({
  req,
  instructions,
  message,
  history = [],
  legacyMessages = null,
  maxTokens = 1200,
  temperature = 0.7,
}) {
  const ctx = {
    workspaceId: req.workspaceId,
    userEmail: userEmail(req),
  };
  const serverUrl = getMcpServerUrl(req);
  const sessionBearer = resolveMcpBearerTokenForChat(req);
  const openaiKey = String(process.env.OPENAI_API_KEY || '').trim();

  mcpLogger.chatRuntime({
    phase: 'start',
    workspaceId: ctx.workspaceId,
    userEmail: ctx.userEmail,
    serverUrl,
    hasSessionToken: Boolean(sessionBearer.token),
    hasOpenAiKey: Boolean(openaiKey),
  });

  if (openaiKey && sessionBearer.token) {
    if (isResponsesMcpReady({ serverUrl, bearerToken: sessionBearer.token, openaiApiKey: openaiKey })) {
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
        mcpLogger.chatRuntime({
          phase: 'responses_api_ok',
          provider: mcpOut.provider,
          toolActivity: mcpOut.toolActivity || null,
        });
        return {
          content: mcpOut.content,
          provider: mcpOut.provider,
          mcpEnabled: true,
          mcpMode: 'responses_remote',
        };
      }
      mcpLogger.chatRuntime({
        phase: 'responses_api_failed',
        detail: mcpOut.detail || 'unknown',
      });
    } else {
      mcpLogger.chatRuntime({
        phase: 'responses_api_skipped',
        reason: 'missing_server_url_or_config',
        serverUrl,
      });
    }

    mcpLogger.chatRuntime({ phase: 'inline_tools_fallback', workspaceId: ctx.workspaceId });
    const inlineOut = await inlineCrmToolChat({ instructions, message, history, ctx });
    if (inlineOut.content && !inlineOut.error) {
      return {
        content: inlineOut.content,
        provider: inlineOut.provider,
        mcpEnabled: true,
        mcpMode: 'inline_tools',
      };
    }
    mcpLogger.chatRuntime({
      phase: 'inline_tools_failed',
      detail: inlineOut.detail || 'unknown',
    });
  }

  if (legacyMessages) {
    mcpLogger.chatRuntime({ phase: 'legacy_fallback', workspaceId: ctx.workspaceId });
    const legacy = await chatCompletion({
      messages: legacyMessages,
      max_tokens: maxTokens,
      temperature,
      providerChain: 'legacy',
    });
    if (legacy.content && !legacy.error) {
      return {
        content: legacy.content,
        provider: legacy.provider || 'legacy',
        mcpEnabled: false,
        mcpMode: 'legacy_no_tools',
      };
    }
  }

  return {
    content: null,
    provider: 'none',
    mcpEnabled: false,
    mcpMode: 'unavailable',
    error: true,
  };
}

module.exports = {
  pavlexChatWithCrmTools,
};
