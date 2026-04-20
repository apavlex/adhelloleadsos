const { DateTime } = require('luxon');
const dbService = require('./database');
const { generateOutreachCoachPayload } = require('./outreachCoachAi');
const { workspaceTodayYmd } = require('./workspaceTimezone');

/**
 * At ~6:00 local workspace time, pre-generate the morning brief once per workspace/day if missing.
 * Called from scheduler every 15 minutes.
 */
async function maybeWarmAllMorningBriefs() {
  let ids = await dbService.listWorkspaceIds();
  if (!ids || ids.length === 0) ids = ['default'];

  for (const wid of ids) {
    try {
      const ws = await dbService.getWorkspace(wid);
      const tz =
        (ws && ws.timezone) || process.env.WORKSPACE_DEFAULT_TZ || 'America/New_York';
      let dt;
      try {
        dt = DateTime.now().setZone(tz);
      } catch {
        dt = DateTime.utc();
      }
      if (dt.hour !== 6) continue;

      const ymd = workspaceTodayYmd(ws);
      const existing = await dbService.getMorningBrief(wid, ymd);
      if (existing && existing.success) continue;

      const fakeReq = { workspaceId: wid, workspaceRole: 'admin', user: null };
      const result = await generateOutreachCoachPayload(fakeReq);
      if (result.success) {
        await dbService.setMorningBrief(wid, ymd, {
          success: true,
          headline: result.headline,
          body: result.body,
          focusToday: result.focusToday,
          actions: result.actions,
          provider: result.provider,
          snapshot: result.snapshot,
        });
        console.log(`[morningBrief] warmed ${wid} for ${ymd}`);
      }
    } catch (e) {
      console.warn('[morningBrief] warm failed:', wid, e.message);
    }
  }
}

module.exports = { maybeWarmAllMorningBriefs };
