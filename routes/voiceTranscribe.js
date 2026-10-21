/**
 * Voice dictation for the Alex chat — POST /api/voice/transcribe.
 * Body: raw audio (audio/* or application/octet-stream), ≤ 10MB (~2 min). Audio is never written to disk
 * and transcripts are never logged.
 */
const express = require('express');
const { userEmail } = require('../services/workspaceService');
const voice = require('../services/voiceTranscription');

const router = express.Router();

function fail(res, status, error) {
  return res.status(status).json({ success: false, error });
}

router.post(
  '/transcribe',
  (req, res, next) => {
    const email = userEmail(req);
    if (!email) return fail(res, 401, 'Sign in required.');
    req.voiceUserKey = `${email.toLowerCase()}|${req.workspaceId || ''}`;
    const declared = Number(req.get('content-length') || 0);
    if (declared > voice.MAX_BYTES) return fail(res, 413, 'Recording is too long. Keep it under 2 minutes.');
    if (!voice.takeRateSlot(req.voiceUserKey)) {
      return fail(res, 429, 'Too many voice messages. Wait a few minutes and try again.');
    }
    return next();
  },
  express.raw({ type: ['audio/*', 'application/octet-stream'], limit: voice.MAX_BYTES }),
  async (req, res) => {
    const mime = String(req.get('content-type') || 'audio/webm').split(';')[0].trim() || 'audio/webm';
    const langRaw = String(req.query.lang || '').trim().toLowerCase();
    const language = /^[a-z]{2}$/.test(langRaw) ? langRaw : '';

    const result = await voice.transcribeAudio({
      audio: req.body,
      mime,
      language,
      workspaceId: req.workspaceId,
      prompt: voice.alexPromptHint(req.workspace),
    });
    if (!result.ok) return fail(res, result.status, result.error);
    return res.json({ success: true, text: result.text });
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
module.exports._deps = voice.deps;
module.exports._resetRateLimit = () => voice.resetRateLimit();
module.exports.RATE_LIMIT = voice.RATE_LIMIT;
module.exports.MAX_BYTES = voice.MAX_BYTES;
