/**
 * Unified LLM access: KIE.ai → OpenAI → Google Gemini (e.g. Cloud Run with GEMINI_API_KEY).
 * Never call from browser — server only.
 *
 * Strong / reasoning models (Claude, GPT-4 class via your configured provider) are the right default for:
 * one-line email personalization; ICP fit 1–10 with a brief rationale; 2-sentence prospect site summaries;
 * inbound-reply classification; follow-ups that reference the prospect’s business; structured extraction
 * (e.g. decision-maker, pain points) from noisy scraped or Firecrawl output.
 *
 * Env (KIE):
 *   KIE_AI_API_KEY — Bearer token from https://kie.ai/api-key
 *   KIE_AI_CHAT_PATH — default `gpt-5-2/v1/chat/completions`
 *   KIE_AI_MODEL — default `gpt-5-2`
 *   KIE_AI_BASE_URL — default `https://api.kie.ai`
 *
 * Env (OpenAI):
 *   OPENAI_API_KEY, OPENAI_MODEL (e.g. gpt-4o-mini)
 *
 * Env (Gemini — Google AI / Vertex-style key on generateContent):
 *   GEMINI_API_KEY
 *   GEMINI_MODEL — default `gemini-2.0-flash`
 */

const DEFAULT_KIE_PATH = 'gpt-5-2/v1/chat/completions';
const DEFAULT_KIE_MODEL = 'gpt-5-2';
const DEFAULT_GEMINI_MODEL = 'gemini-2.0-flash';

function pickProvider() {
  const kieKey = process.env.KIE_AI_API_KEY || process.env.KIE_API_KEY;
  if (kieKey && String(kieKey).trim()) {
    return {
      name: 'kie',
      apiKey: kieKey.trim(),
      baseUrl: (process.env.KIE_AI_BASE_URL || 'https://api.kie.ai').replace(/\/$/, ''),
      path: (process.env.KIE_AI_CHAT_PATH || DEFAULT_KIE_PATH).replace(/^\//, ''),
      model: process.env.KIE_AI_MODEL || DEFAULT_KIE_MODEL,
    };
  }
  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey && String(openaiKey).trim()) {
    return {
      name: 'openai',
      apiKey: openaiKey.trim(),
      url: 'https://api.openai.com/v1/chat/completions',
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    };
  }
  const geminiKey = process.env.GEMINI_API_KEY;
  if (geminiKey && String(geminiKey).trim()) {
    return {
      name: 'gemini',
      apiKey: geminiKey.trim(),
      model: (process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL).replace(/^models\//, ''),
    };
  }
  return null;
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

/**
 * Chat completions (OpenAI-compatible request shape). Used by KIE GPT-style routes and OpenAI.
 * @param {object} opts
 * @param {Array<{role:string,content:string}>} opts.messages
 * @param {boolean} [opts.jsonObject] — response_format json_object where supported
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
  const prov = pickProvider();
  if (!prov) {
    return { content: null, provider: 'none', error: true };
  }

  const body = {
    model: prov.model,
    messages,
    temperature,
    max_tokens,
  };
  if (jsonObject) {
    body.response_format = { type: 'json_object' };
  }

  try {
    if (prov.name === 'kie') {
      const url = `${prov.baseUrl}/${prov.path}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${prov.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      const rawText = await res.text();
      let data;
      try {
        data = JSON.parse(rawText);
      } catch {
        console.warn('[llmClient] KIE non-JSON:', rawText.slice(0, 200));
        return { content: null, provider: 'kie', error: true };
      }
      if (!res.ok) {
        console.warn('[llmClient] KIE HTTP', res.status, rawText.slice(0, 280));
        return { content: null, provider: 'kie', error: true };
      }
      const content =
        data &&
        data.choices &&
        data.choices[0] &&
        data.choices[0].message &&
        data.choices[0].message.content;
      return {
        content: typeof content === 'string' ? content : null,
        provider: 'kie',
        error: !content,
      };
    }

    if (prov.name === 'gemini') {
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
      const parts = data?.candidates?.[0]?.content?.parts;
      let textOut = '';
      if (Array.isArray(parts)) {
        textOut = parts.map((p) => (typeof p.text === 'string' ? p.text : '')).join('');
      }
      return {
        content: textOut || null,
        provider: 'gemini',
        error: !textOut,
      };
    }

    const res = await fetch(prov.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${prov.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const rawText = await res.text();
    let data;
    try {
      data = JSON.parse(rawText);
    } catch {
      console.warn('[llmClient] OpenAI non-JSON:', rawText.slice(0, 200));
      return { content: null, provider: 'openai', error: true };
    }
    if (!res.ok) {
      console.warn('[llmClient] OpenAI HTTP', res.status, rawText.slice(0, 280));
      return { content: null, provider: 'openai', error: true };
    }
    const content =
      data &&
      data.choices &&
      data.choices[0] &&
      data.choices[0].message &&
      data.choices[0].message.content;
    return {
      content: typeof content === 'string' ? content : null,
      provider: 'openai',
      error: !content,
    };
  } catch (e) {
    console.warn('[llmClient] fetch error:', e.message);
    return { content: null, provider: prov.name, error: true };
  }
}

function activeProviderLabel() {
  const p = pickProvider();
  return p ? p.name : null;
}

module.exports = {
  chatCompletion,
  pickProvider,
  activeProviderLabel,
};
