/**
 * Scheduler hook: run folder + auto-pool outreach at 09:30 in each workspace timezone.
 */
const db = require('./database');
const { runEnabledFoldersForWorkspace } = require('./folderOutreachAutomation');
const { loadAutoPoolFromWorkspace, runAutoPool } = require('./prospectingAutoPool');
const {
  resolveWorkspaceTimezone,
  localDayKey,
  isDailyOutreachWindow,
  lastDailyOutreachLocalDay,
} = require('./workspaceTimezone');

async function markDailyOutreachDay(workspaceId, dayKey) {
  const wid = String(workspaceId || '').trim();
  if (!wid || !dayKey) return;
  const ws = (await db.getWorkspace(wid)) || { id: wid };
  const prospecting =
    ws.prospecting && typeof ws.prospecting === 'object' ? { ...ws.prospecting } : {};
  if (prospecting.lastDailyOutreachLocalDay === dayKey) return;
  prospecting.lastDailyOutreachLocalDay = dayKey;
  await db.saveWorkspace(wid, { ...ws, prospecting });
}

/**
 * Called from the 15-minute cron. Runs once per workspace local day in the 09:30 window.
 */
async function maybeRunDailyOutreachForEnabledWorkspaces(fromDate = new Date()) {
  const workspaceIds = await db.listWorkspaceIds();
  let folderEnrolled = 0;
  let poolEnrolled = 0;
  let ran = 0;

  for (const wid of workspaceIds) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const ws = await db.getWorkspace(wid);
      const tz = resolveWorkspaceTimezone(ws);
      if (!isDailyOutreachWindow(tz, fromDate)) continue;
      const day = localDayKey(tz, fromDate);
      if (lastDailyOutreachLocalDay(ws) === day) continue;

      const autoPool = loadAutoPoolFromWorkspace(ws);
      // eslint-disable-next-line no-await-in-loop
      const folderResult = await runEnabledFoldersForWorkspace(wid);
      folderEnrolled += folderResult.totalEnrolled || 0;

      if (autoPool.enabled) {
        // eslint-disable-next-line no-await-in-loop
        const poolResult = await runAutoPool({ workspaceId: wid, settings: autoPool });
        poolEnrolled += poolResult.enrolled || 0;
        if (poolResult.enrolled) {
          console.log(`[AUTO-POOL] ${wid}: enrolled ${poolResult.enrolled} lead(s)`);
        }
      }

      // eslint-disable-next-line no-await-in-loop
      await markDailyOutreachDay(wid, day);
      ran += 1;
      console.log(
        `[DAILY-OUTREACH] ${wid} (${tz}) day ${day}: folders +${folderResult.totalEnrolled || 0}, pool +${autoPool.enabled ? 'ran' : 'off'}`,
      );
    } catch (e) {
      console.error(`[DAILY-OUTREACH] workspace ${wid} failed:`, e && e.message);
    }
  }

  return { ran, folderEnrolled, poolEnrolled, workspaces: workspaceIds.length };
}

module.exports = {
  maybeRunDailyOutreachForEnabledWorkspaces,
  markDailyOutreachDay,
};
