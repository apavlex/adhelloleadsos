/**
 * Save business formation search results into pipeline folders.
 */

const dbService = require('./database');
const { formationsToLeads } = require('./businessFormationLeadEnrich');
const { leadMetadataForJobType } = require('./pipelineFolders');
const { JOB_TYPES } = require('./scrapeJobTypes');

async function persistFormationLeads(workspaceId, leadRows, folderKey) {
  const wid = workspaceId || 'default';
  let savedCount = 0;
  const saved = [];
  for (const row of leadRows || []) {
    const meta = leadMetadataForJobType(JOB_TYPES.BUSINESS_FORMATIONS, {
      folderKey,
    });
    // eslint-disable-next-line no-await-in-loop
    const result = await dbService.saveLeadWithMeta({ ...row, ...meta, workspaceId: wid });
    saved.push(result);
    if (!result.merged) savedCount += 1;
  }
  return { savedCount, saved };
}

async function persistFormationSearchResults(workspaceId, scheduleOrCtx, rawResults) {
  const ctx = scheduleOrCtx && typeof scheduleOrCtx === 'object' ? scheduleOrCtx : {};
  const folderKey = String(ctx.targetFolderKey || '').trim();
  const leadRows = formationsToLeads(rawResults, {
    workspaceId,
    folderKey: folderKey || undefined,
    state: ctx.state || (Array.isArray(ctx.stateCodes) ? ctx.stateCodes[0] : ''),
  });
  if (!folderKey || !leadRows.length) {
    return { savedCount: 0, leadRows };
  }
  const { savedCount } = await persistFormationLeads(workspaceId, leadRows, folderKey);
  return { savedCount, leadRows };
}

module.exports = {
  persistFormationLeads,
  persistFormationSearchResults,
};
