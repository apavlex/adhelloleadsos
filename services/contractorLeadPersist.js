/**
 * Save contractor-registry records into the workspace.
 * Auto runs file each trade into the matching trade folder (created when missing).
 * An explicit folder keeps the whole run together.
 */

const dbService = require('./database');
const { JOB_TYPES } = require('./scrapeJobTypes');
const { ensurePipelineFolders, findFolderForJobType, leadMetadataForJobType } = require('./pipelineFolders');
const { matchFolderToTrade } = require('./folderTradeMatcher');
const { tradeById, recordToLead } = require('./contractorRegistry');

function findExistingTradeFolder(folders, trade) {
  if (trade.tradeSlug) {
    const bySlug = (folders || []).find((f) => f && String(f.tradeSlug || '') === trade.tradeSlug);
    if (bySlug) return bySlug;
  }
  const wanted = String(trade.folderName || '').trim().toLowerCase();
  const byName = (folders || []).find(
    (f) => f && String(f.name || '').trim().toLowerCase() === wanted
  );
  if (byName) return byName;
  if (trade.tradeSlug) {
    const byMatcher = (folders || []).find((f) => {
      const hit = matchFolderToTrade(f && f.name);
      return hit && hit.slug === trade.tradeSlug && hit.score >= 80;
    });
    if (byMatcher) return byMatcher;
  }
  return null;
}

async function ensureTradeFolder(wid, trade, folders) {
  const existing = findExistingTradeFolder(folders, trade);
  if (existing) return existing;
  const business = findFolderForJobType(folders, JOB_TYPES.MAPS_BUSINESS);
  const created = await dbService.createFolder(wid, trade.folderName, {
    parentFolderKey: business && business.key ? String(business.key) : undefined,
    jobType: JOB_TYPES.MAPS_BUSINESS,
    isTradeFolder: true,
    tradeSlug: trade.tradeSlug || undefined,
  });
  folders.push(created);
  return created;
}

/**
 * @param {string} workspaceId
 * @param {object[]} records normalized contractor rows
 * @param {{ splitByTrade?: boolean, folderKey?: string }} ctx
 */
async function persistContractorRecords(workspaceId, records, ctx = {}) {
  const wid = workspaceId || 'default';
  const list = Array.isArray(records) ? records : [];
  const split = ctx.splitByTrade !== false;
  const fallbackKey = String(ctx.folderKey || '').trim();
  let folders = await ensurePipelineFolders(wid);
  const folderCache = new Map();
  const folderStats = new Map();
  let savedCount = 0;
  let mergedCount = 0;

  for (let i = 0; i < list.length; i += 1) {
    const rec = list[i];
    const lead = recordToLead(rec);
    if (!lead.title) continue;
    let folderKey = fallbackKey;
    let folderName = '';
    if (split) {
      const trade = tradeById(rec.trade || lead.contractorTrade);
      if (trade) {
        if (!folderCache.has(trade.id)) {
          // eslint-disable-next-line no-await-in-loop
          folderCache.set(trade.id, await ensureTradeFolder(wid, trade, folders));
        }
        const folder = folderCache.get(trade.id);
        folderKey = folder && folder.key ? String(folder.key) : folderKey;
        folderName = folder && folder.name ? String(folder.name) : trade.folderName;
      }
    }
    const meta = leadMetadataForJobType(JOB_TYPES.CONTRACTORS, { folderKey: folderKey || undefined });
    // eslint-disable-next-line no-await-in-loop
    const result = await dbService.saveLeadWithMeta({ ...lead, ...meta, workspaceId: wid });
    if (result.merged) mergedCount += 1;
    else savedCount += 1;
    if (folderKey) {
      const stat = folderStats.get(folderKey) || { key: folderKey, name: folderName, saved: 0, merged: 0 };
      if (result.merged) stat.merged += 1;
      else stat.saved += 1;
      if (!stat.name && folderName) stat.name = folderName;
      folderStats.set(folderKey, stat);
    }
    if (i > 0 && i % 25 === 0) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => setImmediate(resolve));
    }
  }

  return {
    savedCount,
    mergedCount,
    folders: [...folderStats.values()],
  };
}

module.exports = {
  findExistingTradeFolder,
  persistContractorRecords,
};
