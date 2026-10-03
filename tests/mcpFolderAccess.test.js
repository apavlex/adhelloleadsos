const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.APP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-folder-access-'));

const test = require('node:test');
const assert = require('node:assert/strict');
const dbService = require('../services/database');
const { executeCrmTool } = require('../services/mcp/mcpToolExecutor');

const OWNER = 'owner@example.com';
const WID = 'ws_folders';
let phoneSeq = 0;

async function call(name, args = {}) {
  const res = await executeCrmTool({ workspaceId: WID, userEmail: OWNER }, name, args);
  assert.equal(res.success, true, `${name}: ${res.error}`);
  return res;
}

async function addLeads(folderKey, n, prefix) {
  for (let i = 0; i < n; i += 1) {
    phoneSeq += 1;
    // eslint-disable-next-line no-await-in-loop
    await dbService.saveLeadWithMeta({ workspaceId: WID, title: `${prefix} ${i + 1}`, phone: `+1555444${String(phoneSeq).padStart(4, '0')}`, folderKey });
  }
}

const folders = {};

test.before(async () => {
  await dbService.saveWorkspace(WID, { id: WID, name: 'Folders WS', ownerUserId: OWNER, members: { [OWNER]: { role: 'owner' } } });
  await call('create_folder', { names: ['Businesses'] });
  folders.biz = (await dbService.listFolders(WID)).find((f) => f.name === 'Businesses');
  await call('create_folder', { names: ['Coffee Shop Bend, OR', 'Air duct cleaning'] });
  const all = await dbService.listFolders(WID);
  folders.coffee = all.find((f) => f.name === 'Coffee Shop Bend, OR');
  folders.air = all.find((f) => f.name === 'Air duct cleaning');
  await call('manage_folder', { action: 'move', folder: folders.coffee.key, parent_folder: 'Businesses' });
  await call('manage_folder', { action: 'move', folder: folders.air.key, parent_folder: 'Businesses' });
  await addLeads(folders.biz.key, 2, 'Direct');
  await addLeads(folders.coffee.key, 3, 'Coffee');
});

test('list_folders shows paths and counts that include subfolders, like the Folder manager', async () => {
  const { folders: list } = await call('list_folders');
  const biz = list.find((f) => f.name === 'Businesses');
  assert.equal(biz.leadCount, 5);
  assert.equal(biz.directLeadCount, 2);
  assert.equal(biz.subfolderCount, 2);
  const coffee = list.find((f) => f.name === 'Coffee Shop Bend, OR');
  assert.equal(coffee.path, 'Businesses / Coffee Shop Bend, OR');
  assert.equal(coffee.parentFolderKey, folders.biz.key);
  assert.equal(coffee.leadCount, 3);
});

test('get_folder lists immediate subfolders', async () => {
  const { folder } = await call('get_folder', { folder_name: 'Businesses' });
  assert.equal(folder.leadCount, 5);
  assert.deepEqual(folder.subfolders.map((f) => f.name).sort(), ['Air duct cleaning', 'Coffee Shop Bend, OR']);
});

test('system folders adopt trade folders by job type, with no parentFolderKey', async () => {
  const root = await dbService.createFolder(WID, 'Maps Businesses');
  await dbService.updateFolder(WID, root.key, { isPipelineDefault: true, jobType: 'maps_business' });
  const trade = await dbService.createFolder(WID, 'Roofers Bend');
  await dbService.updateFolder(WID, trade.key, { jobType: 'maps_business', isTradeFolder: true });
  await addLeads(trade.key, 4, 'Roofer');

  const { folders: list } = await call('list_folders');
  const sys = list.find((f) => f.key === root.key);
  assert.equal(sys.leadCount, 4);
  assert.equal(list.find((f) => f.key === trade.key).path, 'Maps Businesses / Roofers Bend');
  const listed = await call('list_leads', { folder_id: root.key, limit: 100 });
  assert.equal(listed.pagination.total, 4);
});

test('count_leads and list_leads include subfolders unless told not to', async () => {
  const count = await call('count_leads', { folder_name: 'Businesses' });
  assert.equal(count.count, 5);
  assert.equal(count.direct_count, 2);
  assert.equal((await call('count_leads', { folder_name: 'Businesses', include_subfolders: false })).count, 2);

  const listed = await call('list_leads', { folder_name: 'Businesses', limit: 100 });
  assert.equal(listed.pagination.total, 5);
  assert.equal(listed.folder.includes_subfolders, true);
  const direct = await call('list_leads', { folder_name: 'Businesses', include_subfolders: false });
  assert.deepEqual(direct.leads.map((l) => l.title).sort(), ['Direct 1', 'Direct 2']);
  const coffee = await call('list_leads', { folder_name: 'Coffee Shop Bend' });
  assert.equal(coffee.pagination.total, 3);
});
