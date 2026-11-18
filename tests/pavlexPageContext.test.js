const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  describePageForSession,
  formatFolderCatalog,
  normalizeUiContext,
} = require('../services/pavlex/pavlexPageContext');

describe('pavlexPageContext', () => {
  it('describes pipeline folder page for SESSION', () => {
    const info = describePageForSession(
      '/prospecting?tab=pipeline&folderKey=folder:ws:abc',
      'Pipeline | Agency OS',
      {
        folderKey: 'folder:ws:abc',
        folderName: 'Vancouver Roofers',
        tab: 'pipeline',
        selectedCount: 2,
        selectedLeadKeys: ['lead:1', 'lead:2'],
      },
    );
    assert.match(info.text, /Looking at: Pipeline/);
    assert.match(info.text, /Open folder: Vancouver Roofers/);
    assert.match(info.text, /Selected leads on page: 2/);
    assert.match(info.text, /these/);
    assert.equal(info.folderKey, 'folder:ws:abc');
  });

  it('formats folder catalog with nested paths', () => {
    const text = formatFolderCatalog([
      { key: 'folder:1', name: 'Businesses', parentFolderKey: '' },
      { key: 'folder:2', name: 'Roofers', parentFolderKey: 'folder:1' },
    ]);
    assert.match(text, /Businesses \(key=folder:1\)/);
    assert.match(text, /Businesses \/ Roofers \(key=folder:2\)/);
  });

  it('normalizes ui payload', () => {
    const ui = normalizeUiContext({
      folderKey: '  folder:x  ',
      selectedLeadKeys: ['a', '', 'b'],
      selectedCount: '3',
    });
    assert.equal(ui.folderKey, 'folder:x');
    assert.deepEqual(ui.selectedLeadKeys, ['a', 'b']);
    assert.equal(ui.selectedCount, 3);
  });
});
