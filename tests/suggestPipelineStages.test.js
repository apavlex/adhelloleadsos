const test = require('node:test');
const assert = require('node:assert/strict');

const llmClient = require('../services/llmClient');

function loadServiceWith({ providers, replies }) {
  const calls = [];
  llmClient.providersForChain = (chain) => (chain === 'openrouter' ? providers : []);
  llmClient.chatCompletion = async (opts) => {
    const prov = opts.providersOverride[0];
    calls.push(prov.name);
    const reply = replies[prov.name];
    if (reply instanceof Error) throw reply;
    return { content: reply || null, provider: prov.name, error: !reply };
  };
  delete require.cache[require.resolve('../services/suggestPipelineStages')];
  return { svc: require('../services/suggestPipelineStages'), calls };
}

const INTAKE = {
  businessDescription: 'Electrical remodels, new builds and smart panel upgrades',
  cycleLength: 'days',
  saleIncludes: ['site_visit', 'estimate', 'contract', 'deposit', 'install'],
  wonDefinition: 'Deposit received',
};

const GOOD = {
  stages: [
    { key: 'new_inquiry', name: 'New inquiry', color: '#94a3b8', isWon: false, isLost: false, slaHours: 4 },
    { key: 'site_visit', name: 'Site visit', color: '#60a5fa', isWon: false, isLost: false, slaHours: 24 },
    { key: 'estimate_sent', name: 'Estimate sent', color: '#a78bfa', isWon: false, isLost: false, slaHours: 48 },
    { key: 'deposit_received', name: 'Deposit received', color: '#4ade80', isWon: true, isLost: false, slaHours: null },
    { key: 'lost', name: 'Lost', color: '#f87171', isWon: false, isLost: true, slaHours: null },
  ],
  rationale: 'Fits a fast residential electrical sale.',
};

test('falls back to a starter pipeline built from the intake when no AI provider is configured', async () => {
  const { svc } = loadServiceWith({ providers: [], replies: {} });
  const out = await svc.suggestPipelineStages(INTAKE);
  assert.equal(out.success, true);
  assert.equal(out.fallback, true);
  const names = out.stages.map((s) => s.name);
  assert.ok(names.includes('Site visit scheduled'));
  assert.ok(names.includes('Estimate sent'));
  assert.ok(names.includes('Contract sent'));
  assert.ok(!names.includes('Awaiting deposit'), 'won is the deposit, so no separate deposit stage');
  const won = out.stages.filter((s) => s.isWon);
  assert.equal(won.length, 1);
  assert.equal(won[0].name, 'Deposit received');
  assert.ok(out.stages.some((s) => s.isLost));
  assert.equal(out.stages[0].isWon || out.stages[0].isLost, false);
});

test('skips a provider with unusable output and accepts fenced JSON from the next one', async () => {
  const { svc, calls } = loadServiceWith({
    providers: [
      { name: 'p1', model: 'a' },
      { name: 'p2', model: 'b' },
    ],
    replies: { p1: 'Let me think about the stages first…', p2: '```json\n' + JSON.stringify(GOOD) + '\n```' },
  });
  const out = await svc.suggestPipelineStages(INTAKE);
  assert.deepEqual(calls, ['p1', 'p2']);
  assert.equal(out.success, true);
  assert.equal(out.fallback, undefined);
  assert.equal(out.rationale, GOOD.rationale);
  assert.ok(out.stages.some((s) => s.isWon && s.name === 'Deposit received'));
});

test('a provider that throws still ends in a usable pipeline', async () => {
  const { svc } = loadServiceWith({ providers: [{ name: 'p1', model: 'a' }], replies: { p1: new Error('timeout') } });
  const out = await svc.suggestPipelineStages(INTAKE);
  assert.equal(out.success, true);
  assert.equal(out.fallback, true);
});

test('invalid intake is still rejected', async () => {
  const { svc } = loadServiceWith({ providers: [], replies: {} });
  const out = await svc.suggestPipelineStages({ ...INTAKE, cycleLength: 'forever' });
  assert.equal(out.success, false);
});

test('parseStagesResponse accepts a bare array and a nested pipeline object', () => {
  const { svc } = loadServiceWith({ providers: [], replies: {} });
  assert.equal(svc.parseStagesResponse(JSON.stringify(GOOD.stages)).stages.length, 5);
  assert.equal(svc.parseStagesResponse(JSON.stringify({ pipeline: { stages: GOOD.stages } })).stages.length, 5);
  assert.equal(svc.parseStagesResponse('no json here'), null);
});
