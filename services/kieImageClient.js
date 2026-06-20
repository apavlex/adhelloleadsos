/**
 * KIE Market API — GPT Image 2 text-to-image and image-to-image.
 * Docs: https://kie.ai/gpt-image-2
 *
 * Env:
 *   KIE_AI_API_KEY or KIE_API_KEY — Bearer token
 *   KIE_AI_BASE_URL — default https://api.kie.ai
 */

const DEFAULT_BASE = 'https://api.kie.ai';
const TEXT_MODEL = 'gpt-image-2-text-to-image';
const IMAGE_MODEL = 'gpt-image-2-image-to-image';

function apiKey() {
  return String(process.env.KIE_AI_API_KEY || process.env.KIE_API_KEY || '').trim();
}

function baseUrl() {
  return String(process.env.KIE_AI_BASE_URL || DEFAULT_BASE).replace(/\/$/, '');
}

function isConfigured() {
  return !!apiKey();
}

/** True when the text is too short to send as a GPT Image 2 prompt. */
function isVagueImagePrompt(prompt) {
  const p = String(prompt || '').trim();
  if (!p) return true;
  if (p.length < 48) return true;
  if (p.length < 140 && /^(ok|okay|yes|sure|make it|do it|generate|go ahead|please|create it|make this|make one|make the|build it|design it)\b/i.test(p)) {
    return true;
  }
  return false;
}

/**
 * Turn raw KIE / generation errors into actionable copy for the Design studio UI.
 */
function friendlyKieImageError(raw, { prompt } = {}) {
  const msg = String(raw || '').trim();
  const lower = msg.toLowerCase();
  const vague = isVagueImagePrompt(prompt);

  if (vague) {
    return (
      'That isn’t a detailed image prompt yet. Use Chat to describe the postcard, then ask for a “final image prompt.” ' +
      'When you see “Prompt ready — click Generate,” hit Generate. Short phrases like “make it for me” are sent to Chat, not the image API.'
    );
  }

  if (/moderator|moderation|moderat|caught by our ai/i.test(lower)) {
    return (
      'KIE’s content filter blocked this image prompt. Rephrase in Chat: describe layout, colors, and a professional local-business look. ' +
      'Avoid urgent or scammy wording (e.g. “act now,” “limited time”). Ask for a revised final prompt, then Generate again.'
    );
  }

  if (/401|unauthorized|invalid.*key|api key/i.test(lower)) {
    return 'KIE API key is missing or invalid. Ask a workspace admin to set KIE_AI_API_KEY on the server.';
  }

  if (/timed out|timeout/i.test(lower)) {
    return 'Image generation timed out — KIE was slow. Wait a few seconds and click Generate again.';
  }

  if (/no result url|no result/i.test(lower)) {
    return 'KIE finished but returned no image URL. Try Generate again or shorten the prompt in Chat.';
  }

  if (msg) {
    return `${msg} If this keeps happening, refine the prompt in Chat (layout, colors, style) and Generate again.`;
  }

  return 'Image generation failed. Use Chat to build a detailed prompt, wait for “Prompt ready,” then click Generate.';
}

function throwFriendlyKieError(raw, opts) {
  const err = new Error(friendlyKieImageError(raw, opts));
  err.kieFriendly = true;
  throw err;
}

async function kieRequest(method, path, { body } = {}) {
  const key = apiKey();
  if (!key) throw new Error('KIE API key is not configured. Set KIE_AI_API_KEY or KIE_API_KEY.');

  const url = path.startsWith('http') ? path : `${baseUrl()}${path.startsWith('/') ? path : `/${path}`}`;
  const res = await fetch(url, {
    method: method || 'GET',
    headers: {
      Authorization: `Bearer ${key}`,
      Accept: 'application/json',
      ...(body != null ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch (_) {
    data = { raw: text };
  }

  if (!res.ok) {
    const msg =
      (data && data.msg) ||
      (data && data.message) ||
      (data && data.error) ||
      `KIE API error (${res.status})`;
    const raw = typeof msg === 'string' ? msg : JSON.stringify(msg);
    const err = new Error(friendlyKieImageError(raw, { prompt: body && body.input && body.input.prompt }));
    err.status = res.status;
    err.body = data;
    err.kieFriendly = true;
    throw err;
  }

  return data;
}

async function createTask({ prompt, inputUrls, aspectRatio, resolution }) {
  const p = String(prompt || '').trim();
  if (!p) throw new Error('Image prompt is required.');
  if (isVagueImagePrompt(p)) {
    throwFriendlyKieError('', { prompt: p });
  }

  const urls = (Array.isArray(inputUrls) ? inputUrls : [])
    .map((u) => String(u || '').trim())
    .filter((u) => /^https?:\/\//i.test(u));

  const model = urls.length ? IMAGE_MODEL : TEXT_MODEL;
  const input = {
    prompt: p.slice(0, 20000),
    aspect_ratio: aspectRatio || '2:3',
  };
  if (resolution) input.resolution = resolution;
  if (urls.length) input.input_urls = urls.slice(0, 16);

  const response = await kieRequest('POST', '/api/v1/jobs/createTask', {
    body: { model, input },
  });

  const taskId = String((response.data && response.data.taskId) || '').trim();
  if (!taskId) {
    throw new Error('KIE did not return a task id.');
  }
  return { taskId, model, createResponse: response };
}

async function getTaskRecord(taskId) {
  const id = String(taskId || '').trim();
  if (!id) throw new Error('taskId is required.');
  const q = new URLSearchParams({ taskId: id }).toString();
  return kieRequest('GET', `/api/v1/jobs/recordInfo?${q}`);
}

function parseResultJson(record) {
  const data = (record && record.data) || {};
  const raw = data.resultJson;
  if (typeof raw === 'string' && raw.trim()) {
    try {
      return JSON.parse(raw);
    } catch (_) {
      return { raw };
    }
  }
  return raw && typeof raw === 'object' ? raw : {};
}

function collectUrls(value, out) {
  const urls = out || [];
  if (typeof value === 'string' && /^https?:\/\//i.test(value)) {
    urls.push(value);
  } else if (Array.isArray(value)) {
    value.forEach((item) => collectUrls(item, urls));
  } else if (value && typeof value === 'object') {
    Object.values(value).forEach((item) => collectUrls(item, urls));
  }
  return urls;
}

function extractImageUrls(record) {
  return [...new Set(collectUrls(parseResultJson(record), []))];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Poll KIE task until success, fail, or timeout.
 * @returns {{ state: string, urls: string[], record: object }}
 */
async function pollUntilDone(taskId, { maxWaitMs = 120000, intervalMs = 4000, prompt } = {}) {
  const deadline = Date.now() + maxWaitMs;
  let last = {};

  while (Date.now() < deadline) {
    last = await getTaskRecord(taskId);
    const data = last.data || {};
    const state = String(data.state || '').toLowerCase();

    if (state === 'success') {
      const urls = extractImageUrls(last);
      if (!urls.length) {
        throw new Error('Image generation finished but no result URL was returned.');
      }
      return { state: 'success', urls, record: last };
    }

    if (state === 'fail') {
      const msg = data.failMsg || data.failCode || 'Image generation failed.';
      throwFriendlyKieError(String(msg), { prompt });
    }

    await sleep(intervalMs);
  }

  throwFriendlyKieError('Image generation timed out — try again in a moment.', { prompt });
}

/**
 * Create task and wait for the first result image URL.
 */
async function generate({ prompt, inputUrls, aspectRatio, resolution, maxWaitMs, intervalMs }) {
  const { taskId, model } = await createTask({ prompt, inputUrls, aspectRatio, resolution });
  const result = await pollUntilDone(taskId, { maxWaitMs, intervalMs, prompt });
  return {
    taskId,
    model,
    imageUrl: result.urls[0],
    urls: result.urls,
    record: result.record,
  };
}

module.exports = {
  TEXT_MODEL,
  IMAGE_MODEL,
  apiKey,
  isConfigured,
  isVagueImagePrompt,
  friendlyKieImageError,
  createTask,
  getTaskRecord,
  parseResultJson,
  extractImageUrls,
  pollUntilDone,
  generate,
};
