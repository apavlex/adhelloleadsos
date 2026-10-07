const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

process.env.APP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'trials-'));
process.env.TRIAL_PAID_CALLS_PER_DAY = '2';
process.env.TRIAL_AI_CALLS_PER_DAY = '1';
process.env.TRIAL_SIGNUPS_PER_IP_PER_DAY = '2';
process.env.GHL_API_KEY = 'server-ghl-key';
process.env.GHL_LOCATION_ID = 'server-location';
process.env.APIFY_API_TOKEN = 'server-apify';
process.env.WORKSPACE_INTEGRATIONS_SECRET = 'test-secret-0123456789abcdef';

const test = require('node:test');
const assert = require('node:assert/strict');
const dbService = require('../services/database');
const trials = require('../services/trials');
const guestEgress = require('../lib/guestEgress');
const workspaceIntegrations = require('../services/workspaceIntegrations');
const ghlClient = require('../services/ghlClient');

guestEgress.install();

const goodForm = {
  name: 'Jane Roofer',
  phone: '(555) 123-4567',
  company: 'Roof Growth Co',
  website: 'roofgrowth.com',
  niche: 'roofers',
  teamSize: '2-5',
  source: 'Referral',
};

test('signup form requires the contact fields and cleans the website', () => {
  const { form, errors } = trials.readSignupForm(goodForm);
  assert.deepEqual(errors, []);
  assert.equal(form.website, 'https://roofgrowth.com');

  const bad = trials.readSignupForm({ ...goodForm, phone: '123', teamSize: 'huge', source: '', niche: '' });
  assert.equal(bad.errors.length, 4);
});

test('signup creates a 7-day trial workspace owned by the new user', async () => {
  const now = Date.parse('2026-10-07T12:00:00Z');
  const { form } = trials.readSignupForm(goodForm);
  const { workspaceId, signup } = await trials.createTrialWorkspace(
    { email: 'Jane@Example.com', form, googleName: 'Jane R', ip: '198.51.100.7' },
    now,
  );
  const ws = await dbService.getWorkspace(workspaceId);
  assert.equal(ws.name, 'Roof Growth Co');
  assert.equal(ws.members['jane@example.com'].role, 'owner');
  assert.equal(ws.trial.endsAt, '2026-10-14T12:00:00.000Z');
  assert.deepEqual(await dbService.getUserWorkspaceIds('jane@example.com'), [workspaceId]);
  assert.equal(signup.phone, '(555) 123-4567');
  assert.equal(trials.getSignup('jane@example.com').workspaceId, workspaceId);
  assert.equal(trials.listSignups()[0].email, 'jane@example.com');

  const st = trials.status(ws, now + 86400000);
  assert.equal(st.state, 'trial');
  assert.equal(st.daysLeft, 6);
  assert.equal(trials.status(ws, now + 8 * 86400000).state, 'expired');
});

test('trial workspaces never fall back to the agency messaging keys, but do share scraper keys', async () => {
  const { form } = trials.readSignupForm({ ...goodForm, company: 'Env Test' });
  const { workspaceId } = await trials.createTrialWorkspace({ email: 'env@example.com', form });
  const env = await workspaceIntegrations.getResolvedIntegrationEnv(workspaceId);
  assert.equal(env.GHL_API_KEY, 'trial-disabled');
  assert.equal(env.APIFY_API_TOKEN, 'server-apify');
  assert.equal(ghlClient.isConfigured(env), false);

  await workspaceIntegrations.saveWorkspaceIntegrations(workspaceId, { ghlApiKey: 'their-key', ghlLocationId: 'their-loc' });
  const own = await workspaceIntegrations.getResolvedIntegrationEnv(workspaceId);
  assert.equal(own.GHL_API_KEY, 'their-key');

  await trials.adminUpdate(workspaceId, { action: 'activate', by: 'admin@adhello.ai' });
  await workspaceIntegrations.saveWorkspaceIntegrations(workspaceId, {});
  const active = await workspaceIntegrations.getResolvedIntegrationEnv(workspaceId);
  assert.equal(active.GHL_API_KEY, 'server-ghl-key');
});

test('daily caps per kind, calling blocked, unknown hosts free', () => {
  trials._resetForTests();
  const now = Date.now();
  const ws = { id: 'cap-ws', trial: { startedAt: new Date(now).toISOString(), endsAt: new Date(now + 86400000).toISOString() } };
  assert.equal(trials.classifyHost('api.apify.com'), 'paid');
  assert.equal(trials.classifyHost('openrouter.ai'), 'ai');
  assert.equal(trials.classifyHost('example.signalwire.com'), 'call');
  assert.equal(trials.classifyHost('nominatim.openstreetmap.org'), '');

  const check = trials.egressCheck(ws);
  assert.equal(check('api.apify.com').ok, true);
  assert.equal(check('serpapi.com').ok, true);
  const third = check('api.apify.com');
  assert.equal(third.ok, false);
  assert.equal(third.error.code, 'TRIAL_LIMIT');
  assert.equal(check('openrouter.ai').ok, true);
  assert.equal(check('openrouter.ai').ok, false);
  assert.equal(check('example.signalwire.com').ok, false);
  assert.equal(check('nominatim.openstreetmap.org').ok, true);
  assert.deepEqual(trials.usageFor('cap-ws'), { paid: 2, ai: 1 });

  const active = { ...ws, trial: { ...ws.trial, activatedAt: new Date().toISOString() } };
  assert.equal(trials.takeCall(active, 'paid'), true);
});

test('metered egress context refuses over-cap hosts but leaves sockets and other hosts alone', async () => {
  const server = await new Promise((resolve) => {
    const s = http.createServer((req, res) => res.end('ok'));
    s.listen(0, '127.0.0.1', () => resolve(s));
  });
  const url = `http://127.0.0.1:${server.address().port}/`;
  try {
    const ctx = { trial: true, check: (host) => (host === '127.0.0.1' ? { ok: true } : { ok: false, error: Object.assign(new Error('cap'), { code: 'TRIAL_LIMIT' }) }) };
    await guestEgress.run(ctx, async () => {
      assert.equal(await (await fetch(url)).text(), 'ok');
      await assert.rejects(fetch('https://api.apify.com/v2/acts'), (e) => e.code === 'TRIAL_LIMIT');
    });
  } finally {
    server.close();
  }
});

test('admin extend / end / limits and per-IP signup cap', async () => {
  const { form } = trials.readSignupForm({ ...goodForm, company: 'Admin Test' });
  const now = Date.parse('2026-10-07T12:00:00Z');
  const { workspaceId } = await trials.createTrialWorkspace({ email: 'admin-test@example.com', form }, now);

  let ws = await trials.adminUpdate(workspaceId, { action: 'end', by: 'a@adhello.ai' }, now);
  assert.equal(trials.status(ws, now).state, 'expired');
  ws = await trials.adminUpdate(workspaceId, { action: 'extend', days: 3, by: 'a@adhello.ai' }, now);
  assert.equal(trials.status(ws, now).daysLeft, 3);
  ws = await trials.adminUpdate(workspaceId, { action: 'limits', paidCallsPerDay: '50', aiCallsPerDay: '10' }, now);
  assert.deepEqual(trials.status(ws, now).limits, { paidCallsPerDay: 50, aiCallsPerDay: 10 });
  await assert.rejects(trials.adminUpdate('nope', { action: 'end' }), /not a trial/);

  await trials.grantAdminAccess(workspaceId, 'Boss@AdHello.ai');
  ws = await dbService.getWorkspace(workspaceId);
  assert.equal(ws.members['boss@adhello.ai'].role, 'admin');

  assert.equal(trials.takeIpSlot('203.0.113.9'), true);
  assert.equal(trials.takeIpSlot('203.0.113.9'), true);
  assert.equal(trials.takeIpSlot('203.0.113.9'), false);
  assert.equal(trials.takeIpSlot('203.0.113.10'), true);
});
