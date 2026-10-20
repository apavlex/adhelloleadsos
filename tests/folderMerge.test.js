const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.APP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'folder-merge-'));

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const dbService = require('../services/database');
const { mergeFoldersInto } = require('../services/folderMerge');

describe('folderMerge', () => {
  let n = 0;

  async function setup() {
    n += 1;
    const wid = `ws_folder_merge_${n}`;
    await dbService.saveWorkspace(wid, {
      id: wid,
      name: 'Folder merge WS',
      ownerUserId: 'owner@example.com',
      isDemo: true,
      members: { 'owner@example.com': { role: 'owner' } },
    });
    const target = await dbService.createFolder(wid, 'Landscaping');
    const sourceA = await dbService.createFolder(wid, 'Landscaper');
    const sourceB = await dbService.createFolder(wid, 'Landscaping Vancouver');
    await dbService.saveLeadWithMeta({
      workspaceId: wid,
      title: 'Alpha Lawn',
      phone: '5035550101',
      folderKey: sourceA.key,
    });
    await dbService.saveLeadWithMeta({
      workspaceId: wid,
      title: 'Beta Gardens',
      phone: '5035550102',
      folderKey: sourceB.key,
    });
    await dbService.saveLeadWithMeta({
      workspaceId: wid,
      title: 'Keep Me',
      phone: '5035550103',
      folderKey: target.key,
    });
    return { wid, target, sourceA, sourceB };
  }

  it('moves leads into target and deletes source folders', async () => {
    const { wid, target, sourceA, sourceB } = await setup();
    const result = await mergeFoldersInto({
      workspaceId: wid,
      targetFolderKey: target.key,
      sourceFolderKeys: [sourceA.key, sourceB.key],
    });
    assert.equal(result.success, true, result.error);
    assert.equal(result.movedLeads, 2);
    assert.equal(result.deletedFolders.length, 2);

    const leads = await dbService.getAllLeads(wid);
    assert.equal(leads.length, 3);
    assert.ok(leads.every((l) => String(l.folderKey) === String(target.key)));
    assert.equal(await dbService.getFolder(wid, sourceA.key), null);
    assert.equal(await dbService.getFolder(wid, sourceB.key), null);
    assert.ok(await dbService.getFolder(wid, target.key));
  });

  it('rejects merging a folder into itself', async () => {
    const { wid, target, sourceA } = await setup();
    const result = await mergeFoldersInto({
      workspaceId: wid,
      targetFolderKey: target.key,
      sourceFolderKeys: [target.key, sourceA.key],
    });
    assert.equal(result.success, false);
    assert.match(String(result.error || ''), /itself/i);
  });
});
