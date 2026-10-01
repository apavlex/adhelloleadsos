/**
 * Unified Pavlex chat runtime: direct CRM → inline tool calling → general chain with text tools.
 * CRM tools always run in-process (executeCrmTool); the in-app chat never calls /ceo/mcp over HTTP.
 */
const { userEmail } = require('../workspaceService');
const { inlineCrmToolChat } = require('./mcpInlineTools');
const { isCrmIntent, chatUnavailableMessage } = require('../pavlex/pavlexCrmIntent');
const { tryDirectCrmChat } = require('../pavlex/pavlexCrmDirect');
const { hasPavlexToolLlm } = require('../pavlex/pavlexLlmConfig');
const { pavlexGeneralChat } = require('../pavlex/pavlexGeneralChat');
const mcpLogger = require('./mcpLogger');

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

  const toolLlmReady = hasPavlexToolLlm();
  const crmRequired = isCrmIntent(message);
  const hasCtx = Boolean(ctx.workspaceId && ctx.userEmail);
  const failures = [];

  mcpLogger.chatRuntime({
    phase: 'start',
    workspaceId: ctx.workspaceId,
    userEmail: ctx.userEmail,
    hasToolLlm: toolLlmReady,
    configLoaded: Boolean(mcpConfig),
    crmRequired,
  });

  if (!hasCtx) failures.push('missing workspace or user context');

  // Tier 0: Direct CRM tools (no LLM)
  if (hasCtx) {
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

  // Tier 1: native function calling over tool-capable models (OpenAI / OpenRouter)
  if (toolLlmReady && hasCtx) {
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
        model: inlineOut.model,
        mcpEnabled: true,
        mcpMode: 'inline_tools',
        toolsUsed: inlineOut.toolsUsed || [],
      };
    }

    failures.push(inlineOut.detail || 'Inline CRM tools failed');
    if (inlineOut.toolsUsed && inlineOut.toolsUsed.length) {
      // Tools already ran (possibly writes); don't replay the request on another chain.
      return failed({ ctx, failures, crmRequired, toolsUsed: inlineOut.toolsUsed });
    }
  } else if (!toolLlmReady) {
    failures.push('No LLM key (OPENAI_API_KEY or OPENROUTER_API_KEY)');
  }

  // Tier 2: general chain (OpenRouter → KIE / Gemini / OpenAI) with text tool calls
  mcpLogger.chatRuntime({ phase: 'general_chat', workspaceId: ctx.workspaceId });
  const generalOut = await pavlexGeneralChat({
    instructions,
    message,
    history,
    ctx: hasCtx ? ctx : null,
  });
  if (generalOut.content && !generalOut.error) {
    if (!crmRequired || (generalOut.toolsUsed && generalOut.toolsUsed.length)) {
      return generalOut;
    }
    failures.push('General chat answered a CRM request without calling CRM tools');
  } else {
    failures.push(generalOut.detail || 'General chat failed');
  }

  return failed({ ctx, failures, crmRequired, toolsUsed: generalOut.toolsUsed || [] });
}

function failed({ ctx, failures, crmRequired, toolsUsed = [] }) {
  const detail = failures.filter(Boolean).join('; ') || 'unavailable';
  mcpLogger.chatRuntime({ phase: 'failed', workspaceId: ctx.workspaceId, detail, crmRequired });
  return {
    content: null,
    provider: 'none',
    mcpEnabled: false,
    mcpMode: crmRequired ? 'crm_tools_required' : 'unavailable',
    error: true,
    detail,
    toolsUsed,
    userMessage: chatUnavailableMessage(detail, { toolsRan: toolsUsed.length > 0 }),
  };
}

module.exports = {
  pavlexChatWithCrmTools,
};
