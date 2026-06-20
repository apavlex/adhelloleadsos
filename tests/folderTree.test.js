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
