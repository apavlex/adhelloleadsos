const test = require('node:test');
const assert = require('node:assert/strict');

const llmClient = require('../services/llmClient');
const networkTrades = require('../services/networkTrades');

function loadServiceWith({ providers, replies }) {
  llmClient.providersForChain = (chain) => (chain === 'openrouter' ? providers : []);
  llmClient.chatCompletion = async (opts) => {
    const prov = opts.providersOverride[0];
    const reply = replies[prov.name];
    if (reply instanceof Error) throw reply;
    return { content: reply || null, provider: prov.name, error: !reply };
  };
  delete require.cache[require.resolve('../services/suggestPipelineStages')];
  delete require.cache[require.resolve('../services/suggestReferralNiches')];
  return require('../services/suggestReferralNiches');
}

const ELECTRICIAN = 'An electrical company doing remodel electrical, new builds and smart electrical panel upgrades';

test('without AI it still returns 26 niches, skipping the business’s own trade', async () => {
  const svc = loadServiceWith({ providers: [], replies: {} });
  const out = await svc.suggestReferralNiches({ businessDescription: ELECTRICIAN });
  assert.equal(out.fallback, true);
  assert.equal(out.niches.length, 26);
  const slugs = out.niches.map((n) => n.slug);
  assert.ok(!slugs.includes('electrical'));
  assert.equal(slugs[0], 'real_estate');
  assert.equal(new Set(slugs).size, 26);
});

test('maps AI niches onto built-in trades, keeps the rest as custom trades and pads to 26', async () => {
  const rows = [
    { name: 'Realtors', keyword: 'real estate agent', why: 'Buyers want panel and wiring updates.' },
    { name: 'Kitchen & bath remodelers', keyword: 'kitchen remodeler', why: 'Every remodel needs new circuits.' },
    { name: 'Electricians', keyword: 'electrician', why: 'own trade' },
    { name: 'General contractors', keyword: 'general contractor', why: 'Subcontract electrical work.' },
    { name: 'Real estate agents', keyword: 'realtor', why: 'duplicate' },
    { name: 'Solar installers', keyword: 'solar installer', why: 'Solar needs panel upgrades.' },
  ];
  for (let i = 0; i < 8; i += 1) rows.push({ name: `EV charger dealer ${i}`, keyword: 'ev charger', why: '' });
  const svc = loadServiceWith({
    providers: [{ name: 'p1', model: 'm' }],
    replies: { p1: '```json\n' + JSON.stringify({ niches: rows }) + '\n```' },
  });
  const out = await svc.suggestReferralNiches({ businessDescription: ELECTRICIAN, businessName: 'Bright Volt' });
  assert.equal(out.fallback, false);
  assert.equal(out.niches.length, 26);
  assert.deepEqual(out.niches[0], {
    slug: 'real_estate',
    name: 'Real estate',
    keyword: 'real estate agent',
    why: 'Buyers want panel and wiring updates.',
    builtIn: true,
  });
  assert.equal(out.niches[1].slug, 'x_kitchen_bath_remodelers');
  assert.equal(out.niches[1].builtIn, false);
  const slugs = out.niches.map((n) => n.slug);
  assert.ok(!slugs.includes('electrical'), 'own trade is dropped');
  assert.equal(slugs.filter((s) => s === 'real_estate').length, 1, 'duplicates are dropped');
  assert.ok(slugs.includes('solar'));
});

test('nichesToNetworkTrades produces trades the network catalog accepts', () => {
  const svc = loadServiceWith({ providers: [], replies: {} });
  const niches = svc.mapNiches(
    [
      { name: 'Realtors', keyword: 'realtor' },
      { name: 'Smart home installers', keyword: 'smart home installer' },
    ],
    new Set()
  );
  const existing = { customTrades: [{ slug: 'x_pool_builders', name: 'Pool builders', keyword: 'pool builder' }] };
  const { trades, customTrades } = svc.nichesToNetworkTrades(niches, existing);
  assert.deepEqual(trades, ['real_estate', 'x_smart_home_installers']);
  assert.deepEqual(customTrades.map((t) => t.slug), ['x_pool_builders', 'x_smart_home_installers']);
  const catalog = networkTrades.catalogFor({ customTrades });
  assert.deepEqual(networkTrades.normalizeTradeSlugs(trades, catalog).sort(), trades.slice().sort());
});

test('nicheSearchUrl prefills a Maps search in the workspace city', () => {
  const svc = loadServiceWith({ providers: [], replies: {} });
  const url = svc.nicheSearchUrl({ name: 'Realtors', keyword: 'real estate agent' }, { city: 'Vancouver', state: 'WA' });
  assert.equal(url, '/leads/find?type=maps&keyword=real+estate+agent&city=Vancouver&state=WA');
});

test('ownTradeSlugs matches whole words only', () => {
  const svc = loadServiceWith({ providers: [], replies: {} });
  assert.ok(!svc.ownTradeSlugs('A versatile design studio').has('tile'));
  assert.ok(svc.ownTradeSlugs('Tile and stone installs').has('tile'));
});
