/**
 * Unified LLM access: try KIE.ai first, then Google Gemini, then OpenAI.
 * Never call from browser — server only.
 *
 * Env (KIE):
 *   KIE_AI_API_KEY or KIE_API_KEY — Bearer token
 *   KIE_AI_CHAT_PATH — default `gpt-5-2/v1/chat/completions`
 *   KIE_AI_MODEL — default `gpt-5-2`
 *   KIE_AI_BASE_URL — default `https://api.kie.ai`
 *
 * Env (Gemini):
 *   GEMINI_API_KEY, GEMINI_MODEL (default gemini-2.0-flash)
 *
 * Env (OpenAI):
 *   OPENAI_API_KEY, OPENAI_MODEL (e.g. gpt-4o-mini)
 */

const DEFAULT_KIE_PATH = 'gpt-5-2/v1/chat/completions';
const DEFAULT_KIE_MODEL = 'gpt-5-2';
const DEFAULT_GEMINI_MODEL = 'gemini-2.0-flash';

/** @returns {Array<{name:string, apiKey:string, baseUrl?:string, path?:string, model?:string, url?:string}>} */
function providersInFallbackOrder() {
  const list = [];

  // OpenRouter — try free (Flash) first, then fall back to Pro
  const orKey = process.env.OPENROUTER_API_KEY;
  if (orKey && String(orKey).trim()) {
    const key = orKey.trim();
    list.push({
      name: 'openrouter-flash',
      apiKey: key,
      url: 'https://openrouter.ai/api/v1/chat/completions',
      model: process.env.OPENROUTER_MODEL || 'deepseek/deepseek-v4-flash:free',
    });
    if (!process.env.OPENROUTER_MODEL) {
      list.push({
        name: 'openrouter-pro',
        apiKey: key,
        url: 'https://openrouter.ai/api/v1/chat/completions',
        model: 'deepseek/deepseek-v4-pro',
      });
    }
  }

  // KIE.ai
  const kieKey = process.env.KIE_AI_API_KEY || process.env.KIE_API_KEY;
  if (kieKey && String(kieKey).trim()) {
    list.push({
      name: 'kie',
      apiKey: kieKey.trim(),
      baseUrl: (process.env.KIE_AI_BASE_URL || 'https://api.kie.ai').replace(/\/$/, ''),
      path: (process.env.KIE_AI_CHAT_PATH || DEFAULT_KIE_PATH).replace(/^\//, ''),
      model: process.env.KIE_AI_MODEL || DEFAULT_KIE_MODEL,
    });
  }

  // Gemini
  const geminiKey = process.env.GEMINI_API_KEY;
  if (geminiKey && String(geminiKey).trim()) {
    list.push({
      name: 'gemini',
      apiKey: geminiKey.trim(),
      model: (process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL).replace(/^models\//, ''),
    });
  }

  // OpenAI
  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey && String(openaiKey).trim()) {
    list.push({
      name: 'openai',
      apiKey: openaiKey.trim(),
      url: 'https://api.openai.com/v1/chat/completions',
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    });
  }

  return list;
}

function pickProvider() {
  const list = providersInFallbackOrder();
  return list.length ? list[0] : null;
}

/**
 * Maps OpenAI-style messages to Gemini generateContent body.
 */
function buildGeminiBody(messages, { jsonObject, max_tokens, temperature }) {
  const systemChunks = [];
  const contents = [];

  for (const m of messages || []) {
    const text = typeof m.content === 'string' ? m.content : '';
    if (!text.trim()) continue;
    if (m.role === 'system') {
      systemChunks.push(text);
      continue;
    }
    if (m.role === 'user') {
      contents.push({ role: 'user', parts: [{ text }] });
    } else if (m.role === 'assistant') {
      contents.push({ role: 'model', parts: [{ text }] });
    }
  }

  const generationConfig = {
    temperature,
    maxOutputTokens: max_tokens,
  };
  if (jsonObject) {
    generationConfig.responseMimeType = 'application/json';
  }

  const body = { contents, generationConfig };
  if (systemChunks.length) {
    body.systemInstruction = { parts: [{ text: systemChunks.join('\n\n') }] };
  }
  return body;
}

function extractOpenAIStyleMessageContent(data) {
  const ch = data && data.choices && data.choices[0];
  if (!ch) return null;
  if (typeof ch.text === 'string' && ch.text.trim()) return ch.text;
  const msg = ch.message;
  if (!msg) return null;
  if (typeof msg.refusal === 'string' && msg.refusal.trim()) return msg.refusal;
  const c = msg.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) {
    return c
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object' && typeof part.text === 'string') return part.text;
        return '';
      })
      .join('');
  }
  if (c && typeof c === 'object' && typeof c.text === 'string') return c.text;
  return null;
}

async function runGemini(prov, { messages, jsonObject, max_tokens, temperature }) {
  const geminiBody = buildGeminiBody(messages, { jsonObject, max_tokens, temperature });
  if (!geminiBody.contents || geminiBody.contents.length === 0) {
    console.warn('[llmClient] Gemini: no user/model messages after mapping');
    return { content: null, provider: 'gemini', error: true };
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    prov.model
  )}:generateContent?key=${encodeURIComponent(prov.apiKey)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(geminiBody),
  });
  const rawText = await res.text();
  let data;
  try {
    data = JSON.parse(rawText);
  } catch {
    console.warn('[llmClient] Gemini non-JSON:', rawText.slice(0, 200));
    return { content: null, provider: 'gemini', error: true };
  }
  if (!res.ok) {
    console.warn('[llmClient] Gemini HTTP', res.status, rawText.slice(0, 280));
    return { content: null, provider: 'gemini', error: true };
  }
  const c0 = data?.candidates?.[0];
  const parts = c0?.content?.parts;
  let textOut = '';
  if (Array.isArray(parts)) {
    textOut = parts.map((p) => (typeof p.text === 'string' ? p.text : '')).join('');
  }
  if (!textOut) {
    const fr = c0 && c0.finishReason;
    const err = data && (data.error || data.promptFeedback);
    console.warn('[llmClient] Gemini empty output', {
      finishReason: fr,
      hasPromptFeedback: !!err,
    });
  }
  return {
    content: textOut || null,
    provider: 'gemini',
    error: !textOut,
  };
}

async function runOpenAICompatible(prov, url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${prov.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const rawText = await res.text();
  const ct = (res.headers.get('content-type') || '').toLowerCase();
  if (ct.includes('text/event-stream')) {
    console.warn('[llmClient]', prov.name, 'returned SSE; set stream:false on requests');
    return { content: null, provider: prov.name, error: true };
  }
  let data;
  try {
    data = JSON.parse(rawText);
  } catch {
    console.warn(`[llmClient] ${prov.name} non-JSON:`, rawText.slice(0, 200));
    return { content: null, provider: prov.name, error: true };
  }
  if (!res.ok) {
    console.warn(`[llmClient] ${prov.name} HTTP`, res.status, rawText.slice(0, 280));
    return { content: null, provider: prov.name, error: true };
  }
  const content = extractOpenAIStyleMessageContent(data);
  return {
    content: typeof content === 'string' && content.trim() ? content : null,
    provider: prov.name,
    error: !content || !String(content).trim(),
  };
}

/**
 * Chat completions — tries each configured provider until one returns text.
 * @param {object} opts
 * @param {Array<{role:string,content:string}>} opts.messages
 * @param {boolean} [opts.jsonObject]
 * @param {number} [opts.max_tokens]
 * @param {number} [opts.temperature]
 * @returns {Promise<{ content: string|null, provider: string, error?: boolean }>}
 */
async function chatCompletion({
  messages,
  jsonObject = false,
  max_tokens = 900,
  temperature = 0.45,
}) {
  const chain = providersInFallbackOrder();
  if (!chain.length) {
    return { content: null, provider: 'none', error: true };
  }

  const baseBody = {
    messages,
    temperature,
    max_tokens,
    stream: false,
  };
  if (jsonObject) {
    baseBody.response_format = { type: 'json_object' };
  }

  let last = { content: null, provider: chain[chain.length - 1].name, error: true };

  for (const prov of chain) {
    try {
      if (prov.name === 'gemini') {
        const out = await runGemini(prov, { messages, jsonObject, max_tokens, temperature });
        last = out;
        if (out.content && !out.error) return out;
        continue;
      }

      const body = { ...baseBody, model: prov.model };
      let url;
      if (prov.name === 'kie') {
        url = `${prov.baseUrl}/${prov.path}`;
      } else {
        url = prov.url;
      }

      const out = await runOpenAICompatible(prov, url, body);
      last = out;
      if (out.content && !out.error) return out;
    } catch (e) {
      console.warn(`[llmClient] ${prov.name} fetch error:`, e.message);
      last = { content: null, provider: prov.name, error: true };
    }
  }

  return last;
}

function activeProviderLabel() {
  const p = pickProvider();
  return p ? p.name : null;
}

module.exports = {
  chatCompletion,
  pickProvider,
  activeProviderLabel,
  providersInFallbackOrder,
};
