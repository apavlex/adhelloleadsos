const dbService = require('./database');

const COL_ID_RE = /^[A-Za-z][A-Za-z0-9_]{0,48}$/;
const MAX_COLUMNS = 120;
const MIN_WIDTH = 32;
const MAX_WIDTH = 2400;

function sanitizeVisibility(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const id of Object.keys(raw).slice(0, MAX_COLUMNS)) {
    if (!COL_ID_RE.test(id)) continue;
    if (typeof raw[id] === 'boolean') out[id] = raw[id];
  }
  return out;
}

function sanitizeWidths(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const id of Object.keys(raw).slice(0, MAX_COLUMNS)) {
    if (!COL_ID_RE.test(id)) continue;
    const px = Number(raw[id]);
    if (!Number.isFinite(px)) continue;
    out[id] = Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, px)));
  }
  return out;
}

/** Normalize a client payload; updatedAt is clamped so a skewed device clock can't win forever. */
function sanitizePipelineTablePrefs(raw, now = Date.now()) {
  if (!raw || typeof raw !== 'object') return null;
  const ts = Number(raw.updatedAt);
  return {
    vis: sanitizeVisibility(raw.vis),
    widths: sanitizeWidths(raw.widths),
    density: raw.density === 'comfortable' ? 'comfortable' : 'compact',
    updatedAt: Number.isFinite(ts) && ts > 0 ? Math.min(ts, now) : now,
  };
}

async function loadPipelineTablePrefs(email) {
  if (!email) return null;
  const prefs = await dbService.getUserPrefs(email);
  const saved = prefs && prefs.pipelineTable;
  if (!saved || typeof saved !== 'object') return null;
  return sanitizePipelineTablePrefs(saved, Math.max(Date.now(), Number(saved.updatedAt) || 0));
}

async function savePipelineTablePrefs(email, raw) {
  const next = sanitizePipelineTablePrefs(raw);
  if (!next) return null;
  const cur = await loadPipelineTablePrefs(email);
  if (cur && cur.updatedAt > next.updatedAt) return cur;
  await dbService.saveUserPrefs(email, { pipelineTable: next });
  return next;
}

module.exports = {
  sanitizePipelineTablePrefs,
  loadPipelineTablePrefs,
  savePipelineTablePrefs,
};
