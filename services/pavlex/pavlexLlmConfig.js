/**
 * Resolve LLM credentials for Pavlex tool-calling and general chat.
 *
 * Tool turns need native function calling, so they get their own model chain:
 *   OPENAI_API_KEY      → OPENAI_TOOL_MODEL | OPENAI_RESPONSES_MODEL | OPENAI_MODEL | gpt-4o-mini
 *   OPENROUTER_API_KEY  → OPENROUTER_TOOL_MODEL, then OPENROUTER_MODEL (unless it is a free/auto
 *                         router or reasoning-only model), then openai/gpt-4o-mini
 */

const DEFAULT_OPENAI_TOOL_MODEL = 'gpt-4o-mini';
const DEFAULT_OPENROUTER_TOOL_MODEL = 'openai/gpt-4o-mini';

function openRouterExtraHeaders() {
  const refererRaw =
    process.env.OPENROUTER_HTTP_REFERER || process.env.BASE_URL || 'https://leads.adhello.io';
  const referer = /^https?:\/\//i.test(refererRaw)
    ? refererRaw
    : `https://${String(refererRaw).replace(/^\/+/, '')}`;
  return {
    'HTTP-Referer': referer,
    'X-Title': process.env.OPENROUTER_APP_NAME || 'AdHello Leads OS',
  };
}

function env(name) {
  return String(process.env[name] || '').trim();
}

/** Free routers, :free variants and reasoning-only models fail or print text instead of calling tools. */
function isUnreliableToolModel(model) {
  const m = String(model || '').trim().toLowerCase();
  if (!m) return true;
  if (m === 'openrouter/free' || m === 'openrouter/auto' || m.endsWith(':free')) return true;
  return /(^|\/)(deepseek-r1|qwq|o1-mini|o1-preview)\b|-r1\b|thinking/.test(m);
}

/** Ordered tool-capable model candidates; first one is the primary. */
function resolvePavlexToolLlmChain() {
  const chain = [];
  const seen = new Set();
  const add = (entry) => {
    const key = `${entry.provider}:${entry.model}`;
    if (!entry.model || seen.has(key)) return;
    seen.add(key);
    chain.push(entry);
  };

  const openaiKey = env('OPENAI_API_KEY');
  if (openaiKey) {
    add({
      provider: 'openai',
      apiKey: openaiKey,
      url: 'https://api.openai.com/v1/chat/completions',
      model:
        env('OPENAI_TOOL_MODEL') ||
        env('OPENAI_RESPONSES_MODEL') ||
        env('OPENAI_MODEL') ||
        DEFAULT_OPENAI_TOOL_MODEL,
      extraHeaders: {},
    });
  }

  const orKey = env('OPENROUTER_API_KEY');
  if (orKey) {
    const base = {
      provider: 'openrouter',
      apiKey: orKey,
      url: 'https://openrouter.ai/api/v1/chat/completions',
      extraHeaders: openRouterExtraHeaders(),
    };
    const toolModel = env('OPENROUTER_TOOL_MODEL');
    const generalModel = env('OPENROUTER_MODEL');
    if (toolModel) add({ ...base, model: toolModel });
    if (generalModel && !isUnreliableToolModel(generalModel)) add({ ...base, model: generalModel });
    add({ ...base, model: DEFAULT_OPENROUTER_TOOL_MODEL });
  }

  return chain;
}

function resolvePavlexToolLlm() {
  const chain = resolvePavlexToolLlmChain();
  return chain.length ? chain[0] : null;
}

function hasPavlexToolLlm() {
  return Boolean(resolvePavlexToolLlm());
}

/** OpenAI-only — Responses API remote MCP requires native OpenAI key. */
function resolveOpenAiDirectKey() {
  return String(process.env.OPENAI_API_KEY || '').trim() || null;
}

module.exports = {
  resolvePavlexToolLlm,
  resolvePavlexToolLlmChain,
  hasPavlexToolLlm,
  resolveOpenAiDirectKey,
  isUnreliableToolModel,
  DEFAULT_OPENROUTER_TOOL_MODEL,
};
