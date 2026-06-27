const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  validateFolderMove,
  collectDescendantKeys,
  buildFolderMoveOptions,
  buildChildrenMap,
} = require('../services/folderMove');

describe('folderMove', () => {
  const folders = [
    { key: 'root:biz', name: 'Businesses', jobType: 'maps_business', isPipelineDefault: true },
    { key: 'root:re', name: 'Real estate', jobType: 'real_estate', isPipelineDefault: true },
    { key: 'sub:floor', name: 'Flooring', parentFolderKey: 'root:biz', isTradeFolder: true, tradeSlug: 'flooring', jobType: 'maps_business' },
    { key: 'custom:chrome', name: 'Chrome Extension', jobType: '' },
    { key: 'custom:dental', name: 'Dental - Vancouver WA', jobType: '' },
    { key: 'custom:nested', name: 'Nested custom', parentFolderKey: 'custom:chrome' },
  ];

  it('moves a folder under Businesses root', () => {
    const result = validateFolderMove(folders, 'custom:chrome', 'root:biz');
    assert.equal(result.ok, true);
    assert.equal(result.patch.parentFolderKey, 'root:biz');
    assert.equal(result.patch.jobType, 'maps_business');
  });

  it('moves a folder under a trade subfolder', () => {
    const result = validateFolderMove(folders, 'custom:dental', 'sub:floor');
    assert.equal(result.ok, true);
    assert.equal(result.patch.parentFolderKey, 'sub:floor');
    assert.equal(result.patch.jobType, 'maps_business');
  });

  it('moves a folder to Other (top-level)', () => {
    const result = validateFolderMove(folders, 'custom:chrome', '');
    assert.equal(result.ok, true);
    assert.equal(result.patch.parentFolderKey, '');
    assert.equal(result.patch.jobType, '');
  });

  it('blocks system folder moves', () => {
    const result = validateFolderMove(folders, 'root:biz', 'root:re');
    assert.equal(result.ok, false);
  });

  it('blocks trade folder moves', () => {
    const result = validateFolderMove(folders, 'sub:floor', 'root:biz');
    assert.equal(result.ok, false);
  });

  it('blocks moving under self or descendant', () => {
    assert.equal(validateFolderMove(folders, 'custom:chrome', 'custom:chrome').ok, false);
    assert.equal(validateFolderMove(folders, 'custom:chrome', 'custom:nested').ok, false);
  });

  it('collectDescendantKeys finds nested children', () => {
    const map = buildChildrenMap(folders);
    const desc = collectDescendantKeys('custom:chrome', map);
    assert.equal(desc.has('custom:nested'), true);
  });

  it('buildFolderMoveOptions excludes self and descendants', () => {
    const options = buildFolderMoveOptions(folders, 'custom:chrome');
    const keys = options.map((o) => o.key);
    assert.ok(keys.includes('root:biz'));
    assert.ok(!keys.includes('custom:chrome'));
    assert.ok(!keys.includes('custom:nested'));
  });
});
