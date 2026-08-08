/**
 * Scheduler hook: run folder outreach for folders with outreachAutomation.enabled.
 */
const db = require('./database');
const { runEnabledFoldersForWorkspace } = require('./folderOutreachAutomation');

async function runFolderOutreachForEnabledWorkspaces() {
  const workspaceIds = await db.listWorkspaceIds();
  let totalEnrolled = 0;
  for (const wid of workspaceIds) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const result = await runEnabledFoldersForWorkspace(wid);
      totalEnrolled += result.totalEnrolled || 0;
    } catch (e) {
      console.error(`[FOLDER-OUTREACH] workspace ${wid} failed:`, e && e.message);
    }
  }
  return { totalEnrolled, workspaces: workspaceIds.length };
}

module.exports = {
  runFolderOutreachForEnabledWorkspaces,
};
