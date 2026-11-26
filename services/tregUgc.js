/**
 * Creative-studio UGC, following the workflow at https://treg.to/ugc:
 * cheap trend pull, a Gemini character still, then a short Seedance clip.
 * Each step is its own call so the studio can show the price before it runs.
 * Voice clone, captions, and stitching stay out of this pass.
 */

const crypto = require('crypto');
const { tregCall, isConfigured } = require('./tregClient');

const IMAGE_ENDPOINT = 'reapi.image-gen.gemini-3-pro-image';
const VIDEO_ENDPOINT = 'reapi.video-gen.seedance-2-5.unrestricted';
const TASK_ENDPOINT = 'reapi.tasks.get';
const TREND_ENDPOINT = 'treg.tiktok.search.videos';

const IMAGE_USD = 0.034;
const VIDEO_RATE = { '480p': 0.1186, '720p': 0.26683 };
const JOB_TTL_MS = 24 * 60 * 60 * 1000;

function clipSeconds(raw) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return 5;
  return Math.min(8, Math.max(4, n));
}

function clipResolution(raw) {
  return String(raw || '').trim() === '720p' ? '720p' : '480p';
}

function estimateClipUsd(duration, resolution) {
  const seconds = clipSeconds(duration);
  const rate = VIDEO_RATE[clipResolution(resolution)];
  return Math.round(seconds * rate * 100) / 100;
}

function clipMaxCostUsd(duration, resolution) {
  const estimate = estimateClipUsd(duration, resolution);
  return Math.min(2.5, Math.round((estimate + 0.08) * 100) / 100);
}

function cleanLine(raw, max) {
  return String(raw || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function httpsUrl(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  let url;
  try {
    url = new URL(value);
  } catch {
    return '';
  }
  if (url.protocol !== 'https:') return '';
  return url.toString().slice(0, 800);
}

function characterPrompt(input) {
  const custom = cleanLine(input && input.prompt, 2000);
  if (custom) return custom;
  const product = cleanLine(input && input.product, 180) || 'a local service';
  const who = cleanLine(input && input.presenter, 180) || 'a person in their early 30s';
  return [
    `A realistic smartphone selfie of ${who}, about to talk about ${product}.`,
    'Phone front camera about 30 cm from the face, slight wide-angle, camera a little below eye level.',
    'Soft daylight from a window at frame right, cream wall slightly bright.',
    'Natural skin with visible pores, narrow eyes, imperfect teeth, a couple of flyaway hairs. Not doll-like, not airbrushed, not HDR.',
    'Casual shirt, looking into the lens, mouth closed. No text, no logo, no captions.',
  ].join(' ');
}

function clipPrompt(input) {
  const hook = cleanLine(input && input.hook, 500);
  const product = cleanLine(input && input.product, 180);
  const spoken = hook.replace(/"/g, "'");
  const audio = httpsUrl(input && input.audioUrl);
  const voice = audio
    ? 'She speaks with the exact voice, timbre, energy and speaking rhythm of @audio1: upbeat, quick, conversational, no whispering, no dramatic pauses.'
    : 'She speaks in a quick conversational creator delivery, no whispering, no dramatic pauses.';
  return [
    'The person in @image1 talks directly to the camera in a vertical smartphone selfie on a fixed tripod: same room, same clothes, same soft window daylight.',
    voice,
    'She keeps talking straight through the sentence breaks without stopping, only quick breaths.',
    `She says, in English, lips precisely synced to every word: "${spoken}"`,
    product ? `The thing she is talking about is ${product}, but she does not hold up a logo.` : '',
    'Her free hand gestures outward toward the camera and never points at herself, never touches her face or lips.',
    'Camera locked off, no cuts, no zoom, no captions, no on-screen text, no music, only her voice and quiet room tone.',
  ]
    .filter(Boolean)
    .join(' ');
}

function unwrapTask(body) {
  if (!body || typeof body !== 'object') return {};
  if (body.status && (body.output || body.id || body.error)) return body;
  if (body.raw && typeof body.raw === 'object' && body.raw.status) return body.raw;
  return body;
}

function firstHttps(list) {
  if (!Array.isArray(list)) return '';
  for (const item of list) {
    if (typeof item === 'string' && /^https:\/\//i.test(item)) return item;
    if (item && typeof item.url === 'string' && /^https:\/\//i.test(item.url)) return item.url;
  }
  return '';
}

function taskView(body) {
  const row = unwrapTask(body);
  const output = row.output && typeof row.output === 'object' ? row.output : {};
  const status = String(row.status || '').toLowerCase();
  const err = row.error;
  let message = '';
  if (typeof err === 'string') message = err;
  else if (err && typeof err === 'object') message = String(err.message || err.code || '');
  return {
    id: String(row.id || ''),
    status,
    imageUrl: firstHttps(output.image_urls),
    videoUrl: firstHttps(output.video_urls || output.videos),
    message: message.slice(0, 240),
  };
}

function trendRows(body) {
  const output = body && body.output && typeof body.output === 'object' ? body.output : body || {};
  const lists = [output.videos, output.results, output.items, output.aweme_list, body && body.videos];
  let rows = [];
  for (const list of lists) {
    if (Array.isArray(list) && list.length) {
      rows = list;
      break;
    }
  }
  return rows.slice(0, 8).map((row) => {
    const video = (row && (row.video || row.aweme)) || row || {};
    const author = video.author || row.author || {};
    const stats = video.statistics || video.stats || row.stats || {};
    const title = [video.title, video.desc, video.description, video.caption, row.title, row.desc]
      .map((v) => (typeof v === 'string' ? v.trim() : ''))
      .find(Boolean) || '';
    const url = [video.share_url, video.url, video.play_url, video.link, row.url, row.link]
      .map((v) => (typeof v === 'string' ? v.trim() : ''))
      .find((v) => /^https?:\/\//i.test(v)) || '';
    const name = [author.unique_id, author.nickname, author.name, typeof row.author === 'string' ? row.author : '']
      .map((v) => (typeof v === 'string' ? v.trim() : ''))
      .find(Boolean) || '';
    const views = Number(stats.play_count || stats.view_count || stats.views || row.views || 0) || 0;
    return { title: title.slice(0, 280), url, author: name.slice(0, 80), views };
  }).filter((row) => row.title || row.url);
}

function jobKey(workspaceId, jobId) {
  return `treg:ugc:${String(workspaceId || '').trim()}:${String(jobId || '').trim()}`;
}

function readJob(workspaceId, jobId) {
  const db = require('./database');
  const raw = db.getKvSync(jobKey(workspaceId, jobId));
  if (!raw) return null;
  try {
    const job = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return job && job.id ? job : null;
  } catch {
    return null;
  }
}

function writeJob(job) {
  const db = require('./database');
  db.setKvSync(jobKey(job.workspaceId, job.id), JSON.stringify(job));
  return job;
}

function newJob(workspaceId, fields) {
  return {
    id: `ugc_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`,
    workspaceId: String(workspaceId || '').trim(),
    createdAt: new Date().toISOString(),
    status: 'processing',
    ...fields,
  };
}

async function assertReady(opts) {
  const apiToken = await require('./tregClient').resolveToken(opts || {});
  if (!apiToken) {
    const err = new Error('Add a Treg API key under Workspace → Integrations, then generate from the studio.');
    err.status = 409;
    err.code = 'TREG_NOT_CONFIGURED';
    throw err;
  }
}

async function searchTrends(input, opts = {}) {
  await assertReady(opts);
  const q = cleanLine(input && input.q, 160);
  if (!q) {
    const err = new Error('Add a niche or keyword to study.');
    err.status = 400;
    throw err;
  }
  const { body, callId, costMicro } = await tregCall(TREND_ENDPOINT, {
    method: 'POST',
    body: { q, limit: 8 },
    feature: 'ugc-trends',
    workspaceId: opts.workspaceId,
    maxCostUsd: 0.05,
    fetchImpl: opts.fetchImpl,
    timeoutMs: 45000,
  });
  return { videos: trendRows(body), callId, costMicro };
}

async function startCharacter(input, opts = {}) {
  await assertReady(opts);
  const prompt = characterPrompt(input);
  const { body, callId } = await tregCall(IMAGE_ENDPOINT, {
    method: 'POST',
    body: {
      model: 'gemini-3-pro-image-preview',
      prompt,
      size: '9:16',
      resolution: '1K',
    },
    feature: 'ugc-character',
    workspaceId: opts.workspaceId,
    maxCostUsd: 0.08,
    fetchImpl: opts.fetchImpl,
    timeoutMs: 45000,
  });
  const task = taskView(body);
  if (!task.id) {
    const err = new Error('Treg did not return a character task.');
    err.status = 502;
    throw err;
  }
  const job = newJob(opts.workspaceId, {
    kind: 'character',
    upstreamId: task.id,
    callId,
    prompt,
    estimateUsd: IMAGE_USD,
    imageUrl: task.imageUrl || '',
    status: task.imageUrl ? 'completed' : 'processing',
  });
  return writeJob(job);
}

async function startClip(input, opts = {}) {
  await assertReady(opts);
  const hook = cleanLine(input && input.hook, 500);
  if (!hook) {
    const err = new Error('Write the line the person should say.');
    err.status = 400;
    throw err;
  }
  const imageUrl = httpsUrl(input && input.imageUrl);
  if (!imageUrl) {
    const err = new Error('Create a character first. The clip needs that public image.');
    err.status = 400;
    throw err;
  }
  const audioUrl = httpsUrl(input && input.audioUrl);
  const duration = clipSeconds(input && input.duration);
  const resolution = clipResolution(input && input.resolution);
  const prompt = clipPrompt({ hook, product: input && input.product, audioUrl });
  const payload = {
    model: 'doubao-seedance-2.5-face',
    content_filter: false,
    prompt,
    duration,
    size: '9:16',
    resolution,
    generate_audio: true,
    image_urls: [imageUrl],
  };
  if (audioUrl) payload.audio_urls = [audioUrl];
  const { body, callId } = await tregCall(VIDEO_ENDPOINT, {
    method: 'POST',
    body: payload,
    feature: 'ugc-clip',
    workspaceId: opts.workspaceId,
    maxCostUsd: clipMaxCostUsd(duration, resolution),
    fetchImpl: opts.fetchImpl,
    timeoutMs: 45000,
  });
  const task = taskView(body);
  if (!task.id) {
    const err = new Error('Treg did not return a clip task.');
    err.status = 502;
    throw err;
  }
  const job = newJob(opts.workspaceId, {
    kind: 'clip',
    upstreamId: task.id,
    callId,
    hook,
    imageUrl,
    audioUrl,
    duration,
    resolution,
    estimateUsd: estimateClipUsd(duration, resolution),
    videoUrl: task.videoUrl || '',
    status: task.videoUrl ? 'completed' : 'processing',
  });
  return writeJob(job);
}

async function refreshJob(workspaceId, jobId, opts = {}) {
  const job = readJob(workspaceId, jobId);
  if (!job) {
    const err = new Error('That UGC job was not found.');
    err.status = 404;
    throw err;
  }
  if (job.status === 'completed' || job.status === 'failed') return job;
  const started = Date.parse(job.createdAt);
  if (Number.isFinite(started) && Date.now() - started > JOB_TTL_MS) {
    job.status = 'failed';
    job.error = 'This UGC job expired. Start it again.';
    return writeJob(job);
  }
  const { body } = await tregCall(TASK_ENDPOINT, {
    method: 'GET',
    query: { id: job.upstreamId },
    feature: 'ugc-poll',
    workspaceId,
    maxCostUsd: 0,
    fetchImpl: opts.fetchImpl,
    timeoutMs: 30000,
  });
  const task = taskView(body);
  if (task.status === 'failed') {
    job.status = 'failed';
    job.error = task.message || 'Treg could not finish this UGC step. Failed tasks are not billed.';
    return writeJob(job);
  }
  if (task.imageUrl) job.imageUrl = task.imageUrl;
  if (task.videoUrl) job.videoUrl = task.videoUrl;
  const ready = job.kind === 'character' ? job.imageUrl : job.videoUrl;
  if (task.status === 'completed' || ready) {
    job.status = ready ? 'completed' : 'processing';
    if (task.status === 'completed' && !ready) {
      job.status = 'failed';
      job.error = 'Treg finished without a file URL.';
    }
  }
  return writeJob(job);
}

module.exports = {
  IMAGE_USD,
  isConfigured,
  estimateClipUsd,
  clipMaxCostUsd,
  characterPrompt,
  clipPrompt,
  trendRows,
  taskView,
  searchTrends,
  startCharacter,
  startClip,
  refreshJob,
};
