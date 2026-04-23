/**
 * Workspace-level ICP defaults for /leads/find?preset=icp (keyword, geo, batch size).
 */

const dbService = require('./database');
const { ensureWorkspaceAndMember } = require('./workspaceService');

function clampQty(n) {
  const x = parseInt(n, 10);
  if (Number.isNaN(x) || x < 1) return 50;
  return Math.min(100, x);
}

function normalizeIcp(raw) {
  if (!raw || typeof raw !== 'object') {
    return { keyword: '', city: '', state: '', qty: 50 };
  }
  const qtyRaw = raw.qty != null ? raw.qty : raw.maxResults;
  return {
    keyword: String(raw.keyword || '').trim(),
    city: String(raw.city || '').trim(),
    state: String(raw.state || '')
      .trim()
      .slice(0, 2)
      .toUpperCase(),
    qty: qtyRaw != null && qtyRaw !== '' ? clampQty(qtyRaw) : 50,
  };
}

function getWorkspaceIcp(workspace) {
  return normalizeIcp(workspace && workspace.icp);
}

/**
 * Merge ICP fields onto workspace (e.g. after a successful search POST).
 */
async function persistWorkspaceIcp(workspaceId, partial) {
  const wid = workspaceId || 'default';
  await ensureWorkspaceAndMember(wid, '');
  let ws = (await dbService.getWorkspace(wid)) || { id: wid, members: {} };
  if (!ws.members) ws.members = {};
  const cur = normalizeIcp(ws.icp);
  const next = {
    keyword: partial.keyword != null ? String(partial.keyword).trim() : cur.keyword,
    city: partial.city != null ? String(partial.city).trim() : cur.city,
    state:
      partial.state != null
        ? String(partial.state).trim().slice(0, 2).toUpperCase()
        : cur.state,
    qty: partial.qty != null ? clampQty(partial.qty) : cur.qty,
  };
  ws.icp = next;
  await dbService.saveWorkspace(wid, ws);
}

module.exports = {
  getWorkspaceIcp,
  normalizeIcp,
  persistWorkspaceIcp,
  clampQty,
};
