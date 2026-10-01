const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const https = require('https');
const net = require('net');
const guestEgress = require('../lib/guestEgress');

guestEgress.install();

function listen() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => res.end('ok'));
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function requestError(fn) {
  return new Promise((resolve) => {
    const req = fn();
    req.on('error', resolve);
    req.on('response', () => resolve(null));
    if (typeof req.end === 'function' && !req.writableEnded) req.end();
  });
}

const guest = (extra = {}) => ({ guest: true, workspaceId: 'ws_test', ...extra });

test('only AI chat endpoints count as allowed AI requests', () => {
  assert.equal(guestEgress.isAiRequest('openrouter.ai', '/api/v1/chat/completions'), true);
  assert.equal(guestEgress.isAiRequest('api.openai.com', '/v1/chat/completions'), true);
  assert.equal(guestEgress.isAiRequest('api.openai.com', '/v1/audio/transcriptions'), true);
  assert.equal(guestEgress.isAiRequest('api.openai.com', '/v1/responses'), false);
  assert.equal(guestEgress.isAiRequest('api.openai.com', '/v1/images/generations'), false);
  assert.equal(
    guestEgress.isAiRequest('generativelanguage.googleapis.com', '/v1beta/models/gemini-2.5-flash:generateContent?key=x'),
    true,
  );
  assert.equal(guestEgress.isAiRequest('api.kie.ai', '/gpt-5-2/v1/chat/completions'), true);
  assert.equal(guestEgress.isAiRequest('api.kie.ai', '/api/v1/jobs/createTask'), false);
  assert.equal(guestEgress.isAiRequest('api.outscraper.com', '/maps/search-v3'), false);
});

test('guest context blocks fetch, http, and raw sockets; normal context is untouched', async () => {
  const server = await listen();
  const { port } = server.address();
  const url = `http://127.0.0.1:${port}/`;
  try {
    assert.equal(await (await fetch(url)).text(), 'ok');

    await guestEgress.run(guest(), async () => {
      await assert.rejects(fetch(url), (err) => err.code === 'DEMO_DISABLED');

      const httpErr = await requestError(() => http.get(url));
      assert.equal(httpErr && httpErr.code, 'DEMO_DISABLED');

      const reqErr = await requestError(() => http.request({ host: '127.0.0.1', port, path: '/' }));
      assert.equal(reqErr && reqErr.code, 'DEMO_DISABLED');

      const sockErr = await new Promise((resolve) => {
        const s = net.connect(port, '127.0.0.1');
        s.on('error', resolve);
        s.on('connect', () => {
          s.destroy();
          resolve(null);
        });
      });
      assert.equal(sockErr && sockErr.code, 'DEMO_DISABLED');
    });

    const later = await new Promise((resolve) => {
      guestEgress.run(guest(), () => {
        setTimeout(() => fetch(url).then(() => resolve(null), resolve), 5);
      });
    });
    assert.equal(later && later.code, 'DEMO_DISABLED', 'deferred work inherits the guest context');

    assert.equal(await (await fetch(url)).text(), 'ok');
  } finally {
    server.close();
  }
});

test('AI calls stop once the budget callback says no', async () => {
  let calls = 0;
  const ctx = guest({ onAiCall: () => (calls += 1) <= 0 });
  await guestEgress.run(ctx, async () => {
    await assert.rejects(
      fetch('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', body: '{}' }),
      (err) => err.code === 'DEMO_DISABLED' && err.demoReason === 'ai_budget',
    );
    const err = await requestError(() =>
      https.request({ host: 'api.openai.com', path: '/v1/chat/completions', method: 'POST' }),
    );
    assert.equal(err && err.demoReason, 'ai_budget');
  });
  assert.equal(calls, 2);
});
