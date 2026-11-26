/**
 * Workspace switch for searches: "default" keeps the built-in providers,
 * "treg" sends Maps and web searches through treg.to.
 * Stored per workspace so folder runs, schedules, and MCP tools follow the top bar.
 */

const MODES = new Set(['default', 'treg']);

function storageKey(workspaceId) {
  return `treg:search-engine:${String(workspaceId || '').trim()}`;
}

function normalizeMode(raw) {
  return String(raw || '').trim().toLowerCase() === 'treg' ? 'treg' : 'default';
}

function isOn(integrationEnv) {
  return normalizeMode(integrationEnv && integrationEnv.SEARCH_ENGINE) === 'treg';
}

function getMode(workspaceId) {
  const wid = String(workspaceId || '').trim();
  if (!wid) return 'default';
  const db = require('./database');
  return normalizeMode(db.getKvSync(storageKey(wid)));
}

function setMode(workspaceId, mode) {
  const wid = String(workspaceId || '').trim();
  if (!wid) {
    const err = new Error('A workspace is required.');
    err.status = 400;
    throw err;
  }
  const wanted = String(mode || '').trim().toLowerCase();
  if (!MODES.has(wanted)) {
    const err = new Error('Choose Default builds or Treg.');
    err.status = 400;
    throw err;
  }
  const db = require('./database');
  db.setKvSync(storageKey(wid), wanted);
  return wanted;
}

/**
 * Stamp the resolved integration env so every search that already receives it
 * can see the switch without a second lookup.
 */
function applyToEnv(workspaceId, env, workspace) {
  const out = env || {};
  const wid = String(workspaceId || '').trim();
  if (wid) out.ADHELLO_WORKSPACE_ID = wid;
  if (workspace && workspace.isDemo) {
    out.SEARCH_ENGINE = 'default';
    return out;
  }
  out.SEARCH_ENGINE = getMode(wid);
  return out;
}

module.exports = {
  normalizeMode,
  isOn,
  getMode,
  setMode,
  applyToEnv,
  storageKey,
};
