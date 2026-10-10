/**
 * Durable state for role bots: settings, jobs, run history, Today insights.
 * Mirrored to SQLite KV (same pattern as agentSessionStore).
 */
const crypto = require('crypto');

const SETTINGS_PREFIX = 'agent_ops_settings:';
const JOB_PREFIX = 'agent_ops_job:';
const RUNS_PREFIX = 'agent_ops_runs:';
const INSIGHTS_PREFIX = 'agent_ops_insights:';
const MAX_RUNS = 40;
const MAX_INSIGHTS = 24;
const MAX_JOBS_LISTED = 30;

function getDb() {
  try {
    return require('../database');
  } catch (_) {
    return null;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function newId(prefix) {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
}

function readJson(key, fallback) {
  const db = getDb();
  if (!db || typeof db.getKvSync !== 'function') return fallback;
  try {
    const raw = db.getKvSync(key);
    if (!raw) return fallback;
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch (_) {
    return fallback;
  }
}

function writeJson(key, value) {
  const db = getDb();
  if (!db || typeof db.setKvSync !== 'function') return;
  try {
    db.setKvSync(key, JSON.stringify(value));
  } catch (err) {
    console.warn('[agentOps/store] persist failed:', err && err.message);
  }
}

function defaultSettings() {
  return {
    enabled: true,
    roles: {
      prospect: { enabled: true, autoTick: true },
      opportunity: { enabled: true, autoTick: true },
      dispatcher: { enabled: true, autoTick: true },
      ops: { enabled: true, autoTick: true },
    },
    lastTickAt: null,
    lastTickByRole: {},
    updatedAt: null,
  };
}

/** Fold legacy sdr/review settings into prospect/opportunity. */
function migrateRoleSettings(roles) {
  const next = roles && typeof roles === 'object' ? { ...roles } : {};
  if (next.sdr && !next.prospect) next.prospect = next.sdr;
  if (next.review && !next.opportunity) next.opportunity = next.review;
  delete next.sdr;
  delete next.review;
  return next;
}

function migrateTickByRole(map) {
  const next = map && typeof map === 'object' ? { ...map } : {};
  if (next.sdr && !next.prospect) next.prospect = next.sdr;
  if (next.review && !next.opportunity) next.opportunity = next.review;
  delete next.sdr;
  delete next.review;
  return next;
}

function getSettings(workspaceId) {
  const wid = String(workspaceId || '').trim();
  if (!wid) return defaultSettings();
  const raw = readJson(`${SETTINGS_PREFIX}${wid}`, null);
  if (!raw) return defaultSettings();
  const base = defaultSettings();
  return {
    ...base,
    ...raw,
    roles: {
      ...base.roles,
      ...migrateRoleSettings(raw.roles),
    },
    lastTickByRole: migrateTickByRole(raw.lastTickByRole),
  };
}

function saveSettings(workspaceId, patch) {
  const wid = String(workspaceId || '').trim();
  if (!wid) throw new Error('workspaceId is required');
  const cur = getSettings(wid);
  const next = {
    ...cur,
    ...(patch && typeof patch === 'object' ? patch : {}),
    roles: {
      ...cur.roles,
      ...(patch && patch.roles && typeof patch.roles === 'object' ? patch.roles : {}),
    },
    updatedAt: nowIso(),
  };
  writeJson(`${SETTINGS_PREFIX}${wid}`, next);
  return next;
}

function createJob(workspaceId, { type, roleId, payload, triggeredBy }) {
  const wid = String(workspaceId || '').trim();
  if (!wid) throw new Error('workspaceId is required');
  const job = {
    id: newId('job'),
    workspaceId: wid,
    type: String(type || '').trim(),
    roleId: String(roleId || '').trim() || null,
    status: 'queued',
    payload: payload && typeof payload === 'object' ? payload : {},
    triggeredBy: String(triggeredBy || 'system').slice(0, 160),
    result: null,
    error: null,
    createdAt: nowIso(),
    startedAt: null,
    finishedAt: null,
  };
  writeJson(`${JOB_PREFIX}${wid}:${job.id}`, job);
  return job;
}

function getJob(workspaceId, jobId) {
  const wid = String(workspaceId || '').trim();
  const id = String(jobId || '').trim();
  if (!wid || !id) return null;
  return readJson(`${JOB_PREFIX}${wid}:${id}`, null);
}

function updateJob(workspaceId, jobId, patch) {
  const job = getJob(workspaceId, jobId);
  if (!job) return null;
  const next = { ...job, ...(patch && typeof patch === 'object' ? patch : {}) };
  writeJson(`${JOB_PREFIX}${workspaceId}:${jobId}`, next);
  return next;
}

/** Jobs for a workspace (newest first). Optional status filter: queued | running | done | failed. */
function listJobs(workspaceId, { status = null, limit = MAX_JOBS_LISTED } = {}) {
  const wid = String(workspaceId || '').trim();
  if (!wid) return [];
  const db = getDb();
  if (!db || typeof db.listKvKeysSync !== 'function') return [];
  const prefix = `${JOB_PREFIX}${wid}:`;
  let keys = [];
  try {
    keys = db.listKvKeysSync(prefix) || [];
  } catch (_) {
    return [];
  }
  const want = status ? String(status) : null;
  const jobs = [];
  for (const key of keys) {
    const job = readJson(key, null);
    if (!job || !job.id) continue;
    if (want && job.status !== want) continue;
    jobs.push(job);
  }
  jobs.sort((a, b) => String(b.startedAt || b.createdAt || '').localeCompare(String(a.startedAt || a.createdAt || '')));
  return jobs.slice(0, Math.min(MAX_JOBS_LISTED, Math.max(1, limit)));
}

const STALE_RUNNING_MS = 10 * 60 * 1000;

/** Active (non-stale) running jobs for the workspace. */
function listRunningJobs(workspaceId) {
  const now = Date.now();
  return listJobs(workspaceId, { status: 'running', limit: MAX_JOBS_LISTED }).filter((job) => {
    const started = Date.parse(job.startedAt || job.createdAt || '');
    if (!Number.isFinite(started)) return true;
    return now - started < STALE_RUNNING_MS;
  });
}

function listRecentRuns(workspaceId, limit = 20) {
  const wid = String(workspaceId || '').trim();
  if (!wid) return [];
  const store = readJson(`${RUNS_PREFIX}${wid}`, { runs: [] });
  const runs = Array.isArray(store.runs) ? store.runs : [];
  return runs.slice(0, Math.min(MAX_RUNS, Math.max(1, limit)));
}

function appendRun(workspaceId, run) {
  const wid = String(workspaceId || '').trim();
  if (!wid || !run) return;
  const store = readJson(`${RUNS_PREFIX}${wid}`, { runs: [] });
  const runs = Array.isArray(store.runs) ? store.runs : [];
  runs.unshift({
    id: run.id || newId('run'),
    jobId: run.jobId || null,
    roleId: run.roleId || null,
    type: run.type || null,
    status: run.status || 'ok',
    summary: String(run.summary || '').slice(0, 400),
    counts: run.counts && typeof run.counts === 'object' ? run.counts : {},
    error: run.error || null,
    at: run.at || nowIso(),
  });
  writeJson(`${RUNS_PREFIX}${wid}`, { runs: runs.slice(0, MAX_RUNS), updatedAt: nowIso() });
}

function listInsights(workspaceId, limit = 12) {
  const wid = String(workspaceId || '').trim();
  if (!wid) return [];
  const store = readJson(`${INSIGHTS_PREFIX}${wid}`, { items: [] });
  const items = Array.isArray(store.items) ? store.items : [];
  return items.slice(0, Math.min(MAX_INSIGHTS, Math.max(1, limit)));
}

function upsertInsight(workspaceId, insight) {
  const wid = String(workspaceId || '').trim();
  if (!wid || !insight) return null;
  const store = readJson(`${INSIGHTS_PREFIX}${wid}`, { items: [] });
  const items = Array.isArray(store.items) ? store.items : [];
  const roleId = String(insight.roleId || '').trim();
  const type = String(insight.type || '').trim();
  const nextItem = {
    id: insight.id || newId('ins'),
    roleId,
    type,
    title: String(insight.title || '').slice(0, 160),
    body: String(insight.body || '').slice(0, 600),
    href: insight.href ? String(insight.href).slice(0, 300) : null,
    severity: ['info', 'warn', 'action'].includes(insight.severity) ? insight.severity : 'info',
    counts: insight.counts && typeof insight.counts === 'object' ? insight.counts : {},
    meta: insight.meta && typeof insight.meta === 'object' ? insight.meta : {},
    at: nowIso(),
  };
  const filtered = items.filter((i) => !(i.roleId === roleId && i.type === type));
  filtered.unshift(nextItem);
  writeJson(`${INSIGHTS_PREFIX}${wid}`, {
    items: filtered.slice(0, MAX_INSIGHTS),
    updatedAt: nowIso(),
  });
  return nextItem;
}

function clearInsightsForRole(workspaceId, roleId) {
  const wid = String(workspaceId || '').trim();
  const rid = String(roleId || '').trim();
  if (!wid || !rid) return;
  const store = readJson(`${INSIGHTS_PREFIX}${wid}`, { items: [] });
  const items = (Array.isArray(store.items) ? store.items : []).filter((i) => i.roleId !== rid);
  writeJson(`${INSIGHTS_PREFIX}${wid}`, { items, updatedAt: nowIso() });
}

module.exports = {
  getSettings,
  saveSettings,
  createJob,
  getJob,
  updateJob,
  listJobs,
  listRunningJobs,
  listRecentRuns,
  appendRun,
  listInsights,
  upsertInsight,
  clearInsightsForRole,
  newId,
  nowIso,
  MAX_JOBS_LISTED,
  STALE_RUNNING_MS,
};
