/**
 * Unified LLM access with two provider chains:
 *   openrouter (default) — coach, insights, outreach, pipeline AI, etc.
 *   legacy — CEO dashboard chat + floating Pavlex chatbot only (KIE → Gemini → OpenAI)
 *
 * Never call from browser — server only.
 *
 * Env (OpenRouter — default chain):
 *   OPENROUTER_API_KEY — Bearer token from https://openrouter.ai/keys
 *   OPENROUTER_MODEL — optional override; default tries deepseek-v4-flash:free then deepseek-v4-pro
 *   OPENROUTER_HTTP_REFERER — optional site URL for OpenRouter rankings
 *   OPENROUTER_APP_NAME — optional app title header (default AdHello Leads OS)
 *
 * Env (legacy chain — CEO + chatbot):
 *   KIE_AI_API_KEY or KIE_API_KEY — Bearer token
 *   KIE_AI_CHAT_PATH — default `gpt-5-2/v1/chat/completions`
 *   KIE_AI_MODEL — default `gpt-5-2`
 *   KIE_AI_BASE_URL — default `https://api.kie.ai`
 *   GEMINI_API_KEY, GEMINI_MODEL (default gemini-2.0-flash)
 *   OPENAI_API_KEY, OPENAI_MODEL (e.g. gpt-4o-mini)
 */

const DEFAULT_KIE_PATH = 'gpt-5-2/v1/chat/completions';
const DEFAULT_KIE_MODEL = 'gpt-5-2';
const DEFAULT_GEMINI_MODEL = 'gemini-2.0-flash';

const OPENROUTER_FREE_MODEL = 'deepseek/deepseek-v4-flash:free';
const OPENROUTER_PAID_FALLBACK_MODEL = 'deepseek/deepseek-v4-pro';

/** @returns {Array<{name:string, apiKey:string, baseUrl?:string, path?:string, model?:string, url?:string}>} */
function openRouterProviders() {
  const list = [];
  const orKey = process.env.OPENROUTER_API_KEY;
  if (orKey && String(orKey).trim()) {
    const key = orKey.trim();
    const url = 'https://openrouter.ai/api/v1/chat/completions';
    const custom = process.env.OPENROUTER_MODEL && String(process.env.OPENROUTER_MODEL).trim();
    if (custom) {
      list.push({ name: 'openrouter', apiKey: key, url, model: custom });
    } else {
      list.push({
        name: 'openrouter-flash',
        apiKey: key,
        url,
        model: OPENROUTER_FREE_MODEL,
      });
      list.push({
        name: 'openrouter-pro',
        apiKey: key,
        url,
        model: OPENROUTER_PAID_FALLBACK_MODEL,
      });
    }
  }
  return list;
}

/** KIE → Gemini → OpenAI — used by CEO dashboard + floating Pavlex chatbot only. */
function legacyProviders() {
  const list = [];

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

  const geminiKey = process.env.GEMINI_API_KEY;
  if (geminiKey && String(geminiKey).trim()) {
    list.push({
      name: 'gemini',
      apiKey: geminiKey.trim(),
      model: (process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL).replace(/^models\//, ''),
    });
  }

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

/**
 * @param {'openrouter'|'legacy'} [chain]
 * @returns {Array<{name:string, apiKey:string, baseUrl?:string, path?:string, model?:string, url?:string}>}
 */
function providersForChain(chain = 'openrouter') {
  return chain === 'legacy' ? legacyProviders() : openRouterProviders();
}

/** @deprecated use providersForChain('openrouter') */
function providersInFallbackOrder() {
  return providersForChain('openrouter');
}

function pickProvider(chain = 'openrouter') {
  const list = providersForChain(chain);
  return list.length ? list[0] : null;
}

function normalizeProviderName(name) {
  if (!name) return name;
  if (String(name).startsWith('openrouter')) return 'openrouter';
  return name;
}

function openRouterHeaders() {
  const refererRaw =
    process.env.OPENROUTER_HTTP_REFERER || process.env.BASE_URL || 'https://leads.adhello.ai';
  const referer = /^https?:\/\//i.test(refererRaw)
    ? refererRaw
    : `https://${String(refererRaw).replace(/^\/+/, '')}`;
  return {
    'HTTP-Referer': referer,
    'X-Title': process.env.OPENROUTER_APP_NAME || 'AdHello Leads OS',
  };
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

/** Parse JSON from LLM output (raw JSON, ``` fences, or embedded object). */
function parseLlmJson(text) {
  if (text == null) return null;
  const raw = String(text).trim();
  if (!raw) return null;

  const tryParse = (s) => {
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  };

  let parsed = tryParse(raw);
  if (parsed) return parsed;

  const unfenced = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
  if (unfenced !== raw) {
    parsed = tryParse(unfenced);
    if (parsed) return parsed;
  }

  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    parsed = tryParse(fence[1].trim());
    if (parsed) return parsed;
  }

  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) {
    parsed = tryParse(raw.slice(start, end + 1));
    if (parsed) return parsed;
  }

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
  const headers = {
    Authorization: `Bearer ${prov.apiKey}`,
    'Content-Type': 'application/json',
  };
  if (String(prov.name).startsWith('openrouter')) {
    Object.assign(headers, openRouterHeaders());
  }
  const res = await fetch(url, {
    method: 'POST',
    headers,
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
    provider: normalizeProviderName(prov.name),
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
 * @param {'openrouter'|'legacy'} [opts.providerChain] — legacy for CEO + Pavlex chatbot
 * @returns {Promise<{ content: string|null, provider: string, error?: boolean }>}
 */
async function chatCompletion({
  messages,
  jsonObject = false,
  max_tokens = 900,
  temperature = 0.45,
  providerChain = 'openrouter',
}) {
  const chain = providersForChain(providerChain);
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
    const retries = 1;
    for (let attempt = 0; attempt < retries; attempt++) {
    try {
      if (prov.name === 'gemini') {
        const out = await runGemini(prov, { messages, jsonObject, max_tokens, temperature });
        last = out;
        if (out.content && !out.error) return out;
        break; // gemini doesn't retry
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
      if (attempt < retries - 1) {
        console.warn(`[llmClient] ${prov.name} attempt ${attempt + 1} failed, retrying...`);
      }
    } catch (e) {
      console.warn(`[llmClient] ${prov.name} attempt ${attempt + 1} error:`, e.message);
      last = { content: null, provider: prov.name, error: true };
    }
    } // end retry loop
  }

  return last;
}

function activeProviderLabel(chain = 'openrouter') {
  const p = pickProvider(chain);
  return p ? normalizeProviderName(p.name) : null;
}

module.exports = {
  chatCompletion,
  pickProvider,
  activeProviderLabel,
  providersForChain,
  providersInFallbackOrder,
  openRouterProviders,
  legacyProviders,
  parseLlmJson,
  OPENROUTER_FREE_MODEL,
  OPENROUTER_PAID_FALLBACK_MODEL,
};
