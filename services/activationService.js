const dbService = require('./database');
const { onboardingForWorkspace, stepLabel, EVENT_KEYS } = require('./onboardingConfig');

/**
 * Stored per user:
 *   events  — product milestones ({ search_saved: iso, ... }), shared across workspaces
 *   manual  — { [workspaceId]: { [stepId]: iso } } for "Mark done"
 *   days    — legacy v1 map ({ d1: { at, event|manual } }) kept for the default step ids
 */
const LEGACY_DAY_IDS = new Set(['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7']);

function emptyState() {
  return { version: 2, startedAt: null, events: {}, manual: {}, days: {}, updatedAt: null };
}

function loadState(raw) {
  const s = raw && typeof raw === 'object' ? { ...raw } : emptyState();
  if (!s.days || typeof s.days !== 'object') s.days = {};
  if (!s.events || typeof s.events !== 'object') s.events = {};
  if (!s.manual || typeof s.manual !== 'object') s.manual = {};
  Object.values(s.days).forEach((d) => {
    if (d && d.event && !s.events[d.event]) s.events[d.event] = d.at || new Date().toISOString();
  });
  s.version = 2;
  return s;
}

async function resolveWorkspace(email, workspaceOrId) {
  if (workspaceOrId && typeof workspaceOrId === 'object') return workspaceOrId;
  let wid = workspaceOrId ? String(workspaceOrId) : '';
  if (!wid && email) {
    const prefs = await dbService.getUserPrefs(email);
    wid = (prefs && prefs.activeWorkspaceId) || '';
  }
  return wid ? dbService.getWorkspace(wid) : null;
}

function workspaceKey(ws) {
  return (ws && ws.id) || 'default';
}

function planFor(ws) {
  return onboardingForWorkspace(ws).steps.map((s, i) => ({
    id: s.id,
    day: i + 1,
    label: stepLabel(s, i),
    title: s.title,
    hint: s.hint,
    href: s.href,
    event: s.event,
  }));
}

/** { [stepId]: { at, event|manual } } for steps this user has completed in the workspace. */
function completedSteps(state, plan, ws) {
  const manual = state.manual[workspaceKey(ws)] || {};
  const out = {};
  plan.forEach((step) => {
    if (manual[step.id]) out[step.id] = { at: manual[step.id], manual: true };
    else if (step.event && state.events[step.event]) out[step.id] = { at: state.events[step.event], event: step.event };
    else if (LEGACY_DAY_IDS.has(step.id) && state.days[step.id] && state.days[step.id].manual) {
      out[step.id] = state.days[step.id];
    }
  });
  return out;
}

async function getState(email, workspaceOrId) {
  const ws = await resolveWorkspace(email, workspaceOrId);
  const plan = planFor(ws);
  const state = loadState(email ? await dbService.getActivationState(email) : null);
  const days = completedSteps(state, plan, ws);
  return {
    version: state.version,
    startedAt: state.startedAt,
    updatedAt: state.updatedAt,
    workspaceId: (ws && ws.id) || '',
    days,
    plan,
    progress: plan.filter((p) => days[p.id]).length,
    total: plan.length,
  };
}

async function completeDay(email, stepId, workspaceOrId) {
  const ws = await resolveWorkspace(email, workspaceOrId);
  const id = String(stepId || '').trim();
  if (!email || !planFor(ws).some((p) => p.id === id)) return getState(email, ws);
  const state = loadState(await dbService.getActivationState(email));
  const now = new Date().toISOString();
  const key = workspaceKey(ws);
  state.manual[key] = { ...(state.manual[key] || {}), [id]: now };
  if (!state.startedAt) state.startedAt = now;
  state.updatedAt = now;
  await dbService.saveActivationState(email, state);
  return getState(email, ws);
}

/** Record an activation milestone by product event name. */
async function recordEvent(email, eventKey) {
  if (!email || !eventKey || !EVENT_KEYS.has(eventKey)) return null;
  const state = loadState(await dbService.getActivationState(email));
  if (state.events[eventKey]) return state;
  const now = new Date().toISOString();
  state.events[eventKey] = now;
  if (!state.startedAt) state.startedAt = now;
  state.updatedAt = now;
  await dbService.saveActivationState(email, state);
  return state;
}

module.exports = {
  getState,
  completeDay,
  recordEvent,
  planFor,
  completedSteps,
  loadState,
};
