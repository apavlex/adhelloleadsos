/**
 * Shared speech-to-text for CRM Alex chat and the member field app.
 * Prefers the workspace (or shared agency) OpenRouter key — same key as other
 * owned-workspace AI — then falls back to a direct OpenAI key.
 * Audio is never written to disk; transcripts are never logged.
 */
const { resolveOpenAiDirectKey } = require('./pavlex/pavlexLlmConfig');
const { getResolvedIntegrationEnv } = require('./workspaceIntegrations');
const { resolveOpenRouterEnv } = require('./llmClient');

const MAX_BYTES = 10 * 1024 * 1024;
const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const OPENAI_TIMEOUT_MS = 30000;

const OPENAI_URL = 'https://api.openai.com/v1/audio/transcriptions';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/audio/transcriptions';
const OPENAI_PRIMARY_MODEL = 'gpt-4o-mini-transcribe';
const OPENAI_FALLBACK_MODEL = 'whisper-1';
const OPENROUTER_PRIMARY_MODEL = 'openai/whisper-1';
const OPENROUTER_FALLBACK_MODEL = 'openai/whisper-large-v3';

const NO_KEY_ERROR =
  'Voice transcription needs an OpenRouter key on this workspace (Workspace → Integrations) or OPENAI_API_KEY on the server.';

/** Swappable in tests. */
const deps = {
  fetch: (...args) => fetch(...args),
};

const recentByUser = new Map();

function takeRateSlot(key, now = Date.now()) {
  const recent = (recentByUser.get(key) || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (recent.length >= RATE_LIMIT) {
    recentByUser.set(key, recent);
    return false;
  }
  recent.push(now);
  recentByUser.set(key, recent);
  if (recentByUser.size > 5000) {
    for (const [k, list] of recentByUser) {
      if (!list.length || now - list[list.length - 1] >= RATE_WINDOW_MS) recentByUser.delete(k);
    }
  }
  return true;
}

function resetRateLimit() {
  recentByUser.clear();
}

function fileExtension(mime) {
  const m = String(mime || '').toLowerCase();
  if (m.includes('webm')) return 'webm';
  if (m.includes('mp4') || m.includes('m4a') || m.includes('aac')) return 'm4a';
  if (m.includes('ogg') || m.includes('opus')) return 'ogg';
  if (m.includes('wav')) return 'wav';
  if (m.includes('mpeg') || m.includes('mp3')) return 'mp3';
  if (m.includes('flac')) return 'flac';
  return 'webm';
}

/**
 * Resolve STT provider for a workspace: OpenRouter first (workspace / shared /
 * process), then direct OpenAI.
 * @param {string} [workspaceId]
 * @returns {Promise<null | {
 *   provider: 'openrouter'|'openai',
 *   apiKey: string,
 *   url: string,
 *   models: string[],
 *   headers: Record<string, string>,
 * }>}
 */
async function resolveTranscriptionProvider(workspaceId) {
  let integrationEnv = {};
  try {
    if (workspaceId) integrationEnv = await getResolvedIntegrationEnv(workspaceId);
  } catch (_) {
    integrationEnv = {};
  }

  const or = resolveOpenRouterEnv(integrationEnv);
  if (or.apiKey) {
    const headers = {
      Authorization: `Bearer ${or.apiKey}`,
      'HTTP-Referer': or.httpReferer,
      'X-Title': or.appName,
    };
    return {
      provider: 'openrouter',
      apiKey: or.apiKey,
      url: OPENROUTER_URL,
      models: [OPENROUTER_PRIMARY_MODEL, OPENROUTER_FALLBACK_MODEL],
      headers,
    };
  }

  const openaiKey =
    String((integrationEnv && integrationEnv.OPENAI_API_KEY) || '').trim() || resolveOpenAiDirectKey();
  if (openaiKey) {
    return {
      provider: 'openai',
      apiKey: openaiKey,
      url: OPENAI_URL,
      models: [OPENAI_PRIMARY_MODEL, OPENAI_FALLBACK_MODEL],
      headers: { Authorization: `Bearer ${openaiKey}` },
    };
  }

  return null;
}

function alexPromptHint(workspace) {
  const name = String((workspace && workspace.name) || '').trim().slice(0, 80);
  const where = name ? ` for the "${name}" workspace` : '';
  return `Dictated request to Alex, an AI assistant in a sales CRM${where}. Common words: leads, folders, GHL, GoHighLevel, Opportunities, pipeline, bookmarked, tasks.`;
}

function memberFieldPromptHint(brandName) {
  const name = String(brandName || '').trim().slice(0, 80);
  const where = name ? ` in the "${name}" field app` : ' in a contractor field app';
  return `Dictated job or customer notes${where}. Common words: estimate, materials, access, gate code, before, after, kitchen, bathroom, flooring, HVAC, plumbing, schedule, deposit, invoice.`;
}

function isModelError(status, payload) {
  if (status === 404) return true;
  if (status !== 400 && status !== 403) return false;
  const err = (payload && payload.error) || {};
  const blob = `${err.code || ''} ${err.param || ''} ${err.message || ''}`.toLowerCase();
  return blob.includes('model');
}

async function callTranscription({ provider, url, headers, audio, mime, model, prompt, language }) {
  const form = new FormData();
  form.append('file', new Blob([audio], { type: mime }), `dictation.${fileExtension(mime)}`);
  form.append('model', model);
  form.append('response_format', 'json');
  if (prompt) form.append('prompt', prompt);
  if (language) form.append('language', language);
  const res = await deps.fetch(url, {
    method: 'POST',
    headers,
    body: form,
    signal: AbortSignal.timeout(OPENAI_TIMEOUT_MS),
  });
  let payload = null;
  try {
    payload = await res.json();
  } catch (_) {
    payload = null;
  }
  return { status: res.status, ok: res.ok, payload, provider, model };
}

async function transcribeWithProvider(provider, opts) {
  const models = Array.isArray(provider.models) ? provider.models : [];
  let out = null;
  for (let i = 0; i < models.length; i += 1) {
    const model = models[i];
    out = await callTranscription({
      provider: provider.provider,
      url: provider.url,
      headers: provider.headers,
      audio: opts.audio,
      mime: opts.mime,
      model,
      prompt: opts.prompt,
      language: opts.language,
    });
    if (out.ok) return out;
    if (i < models.length - 1 && isModelError(out.status, out.payload)) continue;
    return out;
  }
  return out || { ok: false, status: 502, payload: null, provider: provider.provider };
}

/**
 * @param {{
 *   audio: Buffer,
 *   mime?: string,
 *   language?: string,
 *   workspaceId?: string,
 *   prompt?: string,
 * }} opts
 * @returns {Promise<{ ok: true, text: string, provider?: string } | { ok: false, status: number, error: string }>}
 */
async function transcribeAudio(opts) {
  const audio = opts && opts.audio;
  if (!Buffer.isBuffer(audio)) {
    return { ok: false, status: 415, error: 'Send the recording as audio.' };
  }
  if (!audio.length) {
    return { ok: false, status: 400, error: 'No audio received.' };
  }

  const provider = await resolveTranscriptionProvider(opts.workspaceId);
  if (!provider) {
    return { ok: false, status: 503, error: NO_KEY_ERROR };
  }

  const mime = String(opts.mime || 'audio/webm').split(';')[0].trim() || 'audio/webm';
  const langRaw = String(opts.language || '').trim().toLowerCase();
  const language = /^[a-z]{2}$/.test(langRaw) ? langRaw : '';

  try {
    const out = await transcribeWithProvider(provider, {
      audio,
      mime,
      prompt: opts.prompt || '',
      language,
    });
    if (!out.ok) {
      console.warn('[voice] transcription failed', provider.provider, out.status);
      if (out.status === 401) {
        return {
          ok: false,
          status: 503,
          error:
            provider.provider === 'openrouter'
              ? 'Voice transcription key was rejected by OpenRouter. Check Workspace → Integrations.'
              : 'Voice transcription key was rejected by OpenAI.',
        };
      }
      if (out.status === 429) {
        return { ok: false, status: 503, error: 'Voice transcription is busy. Try again in a moment.' };
      }
      return { ok: false, status: 502, error: 'Could not transcribe that. Try again.' };
    }
    const text = String((out.payload && out.payload.text) || '').trim();
    return { ok: true, text, provider: provider.provider };
  } catch (err) {
    const timedOut = err && (err.name === 'TimeoutError' || err.name === 'AbortError');
    console.warn('[voice] transcription error', timedOut ? 'timeout' : (err && err.name) || 'unknown');
    return {
      ok: false,
      status: timedOut ? 504 : 502,
      error: timedOut ? 'Transcription timed out. Try again.' : 'Could not transcribe that. Try again.',
    };
  }
}

module.exports = {
  deps,
  MAX_BYTES,
  RATE_LIMIT,
  RATE_WINDOW_MS,
  NO_KEY_ERROR,
  OPENAI_URL,
  OPENROUTER_URL,
  OPENAI_PRIMARY_MODEL,
  OPENAI_FALLBACK_MODEL,
  OPENROUTER_PRIMARY_MODEL,
  OPENROUTER_FALLBACK_MODEL,
  takeRateSlot,
  resetRateLimit,
  alexPromptHint,
  memberFieldPromptHint,
  resolveTranscriptionProvider,
  transcribeAudio,
};
