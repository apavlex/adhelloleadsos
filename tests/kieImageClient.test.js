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

test('normalizeAspectAndResolution downgrades incompatible 1:1 + 4K', () => {
  const { normalizeAspectAndResolution } = require('../services/kieImageClient');
  const out = normalizeAspectAndResolution('1:1', '4K');
  assert.equal(out.aspectRatio, '1:1');
  assert.equal(out.resolution, '2K');
  assert.equal(out.adjusted, true);
  assert.match(out.note, /2K/i);

  const auto = normalizeAspectAndResolution('auto', '4K');
  assert.equal(auto.resolution, '1K');

  const portrait = normalizeAspectAndResolution('4:5', '2K');
  assert.equal(portrait.resolution, '1K');

  const ok = normalizeAspectAndResolution('16:9', '4K');
  assert.equal(ok.resolution, '4K');
  assert.equal(ok.adjusted, false);
});

test('listImageModels includes curated KIE models', () => {
  const { listImageModels, getImageModel, DEFAULT_MODEL_KEY } = require('../services/kieImageClient');
  const models = listImageModels();
  const keys = models.map((m) => m.key);
  assert.deepEqual(keys.sort(), ['flux-2', 'gpt-image-2', 'grok-imagine-2', 'nano-banana-2'].sort());
  assert.equal(DEFAULT_MODEL_KEY, 'gpt-image-2');
  assert.equal(getImageModel('grok-imagine-2').editModel, 'grok-imagine-image-2-0/image-edit');
  assert.equal(getImageModel('flux-2').urlField, 'input_urls');
  assert.equal(getImageModel('nano-banana-2').urlField, 'image_input');
  assert.equal(getImageModel('unknown').key, 'gpt-image-2');
});

test('normalizeAspectAndResolution maps ratios per model', () => {
  const { normalizeAspectAndResolution } = require('../services/kieImageClient');
  const grok = normalizeAspectAndResolution('4:5', '2K', 'grok-imagine-2');
  assert.equal(grok.aspectRatio, '2:3');
  assert.equal(grok.resolution, '');

  const flux = normalizeAspectAndResolution('16:9', '4K', 'flux-2');
  assert.equal(flux.aspectRatio, '16:9');
  assert.equal(flux.resolution, '2K');
});

test('isVagueImagePrompt allows short refine prompts in edit mode', () => {
  const { isVagueImagePrompt } = require('../services/kieImageClient');
  assert.equal(isVagueImagePrompt('add a cowboy hat'), true);
  assert.equal(isVagueImagePrompt('add a cowboy hat', { editMode: true }), false);
  assert.equal(isVagueImagePrompt('ok', { editMode: true }), true);
});
