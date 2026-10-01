/**
 * Voice dictation for the Alex chat — POST /api/voice/transcribe.
 * Body: raw audio (audio/* or application/octet-stream), ≤ 10MB (~2 min). Audio is never written to disk
 * and transcripts are never logged.
 */
const express = require('express');
const { resolveOpenAiDirectKey } = require('../services/pavlex/pavlexLlmConfig');
const { getResolvedIntegrationEnv } = require('../services/workspaceIntegrations');
const { userEmail } = require('../services/workspaceService');

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

const router = express.Router();
const recentByUser = new Map();

function fail(res, status, error) {
  return res.status(status).json({ success: false, error });
}

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

function promptHint(workspace) {
  const name = String((workspace && workspace.name) || '').trim().slice(0, 80);
  const where = name ? ` for the "${name}" workspace` : '';
  return `Dictated request to Alex, an AI assistant in a sales CRM${where}. Common words: leads, folders, GHL, GoHighLevel, Opportunities, pipeline, bookmarked, tasks.`;
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

async function transcribe(opts) {
  let out = await callOpenAi({ ...opts, model: PRIMARY_MODEL });
  if (!out.ok && isModelError(out.status, out.payload)) {
    out = await callOpenAi({ ...opts, model: FALLBACK_MODEL });
  }
  return out;
}

router.post(
  '/transcribe',
  (req, res, next) => {
    const email = userEmail(req);
    if (!email) return fail(res, 401, 'Sign in required.');
    req.voiceUserKey = `${email.toLowerCase()}|${req.workspaceId || ''}`;
    const declared = Number(req.get('content-length') || 0);
    if (declared > MAX_BYTES) return fail(res, 413, 'Recording is too long. Keep it under 2 minutes.');
    if (!takeRateSlot(req.voiceUserKey)) {
      return fail(res, 429, 'Too many voice messages. Wait a few minutes and try again.');
    }
    return next();
  },
  express.raw({ type: ['audio/*', 'application/octet-stream'], limit: MAX_BYTES }),
  async (req, res) => {
    const audio = req.body;
    if (!Buffer.isBuffer(audio)) return fail(res, 415, 'Send the recording as audio.');
    if (!audio.length) return fail(res, 400, 'No audio received.');

    const apiKey = await resolveOpenAiKey(req.workspaceId);
    if (!apiKey) return fail(res, 503, NO_KEY_ERROR);

    const mime = String(req.get('content-type') || 'audio/webm').split(';')[0].trim() || 'audio/webm';
    const langRaw = String(req.query.lang || '').trim().toLowerCase();
    const language = /^[a-z]{2}$/.test(langRaw) ? langRaw : '';

    try {
      const out = await transcribe({
        apiKey,
        audio,
        mime,
        prompt: promptHint(req.workspace),
        language,
      });
      if (!out.ok) {
        console.warn('[voice] transcription failed', out.status);
        if (out.status === 401) return fail(res, 503, 'Voice transcription key was rejected by OpenAI.');
        if (out.status === 429) return fail(res, 503, 'Voice transcription is busy. Try again in a moment.');
        return fail(res, 502, 'Could not transcribe that. Try again.');
      }
      const text = String((out.payload && out.payload.text) || '').trim();
      return res.json({ success: true, text });
    } catch (err) {
      const timedOut = err && (err.name === 'TimeoutError' || err.name === 'AbortError');
      console.warn('[voice] transcription error', timedOut ? 'timeout' : (err && err.name) || 'unknown');
      return fail(res, timedOut ? 504 : 502, timedOut ? 'Transcription timed out. Try again.' : 'Could not transcribe that. Try again.');
    }
  },
);

// express.raw size / parse errors → JSON instead of the HTML error page.
router.use((err, req, res, next) => {
  if (err && (err.type === 'entity.too.large' || err.status === 413)) {
    return fail(res, 413, 'Recording is too long. Keep it under 2 minutes.');
  }
  if (err && err.status && err.status < 500) return fail(res, err.status, 'Could not read the recording.');
  return next(err);
});

module.exports = router;
module.exports._deps = deps;
module.exports._resetRateLimit = () => recentByUser.clear();
module.exports.RATE_LIMIT = RATE_LIMIT;
module.exports.MAX_BYTES = MAX_BYTES;
