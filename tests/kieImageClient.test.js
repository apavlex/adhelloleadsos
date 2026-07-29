const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseResultJson,
  extractImageUrls,
  isConfigured,
} = require('../services/kieImageClient');

test('parseResultJson parses string resultJson', () => {
  const record = {
    data: {
      state: 'success',
      resultJson: JSON.stringify({ resultUrls: ['https://cdn.example.com/a.png'] }),
    },
  };
  const parsed = parseResultJson(record);
  assert.equal(parsed.resultUrls[0], 'https://cdn.example.com/a.png');
});

test('extractImageUrls collects nested urls', () => {
  const record = {
    data: {
      resultJson: JSON.stringify({
        images: [{ url: 'https://cdn.example.com/front.png' }],
        meta: { thumb: 'https://cdn.example.com/thumb.png' },
      }),
    },
  };
  const urls = extractImageUrls(record);
  assert.deepEqual(urls.sort(), [
    'https://cdn.example.com/front.png',
    'https://cdn.example.com/thumb.png',
  ]);
});

test('isConfigured reflects env key presence', () => {
  const prev = process.env.KIE_AI_API_KEY;
  delete process.env.KIE_AI_API_KEY;
  delete process.env.KIE_API_KEY;
  assert.equal(isConfigured(), false);
  process.env.KIE_AI_API_KEY = 'test-key';
  assert.equal(isConfigured(), true);
  if (prev) process.env.KIE_AI_API_KEY = prev;
  else delete process.env.KIE_AI_API_KEY;
});

test('testConnection reports missing key', async () => {
  const { testConnection } = require('../services/kieImageClient');
  const prev = process.env.KIE_AI_API_KEY;
  delete process.env.KIE_AI_API_KEY;
  delete process.env.KIE_API_KEY;
  const out = await testConnection();
  assert.equal(out.ok, false);
  assert.match(out.message, /not set/i);
  if (prev) process.env.KIE_AI_API_KEY = prev;
});

test('friendlyKieImageError explains moderation and vague prompts', () => {
  const { friendlyKieImageError, isVagueImagePrompt } = require('../services/kieImageClient');
  assert.equal(isVagueImagePrompt('ok make it for me'), true);
  assert.match(
    friendlyKieImageError('Your prompt was caught by our AI moderator.', { prompt: 'ok make it for me' }),
    /detailed image prompt yet/i,
  );
  assert.match(
    friendlyKieImageError('Your prompt was caught by our AI moderator.', {
      prompt: 'Professional 4x6 postcard front for a local marketing agency, navy and cream, headline zone at top, laptop mockup center, clean print layout',
    }),
    /content filter blocked/i,
  );
});
