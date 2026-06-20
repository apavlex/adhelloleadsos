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
