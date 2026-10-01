const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.APP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'folder-delete-trade-'));

const test = require('node:test');
const assert = require('node:assert/strict');
const dbService = require('../services/database');
const { ensurePipelineFoldersWithTree, deleteFolderComplete } = require('../services/pipelineFolders');

test('a deleted trade folder stays deleted and its subfolders are kept', async () => {
  const wid = 'ws_trades';
  await dbService.saveWorkspace(wid, { id: wid, name: 'Flooring', members: {} });
  let { folders } = await ensurePipelineFoldersWithTree(wid);
  const mechanical = folders.find((f) => f.tradeSlug === 'mechanical');
  assert.ok(mechanical);
  const child = await dbService.createFolder(wid, 'Boiler shops', { parentFolderKey: mechanical.key, jobType: 'maps_business' });

  const result = await deleteFolderComplete(wid, mechanical.key);
  assert.equal(result.deleted, true);

  ({ folders } = await ensurePipelineFoldersWithTree(wid));
  assert.ok(!folders.some((f) => f.tradeSlug === 'mechanical' || f.name === 'Mechanical'));
  const keptChild = folders.find((f) => f.key === child.key);
  assert.ok(keptChild);
  assert.equal(keptChild.parentFolderKey, mechanical.parentFolderKey || '');
  assert.ok(folders.some((f) => f.tradeSlug === 'hvac'));
});
