/**
 * Resolve LLM credentials for Pavlex tool-calling and general chat.
 *
 * Tool turns need native function calling, so they get their own model chain:
 *   XAI_API_KEY         → preferred XAI models (Grokbot family) then XAI_MODEL | grok-4
 *   OPENAI_API_KEY      → OPENAI_TOOL_MODEL | OPENAI_RESPONSES_MODEL | OPENAI_MODEL | gpt-4o-mini
 *   OPENROUTER_API_KEY  → preferred OpenRouter models, OPENROUTER_TOOL_MODEL, OPENROUTER_MODEL, gpt-4o-mini
 *
 * Workspace integration env (getResolvedIntegrationEnv) overrides process.env when passed in.
 */

const DEFAULT_OPENAI_TOOL_MODEL = 'gpt-4o-mini';
const DEFAULT_OPENROUTER_TOOL_MODEL = 'openai/gpt-4o-mini';
const DEFAULT_XAI_MODEL = 'grok-4';
const DEFAULT_XAI_URL = 'https://api.x.ai/v1/chat/completions';

function openRouterExtraHeaders(integrationEnv) {
  const refererRaw =
    pick(integrationEnv, 'OPENROUTER_HTTP_REFERER') ||
    pick(integrationEnv, 'BASE_URL') ||
    process.env.OPENROUTER_HTTP_REFERER ||
    process.env.BASE_URL ||
    'https://leads.adhello.io';
  const referer = /^https?:\/\//i.test(refererRaw)
    ? refererRaw
    : `https://${String(refererRaw).replace(/^\/+/, '')}`;
  return {
    'HTTP-Referer': referer,
    'X-Title':
      pick(integrationEnv, 'OPENROUTER_APP_NAME') ||
      process.env.OPENROUTER_APP_NAME ||
      'AdHello Leads OS',
  };
}

function env(name) {
  return String(process.env[name] || '').trim();
}

function pick(integrationEnv, name) {
  if (integrationEnv && typeof integrationEnv === 'object') {
    const fromWs = integrationEnv[name];
    if (typeof fromWs === 'string' && fromWs.trim()) return fromWs.trim();
  }
  return env(name);
}

/** Free routers, :free variants and reasoning-only models fail or print text instead of calling tools. */
function isUnreliableToolModel(model) {
  const m = String(model || '').trim().toLowerCase();
  if (!m) return true;
  if (m === 'openrouter/free' || m === 'openrouter/auto' || m.endsWith(':free')) return true;
  return /(^|\/)(deepseek-r1|qwq|o1-mini|o1-preview)\b|-r1\b|thinking/.test(m);
}

/**
 * Ordered tool-capable model candidates; first one is the primary.
 * @param {{ preferredOpenRouterModels?: string[], preferredXaiModels?: string[], integrationEnv?: Record<string,string> }} [opts]
 */
function resolvePavlexToolLlmChain(opts = {}) {
  const chain = [];
  const seen = new Set();
  const integrationEnv = opts.integrationEnv || null;
  const add = (entry) => {
    const key = `${entry.provider}:${entry.model}`;
    if (!entry.model || seen.has(key)) return;
    seen.add(key);
    chain.push(entry);
  };

  const preferredOr = Array.isArray(opts.preferredOpenRouterModels)
    ? opts.preferredOpenRouterModels.map((m) => String(m || '').trim()).filter(Boolean)
    : [];
  const preferredXai = Array.isArray(opts.preferredXaiModels)
    ? opts.preferredXaiModels.map((m) => String(m || '').trim()).filter(Boolean)
    : [];

  const xaiKey = pick(integrationEnv, 'XAI_API_KEY');
  // Only route through personal xAI when this employee asked for Grok models.
  if (xaiKey && preferredXai.length) {
    const base = {
      provider: 'xai',
      apiKey: xaiKey,
      url: pick(integrationEnv, 'XAI_API_BASE') || DEFAULT_XAI_URL,
      extraHeaders: {},
    };
    for (const model of preferredXai) {
      if (!isUnreliableToolModel(model)) add({ ...base, model });
    }
  }

  const orKey = pick(integrationEnv, 'OPENROUTER_API_KEY');
  if (orKey && preferredOr.length) {
    const base = {
      provider: 'openrouter',
      apiKey: orKey,
      url: 'https://openrouter.ai/api/v1/chat/completions',
      extraHeaders: openRouterExtraHeaders(integrationEnv),
    };
    for (const model of preferredOr) {
      if (!isUnreliableToolModel(model)) add({ ...base, model });
    }
  }

  const openaiKey = pick(integrationEnv, 'OPENAI_API_KEY');
  if (openaiKey) {
    add({
      provider: 'openai',
      apiKey: openaiKey,
      url: 'https://api.openai.com/v1/chat/completions',
      model:
        pick(integrationEnv, 'OPENAI_TOOL_MODEL') ||
        pick(integrationEnv, 'OPENAI_RESPONSES_MODEL') ||
        pick(integrationEnv, 'OPENAI_MODEL') ||
        DEFAULT_OPENAI_TOOL_MODEL,
      extraHeaders: {},
    });
  }

  if (orKey) {
    const base = {
      provider: 'openrouter',
      apiKey: orKey,
      url: 'https://openrouter.ai/api/v1/chat/completions',
      extraHeaders: openRouterExtraHeaders(integrationEnv),
    };
    const toolModel = pick(integrationEnv, 'OPENROUTER_TOOL_MODEL');
    const generalModel = pick(integrationEnv, 'OPENROUTER_MODEL');
    if (toolModel) add({ ...base, model: toolModel });
    if (generalModel && !isUnreliableToolModel(generalModel)) add({ ...base, model: generalModel });
    add({ ...base, model: DEFAULT_OPENROUTER_TOOL_MODEL });
  }

  return chain;
}

function resolvePavlexToolLlm(opts = {}) {
  const chain = resolvePavlexToolLlmChain(opts);
  return chain.length ? chain[0] : null;
}

function hasPavlexToolLlm(opts = {}) {
  return Boolean(resolvePavlexToolLlm(opts));
}

/** OpenAI-only — Responses API remote MCP requires native OpenAI key. */
function resolveOpenAiDirectKey(integrationEnv) {
  return pick(integrationEnv, 'OPENAI_API_KEY') || null;
}

function isXaiConfigured(integrationEnv) {
  return Boolean(pick(integrationEnv, 'XAI_API_KEY'));
}

module.exports = {
  resolvePavlexToolLlm,
  resolvePavlexToolLlmChain,
  hasPavlexToolLlm,
  resolveOpenAiDirectKey,
  isUnreliableToolModel,
  isXaiConfigured,
  DEFAULT_OPENROUTER_TOOL_MODEL,
  DEFAULT_XAI_MODEL,
  DEFAULT_XAI_URL,
};
