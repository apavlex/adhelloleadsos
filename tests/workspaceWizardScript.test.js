const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.APP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-script-'));

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { chatCompletion } = require('../services/llmClient');
const { starterOpeningScript } = require('../routes/workspaces');

function listen(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

test('starter opening script uses the wizard answers and merge tags', () => {
  const script = starterOpeningScript({
    businessName: 'Camas Flooring',
    targetAudience: 'Interior Designers',
    mainPainPoint: 'Slow installs',
    differentiator: 'Same day measure',
    desiredCta: 'Book a free consultation',
  });
  assert.match(script, /\{\{name\}\}/);
  assert.match(script, /\{\{company\}\}/);
  assert.match(script, /\{\{city\}\}/);
  assert.match(script, /Camas Flooring/);
  assert.match(script, /interior Designers/);
  assert.match(script, /same day measure/);
  assert.match(script, /book a free consultation/);
});

test('starter opening script works with almost no answers', () => {
  const script = starterOpeningScript({ businessName: 'Acme' });
  assert.match(script, /Acme/);
  assert.match(script, /quick call/);
});

test('chatCompletion gives up on a hung provider after timeoutMs', async () => {
  const server = await listen(() => {
    /* never respond */
  });
  const { port } = server.address();
  const started = Date.now();
  const out = await chatCompletion({
    messages: [{ role: 'user', content: 'hi' }],
    providersOverride: [{ name: 'hung', apiKey: 'x', url: `http://127.0.0.1:${port}/v1/chat/completions`, model: 'm' }],
    timeoutMs: 300,
  });
  server.closeAllConnections && server.closeAllConnections();
  server.close();
  assert.equal(out.content, null);
  assert.equal(out.error, true);
  assert.ok(Date.now() - started < 5000);
});

test('chatCompletion prefers message content over reasoning', async () => {
  const server = await listen((req, res) => {
    req.resume();
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          choices: [{ message: { content: '{"openingScript":"Hi"}', reasoning: 'Let me think about this...' } }],
        }),
      );
    });
  });
  const { port } = server.address();
  const out = await chatCompletion({
    messages: [{ role: 'user', content: 'hi' }],
    providersOverride: [{ name: 'ok', apiKey: 'x', url: `http://127.0.0.1:${port}/v1/chat/completions`, model: 'm' }],
    timeoutMs: 5000,
  });
  server.close();
  assert.equal(out.content, '{"openingScript":"Hi"}');
});
