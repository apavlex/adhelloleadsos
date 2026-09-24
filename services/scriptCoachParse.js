/**
 * Parse AI script-coach responses with fallbacks when JSON is slightly broken
 * (common when the model puts a long email draft inside refinedScript).
 */

const { parseLlmJson } = require('./llmClient');

function extractJsonStringField(raw, field) {
  const re = new RegExp(`"${field}"\\s*:\\s*("((?:\\\\.|[^"\\\\])*)"|null)`, 'i');
  const m = String(raw || '').match(re);
  if (!m) return undefined;
  if (/^null$/i.test(String(m[1] || '').trim())) return null;
  try {
    return JSON.parse(m[1]);
  } catch (_) {
    return String(m[2] || '')
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
  }
}

function userAskedForScriptRewrite(userMessage) {
  return /\b(write|rewrite|draft|create|make|build|shorter|longer|personalize|tone|version|script|email|sms|opener)\b/i.test(
    String(userMessage || ''),
  );
}

/**
 * @param {string} raw
 * @param {{ userMessage?: string }} [opts]
 * @returns {{ reply: string, refinedScript: string|null } | null}
 */
function parseScriptCoachAiContent(raw, { userMessage } = {}) {
  const parsed = parseLlmJson(raw);
  if (parsed && typeof parsed === 'object') {
    const reply = typeof parsed.reply === 'string' ? parsed.reply.trim() : '';
    let refinedScript = parsed.refinedScript;
    if (refinedScript != null && typeof refinedScript !== 'string') refinedScript = null;
    if (typeof refinedScript === 'string') refinedScript = refinedScript.trim() || null;
    if (reply || refinedScript) {
      return {
        reply: reply || (refinedScript ? 'Here’s a draft you can apply to this section.' : ''),
        refinedScript,
      };
    }
  }

  const text = String(raw || '').trim();
  if (!text) return null;

  let reply = extractJsonStringField(text, 'reply');
  let refinedScript = extractJsonStringField(text, 'refinedScript');
  if (typeof reply === 'string') reply = reply.trim();
  else reply = '';
  if (typeof refinedScript === 'string') refinedScript = refinedScript.trim() || null;
  else if (refinedScript !== null) refinedScript = null;

  if (!reply && !text.startsWith('{') && !text.startsWith('```')) {
    reply = text.slice(0, 4000).trim();
  }

  if (
    !refinedScript &&
    userAskedForScriptRewrite(userMessage) &&
    reply &&
    reply.length > 60 &&
    (/\n/.test(reply) || reply.length > 160)
  ) {
    refinedScript = reply;
    reply = 'Here’s a draft you can apply to this section.';
  }

  if (!reply && !refinedScript) return null;
  return {
    reply: reply || 'Here’s an updated take.',
    refinedScript,
  };
}

module.exports = {
  extractJsonStringField,
  userAskedForScriptRewrite,
  parseScriptCoachAiContent,
};
