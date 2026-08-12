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

test('buildFolderTree includes Permits system root and nested permit subfolders', () => {
  const tree = buildFolderTree([
    { key: 'root:permits', name: 'Permits', jobType: 'permits', isPipelineDefault: true },
    {
      key: 'sub:nc-camas',
      name: 'New Construction Camas',
      parentFolderKey: 'root:permits',
      jobType: 'permits',
    },
  ]);
  const permits = tree.groups.find((g) => g.key === 'root:permits');
  assert.ok(permits, 'Permits should appear in folder tree groups');
  assert.equal(permits.children.length, 1);
  assert.equal(permits.children[0].name, 'New Construction Camas');
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

test('sortFolderTreeByLeadCount puts folders with leads first and empty last', () => {
  const { buildFolderTree, sortFolderTreeByLeadCount, buildFolderAggregateCounts } = require('../services/folderTree');
  const tree = buildFolderTree([
    { key: 'root:biz', name: 'Businesses', jobType: 'maps_business', isPipelineDefault: true },
    { key: 'root:ho', name: 'Home owners', jobType: 'home_owners', isPipelineDefault: true },
    { key: 'sub:mech', name: 'Mechanical', parentFolderKey: 'root:biz', jobType: 'maps_business' },
    { key: 'sub:floor', name: 'Flooring Companies', parentFolderKey: 'root:biz', jobType: 'maps_business' },
    { key: 'sub:build', name: 'Home Builders', parentFolderKey: 'root:biz', jobType: 'maps_business' },
  ]);
  const direct = { 'sub:floor': 98, 'sub:build': 57, 'sub:mech': 0, 'root:biz': 337 };
  const agg = buildFolderAggregateCounts(tree, direct);
  const sorted = sortFolderTreeByLeadCount(tree, agg);
  const biz = sorted.groups.find((g) => g.key === 'root:biz');
  assert.deepEqual(
    biz.children.map((c) => c.name),
    ['Flooring Companies', 'Home Builders', 'Mechanical'],
  );
  assert.equal(sorted.groups[0].key, 'root:biz');
  assert.equal(sorted.groups[sorted.groups.length - 1].key, 'root:ho');
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

test('buildFolderPickerTree nests children for collapsible picker', () => {
  const { buildFolderPickerTree } = require('../services/folderTree');
  const tree = buildFolderTree([
    { key: 'root:biz', name: 'Businesses', jobType: 'maps_business', isPipelineDefault: true },
    { key: 'sub:elec', name: 'Electrical', parentFolderKey: 'root:biz', isTradeFolder: true, tradeSlug: 'electrical' },
    { key: 'custom:1', name: 'Electricians PDX', parentFolderKey: 'sub:elec', jobType: 'maps_business' },
  ]);
  const picker = buildFolderPickerTree(tree, 'custom:1');
  assert.equal(picker.selectedLabel, 'Electricians PDX');
  const biz = picker.roots.find((n) => n.key === 'root:biz');
  assert.ok(biz);
  assert.equal(biz.hasChildren, true);
  assert.equal(biz.children.length, 1);
  assert.equal(biz.children[0].name, 'Electrical');
  assert.equal(biz.children[0].children[0].name, 'Electricians PDX');
});

test('buildFolderAggregateCounts includes nested subfolder leads', () => {
  const { buildFolderAggregateCounts } = require('../services/folderTree');
  const tree = buildFolderTree([
    { key: 'root:biz', name: 'Businesses', jobType: 'maps_business', isPipelineDefault: true },
    { key: 'sub:land', name: 'Landscaping', parentFolderKey: 'root:biz', isTradeFolder: true, tradeSlug: 'landscaping' },
    { key: 'custom:1', name: 'Landscaper', parentFolderKey: 'sub:land', jobType: 'maps_business' },
    { key: 'custom:2', name: 'Landscaping Vancouver', parentFolderKey: 'sub:land', jobType: 'maps_business' },
  ]);
  const direct = { 'custom:1': 11, 'custom:2': 119 };
  const agg = buildFolderAggregateCounts(tree, direct);
  assert.equal(agg['sub:land'], 130);
  assert.equal(agg['custom:1'], 11);
  assert.equal(agg['custom:2'], 119);
  assert.equal(agg['root:biz'], 130);
});

test('buildFolderAggregateTags unions active tags from nested subfolders', () => {
  const { buildFolderTree, buildFolderAggregateTags } = require('../services/folderTree');
  const tree = buildFolderTree([
    { key: 'root:biz', name: 'Businesses', jobType: 'maps_business', isPipelineDefault: true },
    { key: 'sub:land', name: 'Landscaping', parentFolderKey: 'root:biz', isTradeFolder: true, tradeSlug: 'landscaping' },
    { key: 'custom:1', name: 'Landscaper', parentFolderKey: 'sub:land', jobType: 'maps_business' },
    { key: 'custom:2', name: 'Landscaping Vancouver', parentFolderKey: 'sub:land', jobType: 'maps_business' },
  ]);
  const tagA = 'tag:ws:1';
  const tagB = 'tag:ws:2';
  const catalog = {
    [tagA]: { key: tagA, name: 'Hot', color: '#ef4444' },
    [tagB]: { key: tagB, name: 'Warm', color: '#f59e0b' },
  };
  const direct = {
    'custom:1': new Set([tagA]),
    'custom:2': new Set([tagB, tagA]),
  };
  const agg = buildFolderAggregateTags(tree, direct, catalog);
  assert.equal(agg['custom:1'].length, 1);
  assert.equal(agg['custom:1'][0].name, 'Hot');
  assert.equal(agg['custom:2'].length, 2);
  assert.equal(agg['sub:land'].length, 2);
  assert.deepEqual(
    agg['sub:land'].map((t) => t.name),
    ['Hot', 'Warm']
  );
  assert.equal(agg['root:biz'].length, 2);
});

test('folderKeysIncludingDescendants includes nested subfolders', () => {
  const { folderKeysIncludingDescendants } = require('../services/folderTree');
  const tree = buildFolderTree([
    { key: 'root:biz', name: 'Businesses', jobType: 'maps_business', isPipelineDefault: true },
    { key: 'sub:hvac', name: 'HVAC', parentFolderKey: 'root:biz', isTradeFolder: true, tradeSlug: 'hvac' },
    { key: 'sub:elec', name: 'Electrical', parentFolderKey: 'root:biz', isTradeFolder: true, tradeSlug: 'electrical' },
    { key: 'custom:1', name: 'Electricians PDX', parentFolderKey: 'sub:elec', jobType: 'maps_business' },
  ]);
  const keys = folderKeysIncludingDescendants(tree, 'root:biz');
  assert.ok(keys.has('root:biz'));
  assert.ok(keys.has('sub:hvac'));
  assert.ok(keys.has('sub:elec'));
  assert.ok(keys.has('custom:1'));
  assert.equal(keys.size, 4);
});
