/**
 * Job runner + scheduler tick for role bots.
 */
const db = require('../database');
const { ROLES, ROLE_BY_ID, JOB_LABELS, roleForJob, listRoles } = require('./roles');
const store = require('./store');
const tools = require('./tools');
const memory = require('./memory');

const TICK_COOLDOWN_MS = 45 * 60 * 1000; // avoid hammering every 15m cron

const HANDLERS = {
  'prospect.prepare': (wid, job, ctx) =>
    tools.prepareProspects(wid, { role: ROLE_BY_ID.prospect, onBehalfOf: ctx.onBehalfOf, limit: 20 }),
  'sdr.prepare_focus': (wid, job, ctx) =>
    tools.prepareProspects(wid, { role: ROLE_BY_ID.prospect, onBehalfOf: ctx.onBehalfOf, limit: 20 }),
  'opportunity.scan_board': (wid, job, ctx) =>
    tools.scanOpportunityBoard(wid, {
      role: ROLE_BY_ID.opportunity,
      onBehalfOf: ctx.onBehalfOf,
      limit: 8,
    }),
  'review.scan': (wid, job, ctx) =>
    tools.scanOpportunityBoard(wid, {
      role: ROLE_BY_ID.opportunity,
      onBehalfOf: ctx.onBehalfOf,
      limit: 8,
    }),
  'dispatcher.scan_pool': (wid, job, ctx) =>
    tools.scanPool(wid, { role: ROLE_BY_ID.dispatcher, onBehalfOf: ctx.onBehalfOf }),
  'ops.health': (wid, job, ctx) =>
    tools.opsHealth(wid, { role: ROLE_BY_ID.ops, onBehalfOf: ctx.onBehalfOf }),
};

async function runJob(workspaceId, jobId, opts = {}) {
  const wid = String(workspaceId || '').trim();
  const job = store.getJob(wid, jobId);
  if (!job) return { ok: false, error: 'Job not found.' };
  if (job.status === 'running') return { ok: false, error: 'Job already running.' };

  const role = roleForJob(job.type) || (job.roleId ? ROLE_BY_ID[job.roleId] : null);
  store.updateJob(wid, jobId, {
    status: 'running',
    startedAt: store.nowIso(),
    roleId: (role && role.id) || job.roleId,
  });

  const ctx = { onBehalfOf: opts.onBehalfOf || job.triggeredBy || '' };
  const handler = HANDLERS[job.type];
  if (!handler) {
    const error = `Unknown job type: ${job.type}`;
    store.updateJob(wid, jobId, { status: 'failed', error, finishedAt: store.nowIso() });
    store.appendRun(wid, {
      jobId,
      roleId: job.roleId,
      type: job.type,
      status: 'failed',
      summary: error,
      error,
    });
    return { ok: false, error };
  }

  try {
    const result = await handler(wid, job, ctx);
    const ok = !result || result.ok !== false;
    const summary = (result && result.summary) || JOB_LABELS[job.type] || job.type;
    store.updateJob(wid, jobId, {
      status: ok ? 'done' : 'failed',
      result: result || null,
      error: ok ? null : (result && result.error) || 'Job failed',
      finishedAt: store.nowIso(),
    });
    store.appendRun(wid, {
      jobId,
      roleId: (role && role.id) || job.roleId,
      type: job.type,
      status: ok ? 'ok' : 'failed',
      summary,
      counts: (result && result.counts) || {},
      error: ok ? null : (result && result.error) || null,
    });
    if (role) {
      const settings = store.getSettings(wid);
      store.saveSettings(wid, {
        lastTickByRole: {
          ...settings.lastTickByRole,
          [role.id]: store.nowIso(),
        },
      });
    }
    return { ok, job: store.getJob(wid, jobId), result };
  } catch (err) {
    const error = (err && err.message) || String(err);
    store.updateJob(wid, jobId, { status: 'failed', error, finishedAt: store.nowIso() });
    store.appendRun(wid, {
      jobId,
      roleId: (role && role.id) || job.roleId,
      type: job.type,
      status: 'failed',
      summary: error,
      error,
    });
    return { ok: false, error };
  }
}

/**
 * Queue + run a job immediately (manual Run from Today / API).
 */
async function enqueueAndRun(workspaceId, type, opts = {}) {
  const wid = String(workspaceId || '').trim();
  const role = roleForJob(type);
  if (!role) return { ok: false, error: `Unknown job type: ${type}` };
  const settings = store.getSettings(wid);
  if (!settings.enabled) return { ok: false, error: 'Agent ops is disabled for this workspace.' };
  const roleCfg = settings.roles[role.id] || { enabled: true };
  if (roleCfg.enabled === false) return { ok: false, error: `${role.title} is disabled.` };

  const job = store.createJob(wid, {
    type,
    roleId: role.id,
    payload: opts.payload || {},
    triggeredBy: opts.onBehalfOf || opts.triggeredBy || 'user',
  });
  return runJob(wid, job.id, { onBehalfOf: opts.onBehalfOf || '' });
}

function roleDueForTick(settings, roleId, nowMs) {
  const cfg = settings.roles[roleId] || {};
  if (cfg.enabled === false || cfg.autoTick === false) return false;
  const last = settings.lastTickByRole && settings.lastTickByRole[roleId];
  if (!last) return true;
  const t = Date.parse(last);
  if (!Number.isFinite(t)) return true;
  return nowMs - t >= TICK_COOLDOWN_MS;
}

/**
 * Auto tick for one workspace — runs default job per enabled role when due.
 */
async function tickWorkspace(workspaceId, opts = {}) {
  const wid = String(workspaceId || '').trim();
  if (!wid) return { ok: false, skipped: true, reason: 'no_workspace' };
  const settings = store.getSettings(wid);
  if (!settings.enabled) return { ok: true, skipped: true, reason: 'disabled' };

  const force = !!opts.force;
  const nowMs = Date.now();
  const results = [];

  for (const role of ROLES) {
    if (!force && !roleDueForTick(settings, role.id, nowMs)) {
      results.push({ roleId: role.id, skipped: true, reason: 'cooldown' });
      continue;
    }
    const cfg = settings.roles[role.id] || {};
    if (cfg.enabled === false) {
      results.push({ roleId: role.id, skipped: true, reason: 'role_disabled' });
      continue;
    }
    if (!force && cfg.autoTick === false) {
      results.push({ roleId: role.id, skipped: true, reason: 'auto_off' });
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    const out = await enqueueAndRun(wid, role.defaultJob, {
      triggeredBy: 'scheduler',
      onBehalfOf: opts.onBehalfOf || '',
    });
    results.push({ roleId: role.id, ok: out.ok, summary: out.result && out.result.summary, error: out.error });
  }

  store.saveSettings(wid, { lastTickAt: store.nowIso() });
  return { ok: true, workspaceId: wid, results };
}

/**
 * Scheduler entry — all workspaces (skip public demos).
 */
async function tickAllWorkspaces(fromDate = new Date()) {
  void fromDate;
  const workspaceIds = await db.listWorkspaceIds();
  let ran = 0;
  let skipped = 0;
  for (const wid of workspaceIds) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const ws = await db.getWorkspace(wid);
      if (ws && ws.publicDemoSandbox) {
        skipped += 1;
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      const out = await tickWorkspace(wid);
      if (out.skipped) skipped += 1;
      else ran += 1;
    } catch (e) {
      console.error(`[agentOps] tick workspace ${wid} failed:`, e && e.message);
    }
  }
  return { ran, skipped, workspaces: workspaceIds.length };
}

/**
 * Payload for Today UI + status API.
 */
function dashboardForWorkspace(workspaceId) {
  const wid = String(workspaceId || '').trim();
  const settings = store.getSettings(wid);
  const insights = store.listInsights(wid, 12);
  const runs = store.listRecentRuns(wid, 10);
  const roles = listRoles().map((r) => {
    const cfg = settings.roles[r.id] || { enabled: true, autoTick: true };
    const insight = insights.find((i) => i.roleId === r.id) || null;
    const lastRun = runs.find((x) => x.roleId === r.id) || null;
    const note = memory.latestNote(wid, r.id);
    return {
      ...r,
      enabled: cfg.enabled !== false,
      autoTick: cfg.autoTick !== false,
      lastTickAt: (settings.lastTickByRole && settings.lastTickByRole[r.id]) || null,
      insight,
      lastRun,
      memory: note,
    };
  });
  return {
    enabled: settings.enabled !== false,
    lastTickAt: settings.lastTickAt,
    roles,
    insights,
    runs,
  };
}

module.exports = {
  runJob,
  enqueueAndRun,
  tickWorkspace,
  tickAllWorkspaces,
  dashboardForWorkspace,
  HANDLERS,
  TICK_COOLDOWN_MS,
};
