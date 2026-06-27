const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { shouldApplyIncomingFolderKey } = require('../services/leadDedupe');

describe('shouldApplyIncomingFolderKey', () => {
  const existing = { key: 'lead:1', folderKey: 'folder:flooring' };

  it('assigns folder when lead has no folder yet', () => {
    assert.equal(
      shouldApplyIncomingFolderKey({}, { folderKey: 'folder:chrome' }),
      true,
    );
  });

  it('preserves folder on single chrome extension re-save', () => {
    assert.equal(
      shouldApplyIncomingFolderKey(existing, {
        folderKey: 'folder:chrome',
        source: 'chrome_extension',
      }),
      false,
    );
  });

  it('moves folder on CSV import with importFilename', () => {
    assert.equal(
      shouldApplyIncomingFolderKey(existing, {
        folderKey: 'folder:new',
        source: 'chrome_extension',
        importFilename: 'maps-scrape-batch-1.csv',
      }),
      true,
    );
  });

  it('moves folder when forceFolderKey is set', () => {
    assert.equal(
      shouldApplyIncomingFolderKey(existing, {
        folderKey: 'folder:assigned',
        forceFolderKey: true,
      }),
      true,
    );
  });
});
