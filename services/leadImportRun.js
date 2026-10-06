/**
 * Parse a CSV/TSV export and upsert each row as a lead (dedupe-aware), then auto-attach cadences.
 */
const dbService = require('./database');
const { parseImportFile } = require('./csvLeadImport');
const { findExistingLead, upsertLeadInMemoryList } = require('./leadDedupe');
const { autoAttachCadenceIfNeeded } = require('./leadCadence');
const { ensureFolderByName } = require('./chromeExtensionInbox');

/**
 * @param {object} opts workspaceId, csvContent, fileName?, leadSource?, folderKey?, folderName?, source?
 */
async function importLeadsFromCsv(opts) {
  const wid = opts.workspaceId;
  const parsed = parseImportFile(Buffer.from(String(opts.csvContent || ''), 'utf8'), opts.fileName || 'import.csv', {
    leadSource: opts.leadSource || 'autonomous',
  });

  const folderName = String(opts.folderName || '').trim();
  let folderKey = String(opts.folderKey || '').trim();
  let resolvedFolderName = '';
  if (folderName) {
    const folder = await ensureFolderByName(wid, folderName);
    if (folder && folder.key) {
      folderKey = String(folder.key);
      resolvedFolderName = String(folder.name || folderName).trim();
    }
  }

  let created = 0;
  let updated = 0;
  let failed = 0;
  let skipped = 0;
  const keys = [];
  const workspaceLeads = await dbService.getAllLeads(wid);

  for (const rec of parsed.leads) {
    if (!rec.title) {
      skipped++;
      continue;
    }
    try {
      const payload = { ...rec, workspaceId: wid };
      if (folderKey) payload.folderKey = folderKey;
      if (opts.source === 'chrome_extension') {
        payload.source = 'chrome_extension';
        payload.sourceType = payload.sourceType || 'chrome_extension';
      }
      const existing = findExistingLead(workspaceLeads, payload, wid);
      // eslint-disable-next-line no-await-in-loop
      const result = await dbService.saveLeadWithMeta(payload);
      keys.push(result.key);
      if (result.lead) upsertLeadInMemoryList(workspaceLeads, result.lead);
      if (existing || result.merged) updated++;
      else created++;
      try {
        // eslint-disable-next-line no-await-in-loop
        await autoAttachCadenceIfNeeded({ leadKey: result.key, workspaceId: wid });
      } catch (_) {
        /* non-fatal */
      }
    } catch (e) {
      failed++;
    }
  }

  return { created, updated, failed, skipped, keys, folderKey, folderName: resolvedFolderName };
}

module.exports = { importLeadsFromCsv };
