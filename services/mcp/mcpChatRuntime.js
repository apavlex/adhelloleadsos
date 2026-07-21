/**
 * Unified Pavlex chat runtime: OpenAI Responses API + remote MCP, with inline CRM tool fallback.
 * Never falls back to legacy LLM without tools for CRM questions.
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
const mcpLogger = require('./mcpLogger');

function responsesUsedTools(toolActivity) {
  if (!toolActivity) return false;
  return Array.isArray(toolActivity.toolCalls) && toolActivity.toolCalls.length > 0;
}

/**
 * @param {object} opts
 * @param {import('express').Request} opts.req
 * @param {string} opts.instructions
 * @param {string} opts.message
 * @param {Array<{role:string,content:string}>} [opts.history]
 * @param {number} [opts.maxTokens]
 * @param {number} [opts.temperature]
 */
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

  const openaiKey = String(process.env.OPENAI_API_KEY || '').trim();
  const crmRequired = isCrmIntent(message);
  const failures = [];

  mcpLogger.chatRuntime({
    phase: 'start',
    workspaceId: ctx.workspaceId,
    userEmail: ctx.userEmail,
    serverUrl,
    hasSessionToken: Boolean(sessionBearer.token),
    hasOpenAiKey: Boolean(openaiKey),
    configLoaded: Boolean(mcpConfig),
    crmRequired,
  });

  if (!openaiKey) {
    failures.push('OPENAI_API_KEY not configured');
  }

  if (!ctx.workspaceId || !ctx.userEmail) {
    failures.push('missing workspace or user context');
  }

  // Tier 0: Direct CRM tools (no OpenAI — list/count/search/read patterns)
  if (ctx.workspaceId && ctx.userEmail && crmRequired) {
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

  // Tier 1: OpenAI Responses API + remote MCP (when publicly reachable)
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
          toolsUsed: toolsUsed ? mcpOut.toolActivity.toolCalls.map((c) => c.name) : [],
        };
      }
      failures.push('Responses API answered without calling CRM tools');
      mcpLogger.chatRuntime({
        phase: 'responses_api_no_tools',
        crmRequired,
        toolActivity: mcpOut.toolActivity || null,
      });
    } else {
      failures.push(mcpOut.detail || 'Responses API failed');
      mcpLogger.chatRuntime({
        phase: 'responses_api_failed',
        detail: mcpOut.detail || 'unknown',
      });
    }
  } else if (openaiKey) {
    mcpLogger.chatRuntime({
      phase: 'responses_api_skipped',
      reason: 'missing_server_url_or_session_token',
      serverUrl,
    });
  }

  // Tier 2: Inline OpenAI function tools (always preferred fallback — executes CRM in-process)
  if (openaiKey && ctx.workspaceId && ctx.userEmail) {
    mcpLogger.chatRuntime({ phase: 'inline_tools', workspaceId: ctx.workspaceId, crmRequired });
    const inlineOut = await inlineCrmToolChat({
      instructions,
      message,
      history,
      ctx,
      requireTools: crmRequired,
    });

    if (inlineOut.content && !inlineOut.error) {
      mcpLogger.chatRuntime({
        phase: 'inline_tools_ok',
        provider: inlineOut.provider,
        toolsUsed: inlineOut.toolsUsed || [],
      });
      return {
        content: inlineOut.content,
        provider: inlineOut.provider,
        mcpEnabled: true,
        mcpMode: 'inline_tools',
        toolsUsed: inlineOut.toolsUsed || [],
      };
    }

    failures.push(inlineOut.detail || 'Inline CRM tools failed');
    mcpLogger.chatRuntime({
      phase: 'inline_tools_failed',
      detail: inlineOut.detail || 'unknown',
    });
  }

  const detail = failures.filter(Boolean).join('; ') || 'CRM tools unavailable';
  mcpLogger.chatRuntime({ phase: 'crm_unavailable', workspaceId: ctx.workspaceId, detail, crmRequired });

  if (crmRequired) {
    return {
      content: null,
      provider: 'none',
      mcpEnabled: false,
      mcpMode: 'crm_tools_required',
      error: true,
      detail,
      userMessage: crmUnavailableMessage(detail),
    };
  }

  return {
    content: null,
    provider: 'none',
    mcpEnabled: false,
    mcpMode: 'unavailable',
    error: true,
    detail,
    userMessage: 'AI unavailable. Configure OPENAI_API_KEY on the server.',
  };
}

module.exports = {
  pavlexChatWithCrmTools,
};
