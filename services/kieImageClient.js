/**
 * KIE Market API — multi-model text-to-image and image edit.
 * Docs: https://docs.kie.ai
 *
 * Env:
 *   KIE_AI_API_KEY or KIE_API_KEY — Bearer token
 *   KIE_AI_BASE_URL — default https://api.kie.ai
 */

const DEFAULT_BASE = 'https://api.kie.ai';
const DEFAULT_MODEL_KEY = 'gpt-image-2';

/** @deprecated Prefer IMAGE_MODELS / getImageModel — kept for older callers. */
const TEXT_MODEL = 'gpt-image-2-text-to-image';
/** @deprecated Prefer IMAGE_MODELS / getImageModel — kept for older callers. */
const IMAGE_MODEL = 'gpt-image-2-image-to-image';

/**
 * Curated Marketing Studio models.
 * urlField: how reference images are passed on createTask input.
 */
const IMAGE_MODELS = {
  'gpt-image-2': {
    key: 'gpt-image-2',
    label: 'GPT Image 2',
    shortLabel: 'GPT Image 2',
    textModel: 'gpt-image-2-text-to-image',
    editModel: 'gpt-image-2-image-to-image',
    urlField: 'input_urls',
    maxUrls: 16,
    supportsResolution: true,
    resolutions: ['1K', '2K', '4K'],
    aspectRatios: null, // accept studio ratios; normalizeAspectAndResolution applies GPT rules
    promptMax: 20000,
  },
  'grok-imagine-2': {
    key: 'grok-imagine-2',
    label: 'Grok Imagine 2.0',
    shortLabel: 'Grok',
    textModel: 'grok-imagine-image-2-0/text-to-image',
    editModel: 'grok-imagine-image-2-0/image-edit',
    urlField: 'image_urls',
    maxUrls: 5,
    supportsResolution: false,
    resolutions: [],
    aspectRatios: ['1:1', '2:3', '3:2', '16:9', '9:16', 'auto'],
    promptMax: 8000,
  },
  'flux-2': {
    key: 'flux-2',
    label: 'Flux.2',
    shortLabel: 'Flux.2',
    textModel: 'flux-2/flex-text-to-image',
    editModel: 'flux-2/flex-image-to-image',
    urlField: 'input_urls',
    maxUrls: 8,
    supportsResolution: true,
    resolutions: ['1K', '2K'],
    aspectRatios: ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', 'auto'],
    promptMax: 5000,
  },
  'nano-banana-2': {
    key: 'nano-banana-2',
    label: 'Nano Banana 2',
    shortLabel: 'Nano Banana',
    textModel: 'nano-banana-2',
    editModel: 'nano-banana-2',
    urlField: 'image_input',
    maxUrls: 14,
    supportsResolution: true,
    resolutions: ['1K', '2K'],
    aspectRatios: [
      '1:1',
      '2:3',
      '3:2',
      '4:3',
      '3:4',
      '4:5',
      '5:4',
      '9:16',
      '16:9',
      '21:9',
      'auto',
    ],
    promptMax: 20000,
  },
};

function apiKey() {
  return String(process.env.KIE_AI_API_KEY || process.env.KIE_API_KEY || '').trim();
}

function baseUrl() {
  return String(process.env.KIE_AI_BASE_URL || DEFAULT_BASE).replace(/\/$/, '');
}

function isConfigured() {
  return !!apiKey();
}

function listImageModels() {
  return Object.values(IMAGE_MODELS).map((m) => ({
    key: m.key,
    label: m.label,
    shortLabel: m.shortLabel,
    supportsResolution: m.supportsResolution,
    resolutions: m.resolutions.slice(),
  }));
}

function getImageModel(modelKey) {
  const key = String(modelKey || '').trim();
  return IMAGE_MODELS[key] || IMAGE_MODELS[DEFAULT_MODEL_KEY];
}

function nearestAspectRatio(requested, allowed) {
  const req = String(requested || '1:1').trim() || '1:1';
  if (!allowed || !allowed.length) return req;
  if (allowed.includes(req)) return req;
  if (req === 'auto' && allowed.includes('auto')) return 'auto';

  function parts(r) {
    const m = /^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/.exec(r);
    if (!m) return null;
    const w = Number(m[1]);
    const h = Number(m[2]);
    if (!w || !h) return null;
    return w / h;
  }

  const target = parts(req);
  if (target == null) {
    return allowed.includes('1:1') ? '1:1' : allowed[0];
  }

  let best = allowed[0];
  let bestDist = Infinity;
  for (const candidate of allowed) {
    if (candidate === 'auto') continue;
    const ratio = parts(candidate);
    if (ratio == null) continue;
    const dist = Math.abs(Math.log(ratio) - Math.log(target));
    if (dist < bestDist) {
      bestDist = dist;
      best = candidate;
    }
  }
  return best;
}

/**
 * True when the text is too short to send as a fresh text-to-image prompt.
 * Short refine instructions are allowed when editing an existing canvas image.
 */
function isVagueImagePrompt(prompt, { editMode } = {}) {
  const p = String(prompt || '').trim();
  if (!p) return true;
  if (editMode) {
    if (p.length < 8) return true;
    if (/^(ok|okay|yes|sure|generate|go ahead|please)\b/i.test(p) && p.length < 24) return true;
    return false;
  }
  if (p.length < 48) return true;
  if (
    p.length < 140 &&
    /^(ok|okay|yes|sure|make it|do it|generate|go ahead|please|create it|make this|make one|make the|build it|design it)\b/i.test(
      p,
    )
  ) {
    return true;
  }
  return false;
}

/**
 * Normalize aspect/resolution for a specific model (defaults to GPT Image 2 rules).
 * @returns {{ aspectRatio: string, resolution: string, adjusted: boolean, note: string }}
 */
function normalizeAspectAndResolution(aspectRatio, resolution, modelKey) {
  const model = getImageModel(modelKey);
  let ar = String(aspectRatio || '1:1').trim() || '1:1';
  let res = String(resolution || '2K').trim().toUpperCase() || '2K';
  const notes = [];

  if (model.aspectRatios && model.aspectRatios.length) {
    const mapped = nearestAspectRatio(ar, model.aspectRatios);
    if (mapped !== ar) {
      notes.push(`${model.label} does not support ${ar} — using ${mapped}.`);
      ar = mapped;
    }
  }

  if (!model.supportsResolution) {
    return {
      aspectRatio: ar,
      resolution: '',
      adjusted: notes.length > 0,
      note: notes.join(' '),
    };
  }

  if (!model.resolutions.includes(res)) {
    const fallback = model.resolutions.includes('2K')
      ? '2K'
      : model.resolutions[model.resolutions.length - 1] || '1K';
    if (res !== fallback) {
      notes.push(`${model.label} max export is ${fallback} — switched from ${res}.`);
    }
    res = fallback;
  }

  // GPT-specific combo rules (kept for default model)
  if (model.key === 'gpt-image-2') {
    const highResBlocked = new Set(['5:4', '4:5', '3:1', '1:3', '9:21']);
    if (ar === 'auto' && res !== '1K') {
      res = '1K';
      notes.push('Auto aspect ratio only supports 1K — switched to 1K.');
    }
    if (ar === '1:1' && res === '4K') {
      res = '2K';
      notes.push('Square (1:1) cannot use 4K on GPT Image 2 — switched to 2K.');
    }
    if ((res === '2K' || res === '4K') && highResBlocked.has(ar)) {
      res = '1K';
      notes.push(`${ar} only supports 1K on GPT Image 2 — switched to 1K.`);
    }
  }

  if (model.key === 'flux-2' && res === '4K') {
    res = '2K';
    notes.push('Flux.2 max export is 2K — switched from 4K.');
  }

  return {
    aspectRatio: ar,
    resolution: res,
    adjusted: notes.length > 0,
    note: notes.join(' '),
  };
}

/**
 * Turn raw KIE / generation errors into actionable copy for the Design studio UI.
 */
function friendlyKieImageError(raw, { prompt, aspectRatio, resolution, editMode, modelKey } = {}) {
  const msg = String(raw || '').trim();
  const lower = msg.toLowerCase();
  const model = getImageModel(modelKey);
  const vague = isVagueImagePrompt(prompt, { editMode });

  if (vague) {
    if (editMode) {
      return (
        'Add a short edit instruction (e.g. “add a cowboy hat” or “make the headline orange”), then click Update.'
      );
    }
    return (
      'That isn’t a detailed image prompt yet. Use Chat to describe the creative for your selected format, then ask for a “final image prompt.” ' +
      'When you see “Prompt ready — click Generate,” hit Generate. Short phrases like “make it for me” are sent to Chat, not the image API.'
    );
  }

  if (
    /1:1.*4k|4k.*1:1|aspect.?ratio.*resolution|resolution.*aspect|cannot be converted to 4k|only.*1k/i.test(
      lower,
    ) ||
    (/422|invalid.*param|param.*invalid|validation/i.test(lower) &&
      (String(aspectRatio) === '1:1' || String(resolution) === '4K'))
  ) {
    return (
      `That aspect ratio and export quality aren’t compatible on ${model.label}. ` +
      'Switch Export quality or the ratio, then Generate again.'
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
    const err = new Error(
      friendlyKieImageError(raw, { prompt: body && body.input && body.input.prompt }),
    );
    err.status = res.status;
    err.body = data;
    err.kieFriendly = true;
    throw err;
  }

  const bizCode = data && data.code != null ? Number(data.code) : null;
  if (bizCode != null && bizCode !== 200 && bizCode !== 0) {
    const msg =
      (data && data.msg) ||
      (data && data.message) ||
      (data && data.error) ||
      `KIE API error (code ${bizCode})`;
    const raw = typeof msg === 'string' ? msg : JSON.stringify(msg);
    const err = new Error(
      friendlyKieImageError(raw, { prompt: body && body.input && body.input.prompt }),
    );
    err.status = bizCode >= 400 && bizCode < 600 ? bizCode : 502;
    err.body = data;
    err.kieFriendly = true;
    throw err;
  }

  return data;
}

async function testConnection() {
  if (!isConfigured()) {
    return { configured: false, ok: false, message: 'KIE_AI_API_KEY is not set on the server.' };
  }
  try {
    await getTaskRecord('adhello_connection_probe');
  } catch (err) {
    const msg = String((err && err.message) || '');
    if (/401|403|unauthorized|invalid.*key|api key is missing|api key is not configured/i.test(msg)) {
      return { configured: true, ok: false, message: 'KIE API key is invalid or unauthorized.' };
    }
    return { configured: true, ok: true, message: 'KIE API key accepted.' };
  }
  return { configured: true, ok: true, message: 'KIE API key accepted.' };
}

function buildModelInput(model, { prompt, urls, aspectRatio, resolution }) {
  const maxLen = model.promptMax || 20000;
  const input = {
    prompt: String(prompt || '').slice(0, maxLen),
    aspect_ratio: aspectRatio || '1:1',
  };
  if (model.supportsResolution && resolution) {
    input.resolution = resolution;
  }
  const capped = (urls || []).slice(0, model.maxUrls || 8);
  if (capped.length) {
    input[model.urlField] = capped;
  } else if (model.urlField === 'image_input') {
    // Nano Banana expects the field even for pure text-to-image.
    input.image_input = [];
  }
  return input;
}

async function createTask({
  prompt,
  inputUrls,
  aspectRatio,
  resolution,
  modelKey,
  editMode,
}) {
  const model = getImageModel(modelKey);
  const p = String(prompt || '').trim();
  if (!p) throw new Error('Image prompt is required.');

  const urls = (Array.isArray(inputUrls) ? inputUrls : [])
    .map((u) => String(u || '').trim())
    .filter((u) => /^https?:\/\//i.test(u));

  if (editMode === true && !urls.length) {
    const err = new Error(
      'Could not attach the current canvas image for this update. Save or re-upload the design, then try again.',
    );
    err.kieFriendly = true;
    throw err;
  }
  const isEdit = urls.length > 0;
  if (isVagueImagePrompt(p, { editMode: isEdit })) {
    throwFriendlyKieError('', { prompt: p, editMode: isEdit, modelKey: model.key });
  }

  const normalized = normalizeAspectAndResolution(aspectRatio, resolution, model.key);
  const kieModel = isEdit ? model.editModel : model.textModel;
  const input = buildModelInput(model, {
    prompt: p,
    urls,
    aspectRatio: normalized.aspectRatio,
    resolution: normalized.resolution,
  });

  let response;
  try {
    response = await kieRequest('POST', '/api/v1/jobs/createTask', {
      body: { model: kieModel, input },
    });
  } catch (err) {
    if (err && !err.kieFriendly) {
      throwFriendlyKieError(err.message, {
        prompt: p,
        aspectRatio: normalized.aspectRatio,
        resolution: normalized.resolution,
        editMode: isEdit,
        modelKey: model.key,
      });
    }
    throw err;
  }

  const taskId = String((response.data && response.data.taskId) || '').trim();
  if (!taskId) {
    throw new Error('KIE did not return a task id.');
  }
  return {
    taskId,
    model: kieModel,
    modelKey: model.key,
    modelLabel: model.label,
    createResponse: response,
    aspectRatio: normalized.aspectRatio,
    resolution: normalized.resolution,
    normalizeNote: normalized.note || '',
  };
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

/**
 * Convert a KIE result URL into a short-lived downloadable link.
 * Useful when the raw tempfile CDN URL is blocked or flaky.
 */
async function resolveDownloadableUrl(imageUrl) {
  const url = String(imageUrl || '').trim();
  if (!url || !/^https?:\/\//i.test(url)) return '';
  try {
    const response = await kieRequest('POST', '/api/v1/common/download-url', {
      body: { url },
    });
    const data = (response && response.data) || {};
    const fresh =
      data.downloadUrl ||
      data.download_url ||
      data.url ||
      (response && (response.downloadUrl || response.url)) ||
      '';
    const out = String(fresh || '').trim();
    return /^https?:\/\//i.test(out) ? out : '';
  } catch (_) {
    return '';
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Poll KIE task until success, fail, or timeout.
 * @returns {{ state: string, urls: string[], record: object }}
 */
async function pollUntilDone(taskId, { maxWaitMs = 120000, intervalMs = 4000, prompt, modelKey } = {}) {
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
      throwFriendlyKieError(String(msg), { prompt, modelKey });
    }

    await sleep(intervalMs);
  }

  throwFriendlyKieError('Image generation timed out — try again in a moment.', { prompt, modelKey });
}

/**
 * Create task and wait for the first result image URL.
 */
async function generate({
  prompt,
  inputUrls,
  aspectRatio,
  resolution,
  modelKey,
  editMode,
  maxWaitMs,
  intervalMs,
}) {
  const created = await createTask({
    prompt,
    inputUrls,
    aspectRatio,
    resolution,
    modelKey,
    editMode,
  });
  const result = await pollUntilDone(created.taskId, {
    maxWaitMs,
    intervalMs,
    prompt,
    modelKey: created.modelKey,
  });
  return {
    taskId: created.taskId,
    model: created.model,
    modelKey: created.modelKey,
    modelLabel: created.modelLabel,
    imageUrl: result.urls[0],
    urls: result.urls,
    record: result.record,
  };
}

module.exports = {
  DEFAULT_MODEL_KEY,
  TEXT_MODEL,
  IMAGE_MODEL,
  IMAGE_MODELS,
  apiKey,
  isConfigured,
  listImageModels,
  getImageModel,
  isVagueImagePrompt,
  normalizeAspectAndResolution,
  nearestAspectRatio,
  friendlyKieImageError,
  testConnection,
  createTask,
  resolveDownloadableUrl,
  getTaskRecord,
  parseResultJson,
  extractImageUrls,
  pollUntilDone,
  generate,
};
