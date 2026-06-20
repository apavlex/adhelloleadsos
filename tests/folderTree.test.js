const test = require('node:test');
const assert = require('node:assert/strict');
const { TRADE_FOLDERS } = require('../services/tradeFoldersCatalog');
const { buildFolderTree, OTHER_GROUP_KEY } = require('../services/folderTree');

test('trade catalog includes ServiceTitan core trades', () => {
  const names = TRADE_FOLDERS.map((t) => t.name);
  assert.ok(names.includes('HVAC'));
  assert.ok(names.includes('Plumbing'));
  assert.ok(names.includes('Electrical'));
  assert.ok(names.includes('Roofing'));
  assert.equal(TRADE_FOLDERS.length, 28);
});

test('buildFolderTree nests subfolders under system roots', () => {
  const tree = buildFolderTree([
    { key: 'root:biz', name: 'Businesses', jobType: 'maps_business', isPipelineDefault: true },
    { key: 'root:re', name: 'Real estate', jobType: 'real_estate', isPipelineDefault: true },
    { key: 'sub:hvac', name: 'HVAC', parentFolderKey: 'root:biz', isTradeFolder: true, tradeSlug: 'hvac' },
  ]);
  assert.equal(tree.groups.length, 2);
  const biz = tree.groups.find((g) => g.key === 'root:biz');
  assert.ok(biz);
  assert.equal(biz.children.length, 1);
  assert.equal(biz.children[0].name, 'HVAC');
  assert.equal(biz.childRows.length, 1);
  assert.equal(biz.childRows[0].depth, 1);
});

test('buildFolderTree nests grandchildren under trade folders', () => {
  const tree = buildFolderTree([
    { key: 'root:biz', name: 'Businesses', jobType: 'maps_business', isPipelineDefault: true },
    { key: 'sub:elec', name: 'Electrical', parentFolderKey: 'root:biz', isTradeFolder: true, tradeSlug: 'electrical' },
    { key: 'custom:1', name: 'Electricians PDX', parentFolderKey: 'sub:elec', jobType: 'maps_business' },
  ]);
  const biz = tree.groups.find((g) => g.key === 'root:biz');
  assert.equal(biz.childRows.length, 2);
  assert.equal(biz.childRows[1].folder.name, 'Electricians PDX');
  assert.equal(biz.childRows[1].depth, 2);
});

test('buildFolderTree groups orphans without parent', () => {
  const tree = buildFolderTree([
    { key: 'root:biz', name: 'Businesses', jobType: 'maps_business', isPipelineDefault: true },
    { key: 'orphan:1', name: 'Referrals', isPipelineDefault: false },
  ]);
  const other = tree.groups.find((g) => g.key === OTHER_GROUP_KEY);
  assert.ok(other);
  assert.equal(other.children.length, 1);
});

test('buildFolderPickerOptions groups folders and dedupes keys', () => {
  const { buildFolderPickerOptions } = require('../services/folderTree');
  const tree = buildFolderTree([
    { key: 'root:biz', name: 'Businesses', jobType: 'maps_business', isPipelineDefault: true },
    { key: 'sub:hvac', name: 'HVAC', parentFolderKey: 'root:biz', isTradeFolder: true, tradeSlug: 'hvac' },
    { key: 'sub:hvac:dup', name: 'HVAC', parentFolderKey: 'root:biz', isTradeFolder: true, tradeSlug: 'hvac' },
  ]);
  const options = buildFolderPickerOptions(tree, 'sub:hvac');
  const hvac = options.filter((o) => o.label.includes('HVAC'));
  assert.equal(hvac.length, 1);
  assert.equal(options.find((o) => o.selected)?.key, 'sub:hvac');
  assert.ok(options.some((o) => o.groupName === 'Businesses'));
});
