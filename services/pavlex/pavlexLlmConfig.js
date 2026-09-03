/**
 * Resolve LLM credentials for Pavlex tool-calling and general chat.
 */

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

function resolvePavlexToolLlm() {
  const openaiKey = String(process.env.OPENAI_API_KEY || '').trim();
  if (openaiKey) {
    return {
      provider: 'openai',
      apiKey: openaiKey,
      url: 'https://api.openai.com/v1/chat/completions',
      model:
        String(process.env.OPENAI_RESPONSES_MODEL || '').trim() ||
        String(process.env.OPENAI_MODEL || '').trim() ||
        'gpt-4o-mini',
      extraHeaders: {},
    };
  }

  const orKey = String(process.env.OPENROUTER_API_KEY || '').trim();
  if (orKey) {
    return {
      provider: 'openrouter',
      apiKey: orKey,
      url: 'https://openrouter.ai/api/v1/chat/completions',
      model:
        String(process.env.OPENROUTER_MODEL || '').trim() ||
        'openai/gpt-4o-mini',
      extraHeaders: openRouterExtraHeaders(),
    };
  }

  return null;
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
  hasPavlexToolLlm,
  resolveOpenAiDirectKey,
};
