/**
 * Fallback Pavlex replies via the general LLM chain (OpenRouter → KIE / Gemini / OpenAI)
 * when no tool-calling model answered. These providers get no native tools, so CRM tools
 * are offered through a text protocol and any <tool_call> blocks are executed in-process.
 */
const { chatCompletion, openRouterProviders, legacyProviders } = require('../llmClient');
const { executeCrmTool, getOpenAiFunctionTools } = require('../mcp/mcpToolExecutor');
const {
  stripThinking,
  looksLikeLeakedReasoning,
  extractTextToolCalls,
  sanitizeAssistantText,
  sanitizeHistory,
} = require('./pavlexReplyParse');
const mcpLogger = require('../mcp/mcpLogger');

const MAX_TEXT_TOOL_ROUNDS = 4;
const MAX_TOOL_RESULT_CHARS = 12000;

function firstSentence(text, max = 110) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  const cut = s.split(/(?<=[.!?])\s/)[0] || s;
  return cut.length > max ? `${cut.slice(0, max - 1)}…` : cut;
}

function textToolProtocol(tools) {
  const lines = tools.map((t) => {
    const fn = t.function;
    const props = (fn.parameters && fn.parameters.properties) || {};
    const required = new Set((fn.parameters && fn.parameters.required) || []);
    const params = Object.keys(props).map((k) => (required.has(k) ? `${k}*` : k));
    return `- ${fn.name}(${params.join(', ')}) — ${firstSentence(fn.description)}`;
  });
  return `

TOOL CALLING IN THIS MODE: native tool calls are unavailable, so run CRM tools with text. To run a tool, reply with ONLY one or more blocks like:
<tool_call>{"name": "suggest_daily_leads", "arguments": {"limit": 5}}</tool_call>
The results come back in the next message; then answer the user in plain words. Never put tool markup or your reasoning in a final answer.
TOOLS (* = required argument):
${lines.join('\n')}`;
}

const NO_TOOLS_NOTE = `

CRM tools are unavailable for this reply. Answer from the conversation only; if the user needs CRM data or an action, say you can't reach the CRM right now and suggest trying again.`;

function serializeToolResult(result) {
  const json = JSON.stringify(result);
  return json.length <= MAX_TOOL_RESULT_CHARS ? json : `${json.slice(0, MAX_TOOL_RESULT_CHARS)}… [truncated]`;
}

/**
 * @param {object} opts
 * @param {string} opts.instructions
 * @param {string} opts.message
 * @param {Array<{role:string,content:string}>} [opts.history]
 * @param {{ workspaceId: string, userEmail: string }|null} [opts.ctx] — enables text tool calls
 */
async function pavlexGeneralChat({ instructions, message, history = [], ctx = null }) {
  const providers = [...openRouterProviders(), ...legacyProviders()];
  if (!providers.length) return { content: null, error: true, detail: 'No LLM providers configured' };

  const tools = getOpenAiFunctionTools();
  const toolNames = new Set(tools.map((t) => t.function.name));
  const canRunTools = Boolean(ctx && ctx.workspaceId && ctx.userEmail);

  const system = String(instructions || '').trim() + (canRunTools ? textToolProtocol(tools) : NO_TOOLS_NOTE);
  const messages = [{ role: 'system', content: system }];
  messages.push(...sanitizeHistory(history, toolNames));
  messages.push({ role: 'user', content: String(message || '').trim() });

  const toolsUsed = [];
  const failures = [];
  let rounds = 0;

  for (const prov of providers) {
    for (;;) {
      // eslint-disable-next-line no-await-in-loop
      const out = await chatCompletion({
        messages,
        max_tokens: 900,
        temperature: 0.5,
        providersOverride: [prov],
        allowReasoningFallback: false,
      });
      if (!out.content || out.error) {
        failures.push(`${prov.name} ${prov.model || ''}: ${out.errorMessage || 'no reply'}`.trim());
        break;
      }

      const noThink = stripThinking(out.content);
      const parsed = canRunTools ? extractTextToolCalls(noThink, toolNames) : { calls: [], cleaned: noThink };

      if (parsed.calls.length && rounds < MAX_TEXT_TOOL_ROUNDS) {
        rounds += 1;
        mcpLogger.chatRuntime({ phase: 'text_tool_calls', provider: prov.name, tools: parsed.calls.map((c) => c.name) });
        const results = [];
        for (const call of parsed.calls) {
          toolsUsed.push(call.name);
          // eslint-disable-next-line no-await-in-loop
          const result = await executeCrmTool(ctx, call.name, call.arguments);
          results.push(`${call.name}: ${serializeToolResult(result)}`);
        }
        messages.push({ role: 'assistant', content: noThink });
        messages.push({
          role: 'user',
          content:
            `TOOL RESULTS (from the CRM, not from me):\n${results.join('\n')}\n\n` +
            'Now finish my request using these results. Use another <tool_call> only if you still need one.',
        });
        continue;
      }

      const text = sanitizeAssistantText(parsed.cleaned, toolNames);
      if (!text || looksLikeLeakedReasoning(text)) {
        failures.push(`${prov.name} ${prov.model || ''}: replied with reasoning instead of an answer`.trim());
        break;
      }
      return {
        content: text,
        provider: out.provider || prov.name,
        mcpEnabled: toolsUsed.length > 0,
        mcpMode: toolsUsed.length ? 'text_tools' : 'general_chat',
        toolsUsed,
      };
    }
  }

  return { content: null, error: true, detail: failures.join('; ') || 'General chat unavailable', toolsUsed };
}

module.exports = {
  pavlexGeneralChat,
  textToolProtocol,
};
