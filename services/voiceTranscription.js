/**
 * Shared OpenAI speech-to-text used by CRM Alex chat and the member field app.
 * Audio is never written to disk; transcripts are never logged.
 */
const { resolveOpenAiDirectKey } = require('./pavlex/pavlexLlmConfig');
const { getResolvedIntegrationEnv } = require('./workspaceIntegrations');

const MAX_BYTES = 10 * 1024 * 1024;
const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const OPENAI_TIMEOUT_MS = 30000;
const PRIMARY_MODEL = 'gpt-4o-mini-transcribe';
const FALLBACK_MODEL = 'whisper-1';
const OPENAI_URL = 'https://api.openai.com/v1/audio/transcriptions';
const NO_KEY_ERROR = 'Voice transcription needs OPENAI_API_KEY on the server.';

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

async function resolveOpenAiKey(workspaceId) {
  try {
    const env = await getResolvedIntegrationEnv(workspaceId);
    const fromWs = String((env && env.OPENAI_API_KEY) || '').trim();
    if (fromWs) return fromWs;
  } catch (_) {
    /* fall back to the deployment key */
  }
  return resolveOpenAiDirectKey();
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

async function callOpenAi({ apiKey, audio, mime, model, prompt, language }) {
  const form = new FormData();
  form.append('file', new Blob([audio], { type: mime }), `dictation.${fileExtension(mime)}`);
  form.append('model', model);
  form.append('response_format', 'json');
  if (prompt) form.append('prompt', prompt);
  if (language) form.append('language', language);
  const res = await deps.fetch(OPENAI_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
    signal: AbortSignal.timeout(OPENAI_TIMEOUT_MS),
  });
  let payload = null;
  try {
    payload = await res.json();
  } catch (_) {
    payload = null;
  }
  return { status: res.status, ok: res.ok, payload };
}

async function transcribeWithOpenAi(opts) {
  let out = await callOpenAi({ ...opts, model: PRIMARY_MODEL });
  if (!out.ok && isModelError(out.status, out.payload)) {
    out = await callOpenAi({ ...opts, model: FALLBACK_MODEL });
  }
  return out;
}

/**
 * @param {{
 *   audio: Buffer,
 *   mime?: string,
 *   language?: string,
 *   workspaceId?: string,
 *   prompt?: string,
 * }} opts
 * @returns {Promise<{ ok: true, text: string } | { ok: false, status: number, error: string }>}
 */
async function transcribeAudio(opts) {
  const audio = opts && opts.audio;
  if (!Buffer.isBuffer(audio)) {
    return { ok: false, status: 415, error: 'Send the recording as audio.' };
  }
  if (!audio.length) {
    return { ok: false, status: 400, error: 'No audio received.' };
  }

  const apiKey = await resolveOpenAiKey(opts.workspaceId);
  if (!apiKey) {
    return { ok: false, status: 503, error: NO_KEY_ERROR };
  }

  const mime = String(opts.mime || 'audio/webm').split(';')[0].trim() || 'audio/webm';
  const langRaw = String(opts.language || '').trim().toLowerCase();
  const language = /^[a-z]{2}$/.test(langRaw) ? langRaw : '';

  try {
    const out = await transcribeWithOpenAi({
      apiKey,
      audio,
      mime,
      prompt: opts.prompt || '',
      language,
    });
    if (!out.ok) {
      console.warn('[voice] transcription failed', out.status);
      if (out.status === 401) {
        return { ok: false, status: 503, error: 'Voice transcription key was rejected by OpenAI.' };
      }
      if (out.status === 429) {
        return { ok: false, status: 503, error: 'Voice transcription is busy. Try again in a moment.' };
      }
      return { ok: false, status: 502, error: 'Could not transcribe that. Try again.' };
    }
    const text = String((out.payload && out.payload.text) || '').trim();
    return { ok: true, text };
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
  takeRateSlot,
  resetRateLimit,
  alexPromptHint,
  memberFieldPromptHint,
  transcribeAudio,
};
