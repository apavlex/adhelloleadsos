const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.APP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'network-trades-'));

const test = require('node:test');
const assert = require('node:assert/strict');
const trades = require('../services/networkTrades');
const store = require('../services/networkStore');

test('new built-ins stay off for networks created before them', () => {
  assert.ok(trades.tradeBySlug('interior_design'));
  const net = store.normalizeNetwork({ id: 'n1' });
  assert.deepEqual(net.trades, trades.ORIGINAL_TRADE_SLUGS);
  assert.ok(!net.trades.includes('interior_design'));
  assert.equal(trades.tradesForNetwork(net).length, trades.ORIGINAL_TRADE_SLUGS.length);
});

test('custom trades get a slug, label, recruit keyword and a seat', () => {
  const custom = trades.normalizeCustomTrades([
    { name: '  Interior   designers ', keyword: 'interior designer' },
    { name: 'Interior designers' },
    { name: 'Plumbing' },
    { name: '' },
  ]);
  assert.deepEqual(custom.map((t) => t.slug), ['x_interior_designers']);
  const net = store.normalizeNetwork({ id: 'n2', trades: ['hvac', 'x_interior_designers', 'x_gone'], customTrades: custom });
  assert.deepEqual(net.trades, ['hvac', 'x_interior_designers']);
  assert.deepEqual(trades.tradesForNetwork(net).map((t) => t.name), ['HVAC', 'Interior designers']);
  assert.equal(trades.tradeLabel('x_interior_designers', net), 'Interior designers');
  assert.equal(trades.tradeLabel('x_interior_designers'), 'Interior designers');
  const url = trades.recruitSearchUrl('x_interior_designers', { cities: ['Camas, WA'] }, net);
  assert.match(url, /keyword=interior\+designer/);
  assert.match(url, /city=Camas/);
});

test('member trade lists keep custom slugs without the network', () => {
  assert.deepEqual(trades.normalizeTradeSlugs(['x_tile_pros', 'hvac', 'bogus', 'x_tile_pros']), ['hvac', 'x_tile_pros']);
  const member = store.normalizeMember({ id: 'm1', companyName: 'Acme', trades: ['x_interior_designers', 'plumbing'] });
  assert.deepEqual(member.trades, ['plumbing', 'x_interior_designers']);
});

test('saved networks round-trip custom trades', async () => {
  const network = await store.getOrCreateNetworkForWorkspace('ws_trades_1', { name: 'Trades test' });
  const saved = await store.saveNetwork({
    ...network,
    customTrades: [{ name: 'Interior designers', keyword: 'interior designer' }],
    trades: network.trades.concat('x_interior_designers'),
  });
  const loaded = await store.getNetwork(saved.id);
  assert.deepEqual(loaded.customTrades, [{ slug: 'x_interior_designers', name: 'Interior designers', keyword: 'interior designer' }]);
  assert.ok(loaded.trades.includes('x_interior_designers'));
});
