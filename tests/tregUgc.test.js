const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.APP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'treg-ugc-'));

const test = require('node:test');
const assert = require('node:assert/strict');
const tregUgc = require('../services/tregUgc');

function mockResponse({ status = 200, headers = {}, json = {} }) {
  const lower = {};
  for (const [key, value] of Object.entries(headers)) lower[key.toLowerCase()] = value;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => lower[String(name).toLowerCase()] || null },
    text: async () => JSON.stringify(json),
  };
}

test('clip price stays on the published per-second rates', () => {
  assert.equal(tregUgc.estimateClipUsd(5, '480p'), 0.59);
  assert.equal(tregUgc.estimateClipUsd(8, '720p'), 2.13);
  assert.ok(tregUgc.clipMaxCostUsd(8, '720p') <= 2.5);
  assert.equal(tregUgc.estimateClipUsd(30, '1080p'), tregUgc.estimateClipUsd(8, '480p'));
});

test('character and clip prompts follow the ugc selfie contract', () => {
  const portrait = tregUgc.characterPrompt({ product: 'roof repair', presenter: 'a contractor' });
  assert.match(portrait, /smartphone selfie/);
  assert.match(portrait, /roof repair/);
  assert.match(portrait, /Not doll-like/);
  const spoken = tregUgc.clipPrompt({
    hook: 'I booked 14 jobs before lunch',
    product: 'roof repair',
    audioUrl: 'https://cdn.example/voice.mp3',
  });
  assert.match(spoken, /@image1/);
  assert.match(spoken, /@audio1/);
  assert.match(spoken, /I booked 14 jobs before lunch/);
  assert.match(spoken, /no captions/);
});

test('trend rows and a character job use the treg ugc endpoints', async () => {
  const previous = process.env.TREG_TOKEN;
  process.env.TREG_TOKEN = 'treg_test_token';
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (String(url).includes('treg.tiktok.search.videos')) {
      return mockResponse({
        headers: { 'x-treg-call-id': 'trend_1', 'x-treg-cost-micro': '2000' },
        json: {
          output: {
            videos: [
              { desc: 'Booked 14 roofs this week', share_url: 'https://www.tiktok.com/@a/video/1', author: { unique_id: 'roofer' }, statistics: { play_count: 1200 } },
              { title: 'not a video' },
            ],
          },
        },
      });
    }
    return mockResponse({
      headers: { 'x-treg-call-id': 'img_1', 'x-treg-cost-micro': '34000' },
      json: { id: 'task_char', status: 'processing' },
    });
  };

  try {
    const trends = await tregUgc.searchTrends({ q: 'roofers' }, { workspaceId: 'ws-ugc', fetchImpl });
    assert.equal(trends.videos.length, 2);
    assert.equal(trends.videos[0].author, 'roofer');
    assert.equal(trends.videos[0].views, 1200);
    assert.match(trends.videos[0].url, /tiktok\.com/);
    const trendBody = JSON.parse(calls[0].init.body);
    assert.equal(trendBody.q, 'roofers');
    assert.equal(calls[0].init.headers['X-Treg-Meta'], 'customer=ws-ugc, feature=ugc-trends');
    assert.equal(calls[0].init.headers['X-Treg-Route-Max-Cost'], '0.05');

    const job = await tregUgc.startCharacter(
      { product: 'roof repair' },
      { workspaceId: 'ws-ugc', fetchImpl },
    );
    assert.equal(job.kind, 'character');
    assert.equal(job.upstreamId, 'task_char');
    assert.equal(job.status, 'processing');
    const imageBody = JSON.parse(calls[1].init.body);
    assert.equal(imageBody.model, 'gemini-3-pro-image-preview');
    assert.equal(imageBody.size, '9:16');
    assert.equal(imageBody.resolution, '1K');
    assert.match(calls[1].url, /reapi\.image-gen\.gemini-3-pro-image$/);
  } finally {
    if (previous == null) delete process.env.TREG_TOKEN;
    else process.env.TREG_TOKEN = previous;
  }
});

test('a clip job sends Seedance the character image and then reads the video', async () => {
  const previous = process.env.TREG_TOKEN;
  process.env.TREG_TOKEN = 'treg_test_token';
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init, method: init.method });
    if (String(url).includes('reapi.tasks.get')) {
      return mockResponse({
        json: {
          id: 'task_clip',
          status: 'completed',
          output: { video_urls: ['https://cdn.example/clip.mp4'] },
        },
      });
    }
    return mockResponse({
      headers: { 'x-treg-call-id': 'clip_1' },
      json: { id: 'task_clip', status: 'processing' },
    });
  };

  try {
    await assert.rejects(
      () => tregUgc.startClip({ hook: 'hello' }, { workspaceId: 'ws-ugc', fetchImpl }),
      /character/i,
    );
    const job = await tregUgc.startClip(
      {
        hook: 'I booked 14 jobs before lunch',
        imageUrl: 'https://cdn.example/character.jpg',
        duration: 5,
        resolution: '480p',
      },
      { workspaceId: 'ws-ugc', fetchImpl },
    );
    const body = JSON.parse(calls[0].init.body);
    assert.equal(body.model, 'doubao-seedance-2.5-face');
    assert.equal(body.content_filter, false);
    assert.equal(body.duration, 5);
    assert.equal(body.resolution, '480p');
    assert.equal(body.size, '9:16');
    assert.deepEqual(body.image_urls, ['https://cdn.example/character.jpg']);
    assert.equal(calls[0].init.headers['X-Treg-Route-Max-Cost'], String(tregUgc.clipMaxCostUsd(5, '480p')));
    assert.match(body.prompt, /I booked 14 jobs before lunch/);

    const done = await tregUgc.refreshJob('ws-ugc', job.id, { fetchImpl });
    assert.equal(done.status, 'completed');
    assert.equal(done.videoUrl, 'https://cdn.example/clip.mp4');
    assert.match(calls[1].url, /reapi\.tasks\.get/);
    assert.match(calls[1].url, /id=task_clip/);
  } finally {
    if (previous == null) delete process.env.TREG_TOKEN;
    else process.env.TREG_TOKEN = previous;
  }
});
