const fs = require('fs');
const os = require('os');
const path = require('path');
const { mock } = require('node:test');

process.env.APP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'add-opp-push-'));

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const appointmentPackages = require('../services/appointmentPackages');
const appointmentsRoutes = require('../routes/appointments');
const store = require('../services/networkStore');
const workspaceTeammatePush = require('../services/workspaceTeammatePush');
const ownerReferralApp = require('../services/ownerReferralApp');
const networkReferrals = require('../services/networkReferrals');
const notify = require('../services/networkNotify');

function startApp({
  canManageWorkspace = true,
  isAdmin = false,
  workspace = null,
  workspaceId = 'ws_add_opp',
} = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.workspaceId = workspaceId;
    req.workspace = workspace || {
      id: workspaceId,
      name: 'Test Agency',
      members: {
        'owner@example.com': { role: 'owner' },
        'isabellepavlenko@gmail.com': { role: 'sdr', name: 'Isabelle' },
      },
    };
    req.canManageWorkspace = canManageWorkspace;
    req.user = { emails: [{ value: isAdmin ? 'admin@adhello.io' : 'owner@example.com' }] };
    next();
  });
  app.use('/appointments', appointmentsRoutes);
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` }));
  });
}

test('push-targets lists workspace teammates without appointment packages', async () => {
  const { server, base } = await startApp({ canManageWorkspace: true });
  try {
    const res = await fetch(`${base}/appointments/appointment-packages/push-targets`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok(Array.isArray(body.teammates));
    assert.ok(body.teammates.some((t) => t.email === 'isabellepavlenko@gmail.com'));
    assert.ok(body.teammates.every((t) => t.role !== 'owner'));
    assert.equal(body.canPush, true);
  } finally {
    server.close();
  }
});

test('push-targets lists contractor packages for workspace managers', async () => {
  await appointmentPackages.createPackage('ws_add_opp_pkg', {
    businessName: 'Camas Electric',
    trade: 'Electrical',
    contactEmail: 'sam@electric.example',
  });

  const { server, base } = await startApp({
    canManageWorkspace: true,
    workspaceId: 'ws_add_opp_pkg',
    workspace: {
      id: 'ws_add_opp_pkg',
      name: 'Pkg Agency',
      members: { 'owner@example.com': { role: 'owner' } },
    },
  });
  try {
    const res = await fetch(`${base}/appointments/appointment-packages/push-targets`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok(body.packages.some((p) => p.businessName === 'Camas Electric'));
  } finally {
    server.close();
  }
});

test('push-targets rejects users who cannot manage the workspace', async () => {
  const { server, base } = await startApp({ canManageWorkspace: false, isAdmin: false });
  try {
    const res = await fetch(`${base}/appointments/appointment-packages/push-targets`);
    assert.equal(res.status, 403);
  } finally {
    server.close();
  }
});

test('deliver-teammate-bulk sends a free referral to a workspace SDR', async (t) => {
  t.after(() => mock.restoreAll());
  mock.method(notify, 'notifyReferralRecipient', async () => ({ ok: true, channel: 'sms' }));
  mock.method(notify, 'notifyReferralPool', async () => 0);
  mock.method(notify, 'syncPartnerCounter', async () => {});
  mock.method(notify, 'createOperatorTask', async () => null);

  const workspaceId = 'ws_add_opp_tm';
  const workspace = {
    id: workspaceId,
    name: 'Teammate Agency',
    members: {
      'owner@example.com': { role: 'owner' },
      'isabellepavlenko@gmail.com': { role: 'sdr', name: 'Isabelle' },
    },
  };
  const staffId = ownerReferralApp.staffMemberIdForEmail('isabellepavlenko@gmail.com');

  const { server, base } = await startApp({
    canManageWorkspace: true,
    workspaceId,
    workspace,
  });

  try {
    const res = await fetch(`${base}/appointments/appointment-packages/deliver-teammate-bulk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        memberIds: [staffId],
        name: 'Ramos Painting',
        phone: '3605550199',
        email: 'ramos@example.com',
        preview: 'Met at Chamber event',
      }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.count, 1);
    assert.equal(body.kind, 'teammate');

    const network = await store.getOrCreateNetworkForWorkspace(workspaceId, { name: 'Teammate Agency' });
    const referrals = await store.listReferrals(network.id);
    assert.ok(referrals.some((r) => r.toMemberId === staffId && r.homeowner && r.homeowner.name === 'Ramos Painting'));
    const member = await store.getMember(network.id, staffId);
    assert.ok(member);
    assert.equal(member.workspaceStaff, true);
    assert.equal(member.email, 'isabellepavlenko@gmail.com');
  } finally {
    server.close();
  }
});

test('deliver-lead-bulk accepts multi packageIds from workspace manager', async (t) => {
  t.after(() => mock.restoreAll());
  const pkgA = await appointmentPackages.createPackage('ws_add_opp_bulk', {
    businessName: 'Alpha HVAC',
    trade: 'HVAC',
  });
  const pkgB = await appointmentPackages.createPackage('ws_add_opp_bulk', {
    businessName: 'Beta Plumbing',
    trade: 'Plumbing',
  });

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.workspaceId = 'ws_add_opp_bulk';
    req.workspace = { id: 'ws_add_opp_bulk', name: 'Bulk', members: { 'owner@example.com': { role: 'owner' } } };
    req.canManageWorkspace = true;
    req.user = { emails: [{ value: 'owner@example.com' }] };
    next();
  });
  app.use('/appointments', appointmentsRoutes);
  const { server, base } = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve({ server: s, base: `http://127.0.0.1:${s.address().port}` }));
  });

  try {
    const res = await fetch(`${base}/appointments/appointment-packages/deliver-lead-bulk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        packageIds: [pkgA.id, pkgB.id],
        name: 'Ramos Painting',
        phone: '3605550199',
        email: 'ramos@example.com',
        preview: 'Met at Chamber event',
        formName: 'Added from workspace',
        source: 'agency',
      }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.count, 2);

    const a = await appointmentPackages.getPackage('ws_add_opp_bulk', pkgA.id);
    const b = await appointmentPackages.getPackage('ws_add_opp_bulk', pkgB.id);
    assert.ok((a.formLeads || []).some((f) => f.name === 'Ramos Painting' && f.source === 'agency'));
    assert.ok((b.formLeads || []).some((f) => f.name === 'Ramos Painting'));
  } finally {
    server.close();
  }
});

test('listTeammateTargets skips owners and the actor', () => {
  const list = workspaceTeammatePush.listTeammateTargets(
    {
      members: {
        'alex@adhello.io': { role: 'owner' },
        'alex@adhello.ai': { role: 'owner' },
        'isabellepavlenko@gmail.com': { role: 'sdr', name: 'Isabelle' },
        'viewer@example.com': { role: 'viewer' },
      },
    },
    'alex@adhello.io',
  );
  assert.deepEqual(
    list.map((t) => t.email).sort(),
    ['isabellepavlenko@gmail.com', 'viewer@example.com'],
  );
});

test('Add Opportunity modal and shell include teammate push UI', () => {
  const nav = fs.readFileSync(path.join(__dirname, '..', 'views/partials/navbar.ejs'), 'utf8');
  const js = fs.readFileSync(path.join(__dirname, '..', 'public/js/navbar-shell.js'), 'utf8');
  assert.match(nav, /Send to teammates/);
  assert.match(nav, /Team &amp; assign|Team & assign/);
  assert.match(nav, /manualLeadPushWrap/);
  assert.match(js, /appointment-packages\/push-targets/);
  assert.match(js, /pushMemberIds/);
  assert.match(js, /pushPackageIds/);
  assert.match(js, /deliver-teammate-bulk/);
  assert.match(js, /deliver-lead-bulk/);
  assert.match(js, /Workspace team \(free referral\)/);
  assert.match(js, /Save & send to/);
});
