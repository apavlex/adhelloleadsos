const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { resolveLeadsBySelectedKeys } = require('../services/bulkSelectionKeys');

describe('tagsAssign lead resolution', () => {
  const visible = [
    { key: 'lead:1700000001', title: 'Home Builder A', folderKey: 'folder:home-builders', tags: [] },
    { key: 'lead:1700000002', title: 'Home Builder B', folderKey: 'folder:home-builders', tags: ['tag:ws:1'] },
  ];

  it('resolves foldered leads by full storage key', async () => {
    const matched = await resolveLeadsBySelectedKeys({
      dbService: { getLead: async () => null, leadBelongsToWorkspace: async () => true },
      workspaceId: 'ws',
      visibleLeads: visible,
      keyOrder: ['lead:1700000001', 'lead:1700000002'],
    });
    assert.equal(matched.length, 2);
    assert.equal(matched[0].title, 'Home Builder A');
  });

  it('resolves foldered leads by short key', async () => {
    const matched = await resolveLeadsBySelectedKeys({
      dbService: { getLead: async () => null, leadBelongsToWorkspace: async () => true },
      workspaceId: 'ws',
      visibleLeads: visible,
      keyOrder: ['1700000002'],
    });
    assert.equal(matched.length, 1);
    assert.equal(matched[0].title, 'Home Builder B');
  });
});
