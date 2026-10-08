const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.APP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ghl-opp-sync-'));

const test = require('node:test');
const assert = require('node:assert/strict');
const dbService = require('../services/database');
const sync = require('../services/ghlOpportunitySync');

const WID = 'ws_opp_sync';
const env = { GHL_API_KEY: 'tok', GHL_LOCATION_ID: 'loc1' };
const T0 = Date.now() - 60 * 60000;
const at = (mins) => new Date(T0 + mins * 60000).toISOString();

const GHL_PIPELINES = [
  {
    id: 'gp1',
    name: 'Sales Pipeline',
    stages: [
      { id: 'gs1', name: 'New Lead', position: 0 },
      { id: 'gs2', name: 'Qualified', position: 1 },
      { id: 'gs3', name: 'Won', position: 2 },
    ],
  },
  { id: 'gp2', name: 'Referrals', stages: [{ id: 'gs4', name: 'Intro', position: 0 }] },
];

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function fakeGhl(opps, { denyScope = false } = {}) {
  const calls = [];
  let n = 0;
  const original = global.fetch;
  global.fetch = async (url, init) => {
    const u = new URL(String(url));
    const method = (init && init.method) || 'GET';
    const body = init && init.body ? JSON.parse(init.body) : null;
    calls.push({ method, path: u.pathname, query: Object.fromEntries(u.searchParams), body });
    if (denyScope) return json(401, { message: 'The token is not authorized for this scope.' });
    if (u.pathname === '/opportunities/pipelines') return json(200, { pipelines: GHL_PIPELINES });
    if (u.pathname === '/opportunities/search') {
      const list = [...opps.values()].filter((o) => o.pipelineId === u.searchParams.get('pipeline_id'));
      return json(200, { opportunities: list, meta: { total: list.length } });
    }
    if (u.pathname === '/opportunities/upsert') {
      n += 1;
      const opp = { id: `go_new${n}`, ...body, updatedAt: new Date().toISOString() };
      opps.set(opp.id, opp);
      return json(200, { opportunity: opp, new: true });
    }
    const put = u.pathname.match(/^\/opportunities\/([^/]+)$/);
    if (put && method === 'PUT') {
      const opp = { ...(opps.get(put[1]) || { id: put[1] }), ...body, updatedAt: new Date().toISOString() };
      opps.set(opp.id, opp);
      return json(200, { opportunity: opp });
    }
    const contact = u.pathname.match(/^\/contacts\/([^/]+)$/);
    if (contact) {
      return json(200, { contact: { id: contact[1], companyName: 'Acme Roofing', email: 'acme@example.com', phone: '+15550109999' } });
    }
    return json(404, { message: `unexpected ${method} ${u.pathname}` });
  };
  return { calls, restore: () => { global.fetch = original; } };
}

const SALES = 'opl_sales1';
const MARKETING = 'opl_mkt1';
const NEW = 'ops_new1';
const QUAL = 'ops_qual1';
const fp = (pipelineId, stageId) => `${pipelineId}|${stageId}|0|0`;

async function lead(fields) {
  const key = await dbService.saveLead({
    phone: 'N/A',
    email: 'N/A',
    website: 'N/A',
    status: 'Not Contacted',
    workspaceId: WID,
    savedAt: at(0),
    ...fields,
  });
  return key;
}

async function leadByTitle(title) {
  const all = await dbService.getAllLeads(WID);
  return all.find((l) => l.title === title);
}

test('linkBoards links by name, creates missing boards, keeps AdHello-only boards', () => {
  const boards = {
    activePipelineId: MARKETING,
    pipelines: [
      { id: MARKETING, name: 'Marketing Pipeline', stages: [{ id: 'ops_m1', name: 'New opportunity' }] },
      {
        id: SALES,
        name: 'sales pipeline',
        stages: [
          { id: NEW, name: 'New opportunity' },
          { id: QUAL, name: 'Qualified' },
          { id: 'ops_local1', name: 'Local only' },
        ],
      },
    ],
  };
  const { boards: out, summary } = sync.linkBoards(boards, GHL_PIPELINES);
  const sales = out.pipelines.find((p) => p.id === SALES);
  assert.equal(sales.ghlPipelineId, 'gp1');
  assert.equal(sales.name, 'Sales Pipeline');
  assert.deepEqual(sales.stages.map((s) => [s.name, s.ghlStageId || '']), [
    ['New Lead', 'gs1'],
    ['Qualified', 'gs2'],
    ['Won', 'gs3'],
    ['Local only', ''],
  ]);
  assert.equal(sales.stages[0].id, NEW);
  assert.equal(out.pipelines.find((p) => p.id === MARKETING).ghlPipelineId, undefined);
  assert.deepEqual(summary.createdBoards, ['Referrals']);
});

test('full sync pulls GHL changes, pushes AdHello cards, latest change wins', async () => {
  await dbService.saveWorkspace(WID, {
    id: WID,
    name: 'Opp Sync',
    opportunityBoards: {
      activePipelineId: MARKETING,
      pipelines: [
        { id: MARKETING, name: 'Marketing Pipeline', stages: [{ id: 'ops_m1', name: 'New opportunity' }] },
        { id: SALES, name: 'Sales Pipeline', stages: [{ id: NEW, name: 'New opportunity' }, { id: QUAL, name: 'Qualified' }] },
      ],
    },
  });

  await lead({ title: 'Push Me', ghlContactId: 'c_a', opportunityPipelineId: SALES, opportunityStageId: QUAL, opportunityValue: 2500 });
  await lead({
    title: 'Moved In GHL',
    ghlContactId: 'c_b',
    ghlOpportunityId: 'go_b',
    opportunityPipelineId: SALES,
    opportunityStageId: QUAL,
    ghlOpportunitySync: { id: 'go_b', fingerprint: fp(SALES, QUAL), remoteUpdatedAt: at(0), status: 'open' },
  });
  await lead({ title: 'Marketing Only', ghlContactId: 'c_d', opportunityPipelineId: MARKETING, opportunityStageId: 'ops_m1' });
  await lead({
    title: 'Local Newer',
    ghlContactId: 'c_e',
    ghlOpportunityId: 'go_e',
    opportunityPipelineId: SALES,
    opportunityStageId: QUAL,
    opportunityChangedAt: at(10),
    ghlOpportunitySync: { id: 'go_e', fingerprint: fp(SALES, NEW), remoteUpdatedAt: at(0), status: 'open' },
  });
  await lead({
    title: 'GHL Newer',
    ghlContactId: 'c_f',
    ghlOpportunityId: 'go_f',
    opportunityPipelineId: SALES,
    opportunityStageId: QUAL,
    opportunityChangedAt: at(5),
    ghlOpportunitySync: { id: 'go_f', fingerprint: fp(SALES, NEW), remoteUpdatedAt: at(0), status: 'open' },
  });

  const opps = new Map(
    [
      { id: 'go_b', pipelineId: 'gp1', pipelineStageId: 'gs3', contactId: 'c_b', status: 'open', monetaryValue: 900, updatedAt: at(20) },
      { id: 'go_c', name: 'Acme deal', pipelineId: 'gp2', pipelineStageId: 'gs4', contactId: 'c_c', status: 'open', updatedAt: at(20) },
      { id: 'go_e', pipelineId: 'gp1', pipelineStageId: 'gs3', contactId: 'c_e', status: 'open', updatedAt: at(5) },
      { id: 'go_f', pipelineId: 'gp1', pipelineStageId: 'gs3', contactId: 'c_f', status: 'open', updatedAt: at(10) },
    ].map((o) => [o.id, o]),
  );
  const ghl = fakeGhl(opps);
  let status;
  try {
    status = await sync.syncWorkspace(WID, { integrationEnv: env });
  } finally {
    ghl.restore();
  }
  assert.equal(status.ok, true, status.error);

  const ws = await dbService.getWorkspace(WID);
  const sales = ws.opportunityBoards.pipelines.find((p) => p.id === SALES);
  const won = sales.stages.find((s) => s.ghlStageId === 'gs3');
  const referrals = ws.opportunityBoards.pipelines.find((p) => p.ghlPipelineId === 'gp2');
  assert.ok(won && referrals);
  assert.equal(ws.ghlOpportunitySync.ok, true);
  assert.deepEqual(ws.ghlOpportunitySync.localOnlyBoards, ['Marketing Pipeline']);

  const pushed = await leadByTitle('Push Me');
  const created = [...opps.values()].find((o) => o.contactId === 'c_a');
  assert.ok(created, 'opportunity created in GHL');
  assert.equal(created.pipelineStageId, 'gs2');
  assert.equal(created.monetaryValue, 2500);
  assert.equal(pushed.ghlOpportunityId, created.id);

  const movedInGhl = await leadByTitle('Moved In GHL');
  assert.equal(movedInGhl.opportunityStageId, won.id);
  assert.equal(movedInGhl.opportunityValue, 900);

  const fromGhl = await leadByTitle('Acme Roofing');
  assert.ok(fromGhl, 'GHL-only opportunity becomes an AdHello lead');
  assert.equal(fromGhl.opportunityPipelineId, referrals.id);
  assert.equal(fromGhl.ghlContactId, 'c_c');

  assert.equal(opps.get('go_e').pipelineStageId, 'gs2', 'newer AdHello move pushed to GHL');
  assert.equal((await leadByTitle('Local Newer')).opportunityStageId, QUAL);
  assert.equal((await leadByTitle('GHL Newer')).opportunityStageId, won.id, 'newer GHL move pulled');

  assert.ok(!ghl.calls.some((c) => c.body && c.body.contactId === 'c_d'), 'AdHello-only board is not pushed');
  assert.equal(status.created, 1);

  // A second run with nothing changed makes no writes.
  const quiet = fakeGhl(opps);
  try {
    await sync.syncWorkspace(WID, { integrationEnv: env });
  } finally {
    quiet.restore();
  }
  assert.deepEqual(quiet.calls.filter((c) => c.method !== 'GET'), []);
});

test('moving a synced card to an AdHello-only board closes it in GHL', async () => {
  const pushed = await leadByTitle('Push Me');
  await dbService.updateLead(pushed.key, { opportunityPipelineId: MARKETING, opportunityStageId: 'ops_m1', opportunityChangedAt: new Date().toISOString() }, WID);
  const opps = new Map([[pushed.ghlOpportunityId, { id: pushed.ghlOpportunityId, status: 'open' }]]);
  const ghl = fakeGhl(opps);
  try {
    await sync.pushLeadsNow(WID, [pushed.key], { integrationEnv: env });
  } finally {
    ghl.restore();
  }
  assert.equal(opps.get(pushed.ghlOpportunityId).status, 'abandoned');
});

test('a running sync reports percent complete, then clears it', async () => {
  const ghl = fakeGhl(new Map());
  try {
    const run = sync.syncWorkspace(WID, { integrationEnv: env });
    const during = sync.statusFor({ id: WID });
    assert.equal(during.running, true);
    assert.equal(typeof during.progress.percent, 'number');
    await run;
  } finally {
    ghl.restore();
  }
  const after = sync.statusFor({ id: WID });
  assert.equal(after.running, false);
  assert.equal(after.progress, null);
});

test('missing opportunity scopes give a clear fix', async () => {
  const ghl = fakeGhl(new Map(), { denyScope: true });
  let status;
  try {
    status = await sync.syncWorkspace(WID, { integrationEnv: env });
  } finally {
    ghl.restore();
  }
  assert.equal(status.ok, false);
  assert.match(status.error, /View Opportunities/);
});
