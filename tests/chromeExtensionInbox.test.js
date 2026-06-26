const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const dbService = require('../services/database');
const {
  CHROME_EXTENSION_FOLDER_NAME,
  ensureChromeExtensionFolder,
  chromeExtensionFolderUrl,
} = require('../services/chromeExtensionInbox');

describe('chromeExtensionInbox', () => {
  it('uses stable folder name and builds pipeline URL', () => {
    assert.equal(CHROME_EXTENSION_FOLDER_NAME, 'Chrome Extension');
    assert.match(chromeExtensionFolderUrl('folder:abc'), /folderKey=folder%3Aabc/);
  });

  describe('folder persistence', () => {
    let leadKey = '';

    beforeEach(async () => {
      leadKey = await dbService.saveLead({
        title: 'Chrome Extension Inbox Test Co',
        workspaceId: 'default',
        status: 'Not Contacted',
        pipelineStage: 1,
        phone: '+15555550301',
        source: 'test',
      });
    });

    afterEach(async () => {
      if (leadKey) await dbService.deleteLead(leadKey);
      leadKey = '';
    });

    it('creates the Chrome Extension folder once', async () => {
      const first = await ensureChromeExtensionFolder('default');
      const second = await ensureChromeExtensionFolder('default');
      assert.ok(first && first.key);
      assert.equal(second.key, first.key);
      assert.equal(String(first.name || ''), CHROME_EXTENSION_FOLDER_NAME);
    });
  });
});
