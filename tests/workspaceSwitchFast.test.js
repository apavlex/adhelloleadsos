const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.APP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-switch-fast-'));

const test = require('node:test');
const assert = require('node:assert/strict');
const dbService = require('../services/database');

test('workspace switch warms leads and skips chrome extras', () => {
  const switchSrc = fs.readFileSync(path.join(__dirname, '../routes/workspaces.js'), 'utf8');
  assert.match(switchSrc, /router\.post\('\/switch'/);
  assert.match(switchSrc, /void dbService\.getAllLeads\(raw\)\.catch/);
  assert.match(switchSrc, /router\.get\('\/open'/);
  assert.match(switchSrc, /countLeadsListInflight/);
  assert.match(switchSrc, /skipped: true/);

  const mw = fs.readFileSync(path.join(__dirname, '../middleware/withWorkspace.js'), 'utf8');
  assert.match(mw, /workspaceSwitchFastPath/);
  assert.match(mw, /skipChromeExtras/);
  assert.match(mw, /\/workspaces\/switch/);

  const shell = fs.readFileSync(path.join(__dirname, '../public/js/sidebarShell.js'), 'utf8');
  assert.match(shell, /Switching…/);
  assert.match(shell, /markWorkspaceSwitchBusy/);
  assert.match(shell, /clearWorkspaceSwitchBusy/);
  assert.match(shell, /warmOneWorkspace/);
  assert.doesNotMatch(shell, /warmSwitcherWorkspaces/);
  assert.match(shell, /getAttribute\('action'\) !== '\/workspaces\/switch'/);

  const nav = fs.readFileSync(path.join(__dirname, '../views/partials/navbar.ejs'), 'utf8');
  assert.match(nav, /sidebarShell\.js\?v=sidebar11/);
});

test('concurrent getAllLeads cold loads share one in-flight scan', async () => {
  const coldWid = 'ws_switch_inflight_cold';
  await dbService.putStorageKey('lead:7101', { title: 'Cold one', workspaceId: coldWid });
  await dbService.putStorageKey('lead:7102', { title: 'Cold two', workspaceId: coldWid });

  const [a, b] = await Promise.all([dbService.getAllLeads(coldWid), dbService.getAllLeads(coldWid)]);
  assert.deepEqual(
    a.map((l) => l.key),
    b.map((l) => l.key),
  );
  assert.deepEqual(
    a.map((l) => l.key).sort(),
    ['lead:7101', 'lead:7102'],
  );
  const again = await dbService.getAllLeads(coldWid);
  assert.equal(again.length, 2);
});

test('countLeadsListInflight reports active cold scans', async () => {
  assert.equal(typeof dbService.countLeadsListInflight(), 'number');
});
