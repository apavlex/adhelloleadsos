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

function startApp({ canManageWorkspace = true, isAdmin = false } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.workspaceId = 'ws_add_opp';
    req.canManageWorkspace = canManageWorkspace;
    req.user = { emails: [{ value: isAdmin ? 'admin@adhello.io' : 'owner@example.com' }] };
    next();
  });
  app.use('/appointments', appointmentsRoutes);
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` }));
  });
}

test('push-targets lists contractor packages for workspace managers', async () => {
  await appointmentPackages.createPackage('ws_add_opp', {
    businessName: 'Camas Electric',
    trade: 'Electrical',
    contactEmail: 'sam@electric.example',
  });
  await appointmentPackages.createPackage('ws_add_opp', {
    businessName: 'Handyman Pro',
    trade: 'Handyman',
  });

  const { server, base } = await startApp({ canManageWorkspace: true });
  try {
    const res = await fetch(`${base}/appointments/appointment-packages/push-targets`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok(body.packages.length >= 2);
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

test('Add Opportunity modal and shell include push-to-teammates UI', () => {
  const nav = fs.readFileSync(path.join(__dirname, '..', 'views/partials/navbar.ejs'), 'utf8');
  const js = fs.readFileSync(path.join(__dirname, '..', 'public/js/navbar-shell.js'), 'utf8');
  assert.match(nav, /Also push to teammates/);
  assert.match(nav, /manualLeadPushToggle/);
  assert.match(nav, /manualLeadPushList/);
  assert.match(js, /appointment-packages\/push-targets/);
  assert.match(js, /pushPackageIds/);
  assert.match(js, /deliver-lead-bulk/);
});
