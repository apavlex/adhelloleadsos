/**
 * DB-backed cache for the Today page prospecting coach (LLM brief).
 * Dual storage: morningBrief:{wid}:{ymd} + pc_coach:{wid} fallback for reliability.
 */

function isCoachBriefCacheUsable(c) {
  if (!c || typeof c !== 'object') return false;
  if (c.success === false) return false;
  const body = c.body;
  if (body == null) return false;
  if (typeof body === 'string' && !body.trim()) return false;
  return true;
}

/**
 * @param {import('./database')} dbService
 */
async function getCoachBriefForToday(dbService, wid, ymd) {
  const y = String(ymd || '').slice(0, 10);
  let cached = await dbService.getMorningBrief(wid, y);
  if (isCoachBriefCacheUsable(cached)) return cached;
  const pc = await dbService.getProspectingCoachCache(wid);
  if (pc && String(pc.forYmd || '').slice(0, 10) === y && isCoachBriefCacheUsable(pc)) return pc;
  return null;
}

async function persistCoachBrief(dbService, wid, ymd, payload) {
  const base = payload && typeof payload === 'object' ? { ...payload } : {};
  delete base.cached;
  await dbService.setMorningBrief(wid, ymd, base);
  await dbService.setProspectingCoachCache(wid, ymd, base);
}

async function clearCoachBrief(dbService, wid, ymd) {
  await dbService.deleteMorningBrief(wid, ymd);
  await dbService.deleteProspectingCoachCache(wid);
}

module.exports = {
  isCoachBriefCacheUsable,
  getCoachBriefForToday,
  persistCoachBrief,
  clearCoachBrief,
};
