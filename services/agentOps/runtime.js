/**
 * Job runner + scheduler tick for role bots.
 */
const db = require('../database');
const { ROLES, ROLE_BY_ID, JOB_LABELS, roleForJob, listRoles } = require('./roles');
const store = require('./store');
const tools = require('./tools');
const memory = require('./memory');

/** ~hourly auto-run; cron checks every 15m so due roles pick up within a quarter hour. */
const TICK_COOLDOWN_MS = 55 * 60 * 1000;
/** In-process lock so overlapping cron/startup ticks don't double-run a workspace. */
const workspaceTickLocks = new Set();

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
      force: !!ctx.force,
    }),
  'review.scan': (wid, job, ctx) =>
    tools.scanOpportunityBoard(wid, {
      role: ROLE_BY_ID.opportunity,
      onBehalfOf: ctx.onBehalfOf,
      limit: 8,
      force: !!ctx.force,
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

  const ctx = {
    onBehalfOf: opts.onBehalfOf || job.triggeredBy || '',
    force: !!(opts.force || (job.payload && job.payload.force)),
  };
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
    const skippedFresh = !!(result && result.skipped && result.reason === 'fresh');
    const summary = (result && result.summary) || JOB_LABELS[job.type] || job.type;
    store.updateJob(wid, jobId, {
      status: ok ? 'done' : 'failed',
      result: result || null,
      error: ok ? null : (result && result.error) || 'Job failed',
      finishedAt: store.nowIso(),
    });
    // Fresh skips still advance auto cadence, but don't spam run history / activity.
    if (!skippedFresh) {
      store.appendRun(wid, {
        jobId,
        roleId: (role && role.id) || job.roleId,
        type: job.type,
        status: ok ? 'ok' : 'failed',
        summary,
        counts: (result && result.counts) || {},
        error: ok ? null : (result && result.error) || null,
      });
    }
    if (role) {
      const fromScheduler = String(job.triggeredBy || '') === 'scheduler';
      store.recordRoleTick(wid, role.id, { auto: fromScheduler });
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
    // Still advance auto cadence on hard failures so one bad run doesn't pin a role forever.
    if (role && String(job.triggeredBy || '') === 'scheduler') {
      store.recordRoleTick(wid, role.id, { auto: true });
    }
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

  store.failStaleRunningJobs(wid);
  const already = store.listRunningJobs(wid).find((j) => {
    const r = roleForJob(j.type) || (j.roleId ? ROLE_BY_ID[j.roleId] : null);
    return (r && r.id) === role.id || j.roleId === role.id;
  });
  if (already) {
    return { ok: false, error: `${role.title} is already running.`, job: already };
  }

  const payload = { ...(opts.payload && typeof opts.payload === 'object' ? opts.payload : {}) };
  if (opts.force) payload.force = true;
  const job = store.createJob(wid, {
    type,
    roleId: role.id,
    payload,
    triggeredBy: opts.triggeredBy || opts.onBehalfOf || 'user',
  });
  return runJob(wid, job.id, { onBehalfOf: opts.onBehalfOf || '', force: !!opts.force });
}

function roleDueForTick(settings, roleId, nowMs) {
  const cfg = settings.roles[roleId] || {};
  if (cfg.enabled === false || cfg.autoTick === false) return false;
  // Auto cadence only — manual Run / Run all must not delay the next hourly auto-tick.
  const last = settings.lastAutoTickByRole && settings.lastAutoTickByRole[roleId];
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
  if (workspaceTickLocks.has(wid)) {
    return { ok: true, skipped: true, reason: 'tick_in_progress', workspaceId: wid };
  }
  workspaceTickLocks.add(wid);
  try {
    store.failStaleRunningJobs(wid);
    const settings = store.getSettings(wid);
    if (!settings.enabled) return { ok: true, skipped: true, reason: 'disabled' };

    const force = !!opts.force;
    const nowMs = Date.now();
    const results = [];

    for (const role of ROLES) {
      const cfg = settings.roles[role.id] || {};
      if (cfg.enabled === false) {
        results.push({ roleId: role.id, skipped: true, reason: 'role_disabled' });
        continue;
      }
      if (!force && cfg.autoTick === false) {
        results.push({ roleId: role.id, skipped: true, reason: 'auto_off' });
        continue;
      }
      // Re-read settings each role so prior ticks in this loop don't use a stale auto map.
      const live = store.getSettings(wid);
      if (!force && !roleDueForTick(live, role.id, nowMs)) {
        results.push({ roleId: role.id, skipped: true, reason: 'cooldown' });
        continue;
      }
      const running = store.listRunningJobs(wid).some((j) => {
        const r = roleForJob(j.type) || (j.roleId ? ROLE_BY_ID[j.roleId] : null);
        return (r && r.id) === role.id || j.roleId === role.id;
      });
      if (running) {
        results.push({ roleId: role.id, skipped: true, reason: 'already_running' });
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      const out = await enqueueAndRun(wid, role.defaultJob, {
        // force (Run all) is a user action; scheduler ticks keep the hourly auto cadence.
        triggeredBy: force ? (opts.triggeredBy || 'user') : 'scheduler',
        onBehalfOf: opts.onBehalfOf || '',
        force,
      });
      results.push({
        roleId: role.id,
        ok: out.ok,
        skipped: !out.ok && /already running/i.test(out.error || ''),
        summary: out.result && out.result.summary,
        error: out.error,
      });
    }

    store.saveSettings(wid, { lastTickAt: store.nowIso() });
    return { ok: true, workspaceId: wid, results };
  } finally {
    workspaceTickLocks.delete(wid);
  }
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
  const runningJobs = store.listRunningJobs(wid);
  const runningByRole = new Map();
  for (const job of runningJobs) {
    const role = roleForJob(job.type) || (job.roleId ? ROLE_BY_ID[job.roleId] : null);
    const roleId = (role && role.id) || job.roleId;
    if (!roleId || runningByRole.has(roleId)) continue;
    runningByRole.set(roleId, job);
  }
  const roles = listRoles().map((r) => {
    const cfg = settings.roles[r.id] || { enabled: true, autoTick: true };
    const insight = insights.find((i) => i.roleId === r.id) || null;
    const lastRun = runs.find((x) => x.roleId === r.id) || null;
    const note = memory.latestNote(wid, r.id);
    const runningJob = runningByRole.get(r.id) || null;
    const meta = (insight && insight.meta) || {};
    const items = Array.isArray(meta.items)
      ? meta.items
      : Array.isArray(meta.top)
        ? meta.top.map((t) => ({
            kind: 'lead',
            id: t.key || t.id || null,
            title: t.title || 'Lead',
            subtitle: t.nextMove || t.stageName || t.phone || '',
            href: t.href || null,
            badge: t.badge || t.stageName || null,
          }))
        : [];
    return {
      ...r,
      enabled: cfg.enabled !== false,
      autoTick: cfg.autoTick !== false,
      lastTickAt: (settings.lastTickByRole && settings.lastTickByRole[r.id]) || null,
      running: !!runningJob,
      runningStartedAt: runningJob ? (runningJob.startedAt || runningJob.createdAt || null) : null,
      insight,
      items,
      lastRun,
      memory: note,
    };
  });
  const runningRoles = roles.filter((r) => r.running).map((r) => ({ id: r.id, title: r.title }));
  return {
    enabled: settings.enabled !== false,
    lastTickAt: settings.lastTickAt,
    roles,
    insights,
    runs,
    runningRoles,
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
