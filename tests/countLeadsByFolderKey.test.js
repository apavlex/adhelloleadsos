const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'folder-lead-counts-'));
process.env.APP_DATA_DIR = tmpDataDir;

const test = require('node:test');
const assert = require('node:assert/strict');
const dbService = require('../services/database');

const WS = 'ws_folder_counts';

test('countLeadsByFolderKey groups without loading full lead docs', async () => {
  await dbService.putStorageKey('lead:fc1', {
    title: 'HVAC Co',
    workspaceId: WS,
    folderKey: 'folder:hvac',
  });
  await dbService.putStorageKey('lead:fc2', {
    title: 'HVAC Two',
    workspaceId: WS,
    folderKey: 'folder:hvac',
  });
  await dbService.putStorageKey('lead:fc3', {
    title: 'Plumb Co',
    workspaceId: WS,
    folderKey: 'folder:plumb',
  });
  await dbService.putStorageKey('lead:fc4', {
    title: 'Unfiled',
    workspaceId: WS,
  });
  await dbService.putStorageKey('lead:fc5', {
    title: 'Other workspace',
    workspaceId: 'ws_other',
    folderKey: 'folder:hvac',
  });

  const counts = await dbService.countLeadsByFolderKey(WS);
  assert.equal(counts['folder:hvac'], 2);
  assert.equal(counts['folder:plumb'], 1);
  assert.equal(counts['folder:missing'], undefined);
});

test('listFoldersLite returns slim tree fields', async () => {
  const root = await dbService.createFolder(WS, 'Businesses', {
    jobType: 'maps_business',
    isPipelineDefault: true,
  });
  const trade = await dbService.createFolder(WS, 'HVAC', {
    parentFolderKey: root.key,
    jobType: 'maps_business',
    isTradeFolder: true,
    tradeSlug: 'hvac',
  });
  const lite = await dbService.listFoldersLite(WS);
  const biz = lite.find((f) => f.key === root.key);
  const hvac = lite.find((f) => f.key === trade.key);
  assert.ok(biz);
  assert.equal(biz.isPipelineDefault, true);
  assert.ok(hvac);
  assert.equal(hvac.isTradeFolder, true);
  assert.equal(hvac.parentFolderKey, root.key);
  assert.equal(hvac.tradeSlug, 'hvac');
});
