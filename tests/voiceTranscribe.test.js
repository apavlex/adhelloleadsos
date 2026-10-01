const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-transcribe-'));
process.env.APP_DATA_DIR = tmpDataDir;

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const express = require('express');
const voiceRoutes = require('../routes/voiceTranscribe');

const USER = 'owner@example.com';
const savedKey = process.env.OPENAI_API_KEY;

let openAiCalls = [];
let openAiResponder = null;
voiceRoutes._deps.fetch = async (url, init) => {
  const form = init.body;
  const file = form.get('file');
  openAiCalls.push({
    url,
    auth: init.headers.Authorization,
    model: form.get('model'),
    prompt: form.get('prompt'),
    language: form.get('language'),
    fileName: file && file.name,
    fileType: file && file.type,
    fileSize: file && file.size,
  });
  const { status = 200, body = { text: 'Find plumbers in Camas' } } = (openAiResponder && openAiResponder(openAiCalls.length)) || {};
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
};

function buildApp() {
  const app = express();
  app.use((req, res, next) => {
    const email = req.headers['x-test-user'];
    if (email) req.user = { email, emails: [{ value: email }] };
    req.workspaceId = 'ws_voice';
    req.workspace = { id: 'ws_voice', name: 'Voice WS' };
    next();
  });
  app.use('/api/voice', voiceRoutes);
  return app;
}

async function withServer(fn) {
  const server = http.createServer(buildApp());
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function post(base, { body = Buffer.alloc(4000, 1), type = 'audio/mp4', user = USER, query = '' } = {}) {
  const headers = { 'Content-Type': type, Accept: 'application/json' };
  if (user) headers['x-test-user'] = user;
  return fetch(`${base}/api/voice/transcribe${query}`, { method: 'POST', headers, body }).then(async (r) => ({
    status: r.status,
    body: await r.json(),
  }));
}

test.beforeEach(() => {
  openAiCalls = [];
  openAiResponder = null;
  voiceRoutes._resetRateLimit();
  process.env.OPENAI_API_KEY = 'sk-test-voice';
});

test.after(() => {
  if (savedKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = savedKey;
});

test('transcribes audio with gpt-4o-mini-transcribe and returns text', async () => {
  await withServer(async (base) => {
    const res = await post(base, { type: 'audio/webm;codecs=opus', query: '?lang=en' });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { success: true, text: 'Find plumbers in Camas' });
    assert.equal(openAiCalls.length, 1);
    const call = openAiCalls[0];
    assert.equal(call.url, 'https://api.openai.com/v1/audio/transcriptions');
    assert.equal(call.auth, 'Bearer sk-test-voice');
    assert.equal(call.model, 'gpt-4o-mini-transcribe');
    assert.equal(call.fileName, 'dictation.webm');
    assert.equal(call.fileType, 'audio/webm');
    assert.equal(call.fileSize, 4000);
    assert.equal(call.language, 'en');
    assert.match(call.prompt, /Voice WS/);
    assert.match(call.prompt, /GHL/);
  });
});

test('iPhone mp4 recordings are sent as .m4a', async () => {
  await withServer(async (base) => {
    const res = await post(base, { type: 'audio/mp4' });
    assert.equal(res.status, 200);
    assert.equal(openAiCalls[0].fileName, 'dictation.m4a');
    assert.equal(openAiCalls[0].language, null);
  });
});

test('falls back to whisper-1 when the primary model is unavailable', async () => {
  openAiResponder = (n) =>
    n === 1
      ? { status: 404, body: { error: { code: 'model_not_found', message: 'The model does not exist' } } }
      : { status: 200, body: { text: 'hello from whisper' } };
  await withServer(async (base) => {
    const res = await post(base);
    assert.equal(res.status, 200);
    assert.equal(res.body.text, 'hello from whisper');
    assert.deepEqual(
      openAiCalls.map((c) => c.model),
      ['gpt-4o-mini-transcribe', 'whisper-1'],
    );
  });
});

test('upstream failures return JSON errors without retrying on non-model errors', async () => {
  openAiResponder = () => ({ status: 500, body: { error: { message: 'boom' } } });
  await withServer(async (base) => {
    const res = await post(base);
    assert.equal(res.status, 502);
    assert.equal(res.body.success, false);
    assert.equal(openAiCalls.length, 1);
  });
});

test('missing OpenAI key → 503 with a clear message', async () => {
  delete process.env.OPENAI_API_KEY;
  await withServer(async (base) => {
    const res = await post(base);
    assert.equal(res.status, 503);
    assert.equal(res.body.error, 'Voice transcription needs OPENAI_API_KEY on the server.');
    assert.equal(openAiCalls.length, 0);
  });
});

test('unauthenticated requests → 401 JSON', async () => {
  await withServer(async (base) => {
    const res = await post(base, { user: '' });
    assert.equal(res.status, 401);
    assert.equal(res.body.success, false);
    assert.equal(openAiCalls.length, 0);
  });
});

test('oversized audio → 413', async () => {
  await withServer(async (base) => {
    const res = await post(base, { body: Buffer.alloc(voiceRoutes.MAX_BYTES + 1024, 1) });
    assert.equal(res.status, 413);
    assert.equal(res.body.success, false);
    assert.equal(openAiCalls.length, 0);
  });
});

test('empty or non-audio bodies are rejected', async () => {
  await withServer(async (base) => {
    assert.equal((await post(base, { body: Buffer.alloc(0) })).status, 400);
    assert.equal((await post(base, { type: 'text/plain', body: 'hi' })).status, 415);
    assert.equal(openAiCalls.length, 0);
  });
});

test('per-user rate limit → 429 after the limit, other users unaffected', async () => {
  await withServer(async (base) => {
    for (let i = 0; i < voiceRoutes.RATE_LIMIT; i += 1) {
      const ok = await post(base, { body: Buffer.alloc(1000, 1) });
      assert.equal(ok.status, 200, `request ${i + 1}`);
    }
    const limited = await post(base, { body: Buffer.alloc(1000, 1) });
    assert.equal(limited.status, 429);
    assert.equal(limited.body.success, false);
    const other = await post(base, { body: Buffer.alloc(1000, 1), user: 'mate@example.com' });
    assert.equal(other.status, 200);
  });
});
