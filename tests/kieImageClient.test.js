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

async function captureCreateTask(opts) {
  const { createTask } = require('../services/kieImageClient');
  const prevKey = process.env.KIE_AI_API_KEY;
  const prevFetch = global.fetch;
  process.env.KIE_AI_API_KEY = 'test-key';
  let sent = null;
  global.fetch = async (url, init) => {
    sent = { url, body: JSON.parse(init.body) };
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ code: 200, data: { taskId: 'task-1' } }),
    };
  };
  try {
    const out = await createTask(opts);
    return { out, sent };
  } finally {
    global.fetch = prevFetch;
    if (prevKey) process.env.KIE_AI_API_KEY = prevKey;
    else delete process.env.KIE_AI_API_KEY;
  }
}

const LONG_PROMPT =
  'A friendly golden retriever sitting on a sunny porch, warm natural light, premium local business ad style.';

test('createTask sends each model its own reference-url field and edit model', async () => {
  const ref = ['https://example.com/canvas.png'];
  const cases = [
    ['gpt-image-2', 'gpt-image-2-image-to-image', 'input_urls'],
    ['grok-imagine-2', 'grok-imagine-image-2-0/image-edit', 'image_urls'],
    ['flux-2', 'flux-2/flex-image-to-image', 'input_urls'],
    ['nano-banana-2', 'nano-banana-2', 'image_input'],
  ];
  for (const [modelKey, kieModel, field] of cases) {
    const { out, sent } = await captureCreateTask({
      modelKey,
      prompt: 'add a cowboy hat',
      inputUrls: ref,
      editMode: true,
      aspectRatio: '1:1',
      resolution: '2K',
    });
    assert.equal(sent.body.model, kieModel, modelKey);
    assert.deepEqual(sent.body.input[field], ref, modelKey);
    assert.equal(out.modelKey, modelKey);
  }
});

test('createTask uses text models without refs and omits Grok resolution', async () => {
  const grok = await captureCreateTask({
    modelKey: 'grok-imagine-2',
    prompt: LONG_PROMPT,
    aspectRatio: '4:5',
    resolution: '2K',
  });
  assert.equal(grok.sent.body.model, 'grok-imagine-image-2-0/text-to-image');
  assert.equal('resolution' in grok.sent.body.input, false);
  assert.equal(grok.sent.body.input.aspect_ratio, '2:3');

  const nano = await captureCreateTask({ modelKey: 'nano-banana-2', prompt: LONG_PROMPT });
  assert.deepEqual(nano.sent.body.input.image_input, []);

  const fallback = await captureCreateTask({ modelKey: 'unknown-model', prompt: LONG_PROMPT });
  assert.equal(fallback.sent.body.model, 'gpt-image-2-text-to-image');
});

test('createTask refuses an update when no canvas image url survives', async () => {
  await assert.rejects(
    captureCreateTask({
      modelKey: 'gpt-image-2',
      prompt: 'add a cowboy hat',
      inputUrls: ['/direct-mail/api/creative/relative.png'],
      editMode: true,
    }),
    /current canvas image/i,
  );
});
