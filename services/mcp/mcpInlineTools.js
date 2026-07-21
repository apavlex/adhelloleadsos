/**
 * In-process OpenAI function-calling fallback when Responses API remote MCP is unavailable.
 */
const { executeCrmTool, getOpenAiFunctionTools } = require('./mcpToolExecutor');
const mcpLogger = require('./mcpLogger');
const { defaultResponsesModel } = require('./mcpResponsesClient');

const MAX_TOOL_ROUNDS = 6;

function parseToolArguments(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(String(raw));
  } catch {
    return {};
  }
}

/**
 * @param {object} opts
 * @param {string} opts.instructions
 * @param {string} opts.message
 * @param {Array<{role:string,content:string}>} [opts.history]
 * @param {{ workspaceId: string, userEmail?: string }} opts.ctx
 */
async function inlineCrmToolChat({ instructions, message, history = [], ctx }) {
  const apiKey = String(process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey) {
    return {
      content: null,
      provider: 'openai-inline-tools',
      error: true,
      detail: 'OPENAI_API_KEY not configured for inline CRM tools.',
    };
  }

  const model = defaultResponsesModel();
  const tools = getOpenAiFunctionTools();
  mcpLogger.toolsDiscovered({
    workspaceId: ctx.workspaceId,
    tools: tools.map((t) => t.function.name),
    source: 'inline_openai',
  });

  const messages = [{ role: 'system', content: String(instructions || '').trim() }];
  for (const m of history || []) {
    if (m && (m.role === 'user' || m.role === 'assistant') && m.content) {
      messages.push({ role: m.role, content: String(m.content) });
    }
  }
  messages.push({ role: 'user', content: String(message || '').trim() });

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          tools,
          tool_choice: 'auto',
          temperature: 0.5,
          max_tokens: 1200,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg =
          (data && data.error && data.error.message) ||
          `OpenAI chat HTTP ${res.status}`;
        mcpLogger.transportError({ layer: 'inline_openai', error: msg });
        return { content: null, provider: 'openai-inline-tools', error: true, detail: msg };
      }

      const choice = data.choices && data.choices[0];
      const assistantMsg = choice && choice.message;
      if (!assistantMsg) {
        return {
          content: null,
          provider: 'openai-inline-tools',
          error: true,
          detail: 'Empty inline tool response.',
        };
      }

      messages.push(assistantMsg);

      const toolCalls = Array.isArray(assistantMsg.tool_calls) ? assistantMsg.tool_calls : [];
      if (!toolCalls.length) {
        const text = String(assistantMsg.content || '').trim();
        if (!text) {
          return {
            content: null,
            provider: 'openai-inline-tools',
            error: true,
            detail: 'Model returned no text.',
          };
        }
        return {
          content: text,
          provider: 'openai-inline-tools',
          error: false,
          model,
          toolRounds: round,
        };
      }

      for (const call of toolCalls) {
        const fn = call.function || {};
        const toolName = fn.name;
        const args = parseToolArguments(fn.arguments);
        const result = await executeCrmTool(ctx, toolName, args);
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify(result),
        });
      }
    }

    return {
      content: null,
      provider: 'openai-inline-tools',
      error: true,
      detail: 'Exceeded maximum CRM tool rounds.',
    };
  } catch (err) {
    mcpLogger.transportError({ layer: 'inline_openai', error: err.message });
    return {
      content: null,
      provider: 'openai-inline-tools',
      error: true,
      detail: err.message || 'Inline tool chat failed',
    };
  }
}

module.exports = {
  inlineCrmToolChat,
};
