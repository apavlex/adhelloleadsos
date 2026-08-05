/**
 * Scheduler hook: run auto-pool for workspaces with prospecting.autoPool.enabled.
 */
const db = require('./database');
const { loadAutoPoolFromWorkspace, runAutoPool } = require('./prospectingAutoPool');

async function runAutoPoolForEnabledWorkspaces() {
  const workspaceIds = await db.listWorkspaceIds();
  let totalEnrolled = 0;
  for (const wid of workspaceIds) {
    try {
      const ws = await db.getWorkspace(wid);
      const settings = loadAutoPoolFromWorkspace(ws);
      if (!settings.enabled) continue;
      // eslint-disable-next-line no-await-in-loop
      const result = await runAutoPool({ workspaceId: wid, settings });
      totalEnrolled += result.enrolled || 0;
      if (result.enrolled) {
        console.log(`[AUTO-POOL] ${wid}: enrolled ${result.enrolled} lead(s)`);
      }
    } catch (e) {
      console.error(`[AUTO-POOL] ${wid} failed:`, e && e.message);
    }
  }
  return { totalEnrolled, workspaces: workspaceIds.length };
}

module.exports = {
  runAutoPoolForEnabledWorkspaces,
};
