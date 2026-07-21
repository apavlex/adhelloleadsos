/**
 * General Pavlex replies when CRM tools do not apply (no tool calling required).
 */
const { chatCompletion, openRouterProviders, legacyProviders } = require('../llmClient');

async function pavlexGeneralChat({ instructions, message, history = [] }) {
  const messages = [{ role: 'system', content: String(instructions || '').trim() }];
  for (const m of history || []) {
    if (m && (m.role === 'user' || m.role === 'assistant') && m.content) {
      messages.push({ role: m.role, content: String(m.content) });
    }
  }
  messages.push({ role: 'user', content: String(message || '').trim() });

  const opts = { messages, max_tokens: 800, temperature: 0.65 };

  if (openRouterProviders().length) {
    const out = await chatCompletion({ ...opts, providerChain: 'openrouter' });
    if (out.content && !out.error) {
      return {
        content: out.content,
        provider: out.provider || 'openrouter',
        mcpEnabled: false,
        mcpMode: 'general_chat',
      };
    }
  }

  if (legacyProviders().length) {
    const out = await chatCompletion({ ...opts, providerChain: 'legacy' });
    if (out.content && !out.error) {
      return {
        content: out.content,
        provider: out.provider || 'legacy',
        mcpEnabled: false,
        mcpMode: 'general_chat',
      };
    }
    return { content: null, error: true, detail: out.error || 'General chat unavailable' };
  }

  return { content: null, error: true, detail: 'No LLM providers configured' };
}

module.exports = {
  pavlexGeneralChat,
};
