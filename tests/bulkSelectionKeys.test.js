const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { orderLeadsByKeys, parseBulkSelectionKeys } = require('../services/bulkSelectionKeys');

const leads = [
  { key: 'lead:111', title: 'Unfiled', folderKey: '' },
  { key: 'lead:222', title: 'In folder', folderKey: 'folder:abc' },
];

const pipelineOnly = leads.filter((l) => !String(l.folderKey || '').trim());

describe('bulkSelectionKeys', () => {
  it('parseBulkSelectionKeys normalizes lead: prefix', () => {
    assert.deepEqual(parseBulkSelectionKeys('111,lead:222,111'), ['111', '222']);
  });

  it('orderLeadsByKeys finds foldered leads when searching visible set', () => {
    const picked = orderLeadsByKeys(leads, ['222']);
    assert.equal(picked.length, 1);
    assert.equal(picked[0].title, 'In folder');
  });

  it('orderLeadsByKeys misses foldered leads when using pipeline-only set', () => {
    const picked = orderLeadsByKeys(pipelineOnly, ['222']);
    assert.equal(picked.length, 0);
  });
});
