const dbService = require('./database');
const {
  resolveWorkspacePipelineColumnDefaults,
  normalizePipelineColumnPreset,
} = require('./pipelineColumnPresets');

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

function workspacePrefsBucket(prefs) {
  if (!prefs || typeof prefs !== 'object') return {};
  const byWs = prefs.pipelineTableByWorkspace;
  return byWs && typeof byWs === 'object' && !Array.isArray(byWs) ? byWs : {};
}

/**
 * Load table prefs for one workspace. Falls back to legacy account-wide
 * pipelineTable only when this workspace has never been customized.
 */
async function loadPipelineTablePrefs(email, workspaceId) {
  if (!email) return null;
  const prefs = await dbService.getUserPrefs(email);
  const wid = String(workspaceId || '').trim();
  if (wid) {
    const bucket = workspacePrefsBucket(prefs);
    const saved = bucket[wid];
    if (saved && typeof saved === 'object') {
      return sanitizePipelineTablePrefs(saved, Math.max(Date.now(), Number(saved.updatedAt) || 0));
    }
  }
  // No per-workspace copy yet — do not return legacy global prefs (they leak
  // agency columns into trucking workspaces). Caller applies workspace defaults.
  return null;
}

async function savePipelineTablePrefs(email, raw, workspaceId) {
  const next = sanitizePipelineTablePrefs(raw);
  if (!next) return null;
  const wid = String(workspaceId || '').trim();
  if (!wid) {
    // Legacy path (no workspace): keep writing the global key for old clients.
    const cur = await loadPipelineTablePrefs(email, '');
    if (cur && cur.updatedAt > next.updatedAt) return cur;
    await dbService.saveUserPrefs(email, { pipelineTable: next });
    return next;
  }
  const prefs = await dbService.getUserPrefs(email);
  const bucket = { ...workspacePrefsBucket(prefs) };
  const cur = bucket[wid] ? sanitizePipelineTablePrefs(bucket[wid]) : null;
  if (cur && cur.updatedAt > next.updatedAt) return cur;
  bucket[wid] = next;
  await dbService.saveUserPrefs(email, { pipelineTableByWorkspace: bucket });
  return next;
}

function buildEffectivePipelineTablePrefs(workspace, savedPrefs) {
  const defaults = resolveWorkspacePipelineColumnDefaults(workspace);
  if (savedPrefs && typeof savedPrefs === 'object' && Object.keys(savedPrefs.vis || {}).length) {
    return {
      ...savedPrefs,
      vis: { ...defaults.vis, ...sanitizeVisibility(savedPrefs.vis) },
      density:
        savedPrefs.density === 'comfortable' || savedPrefs.density === 'compact'
          ? savedPrefs.density
          : defaults.density,
      presetId: defaults.presetId,
      fromWorkspaceDefault: false,
    };
  }
  return {
    vis: defaults.vis,
    widths: {},
    density: defaults.density,
    updatedAt: 0,
    presetId: defaults.presetId,
    fromWorkspaceDefault: true,
  };
}

module.exports = {
  sanitizePipelineTablePrefs,
  loadPipelineTablePrefs,
  savePipelineTablePrefs,
  buildEffectivePipelineTablePrefs,
  normalizePipelineColumnPreset,
};
