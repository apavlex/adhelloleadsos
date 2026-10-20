const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-ops-pause-ui-'));
process.env.APP_DATA_DIR = tmpDir;

const agentOps = require('../services/agentOps');

const ROOT = path.join(__dirname, '..');

describe('agent ops pause UI', () => {
  it('today cards expose Pause and Pause all controls', () => {
    const ejs = fs.readFileSync(path.join(ROOT, 'views/today.ejs'), 'utf8');
    assert.match(ejs, /agent-ops-pause/);
    assert.match(ejs, /id="agentOpsPauseAll"/);
    assert.match(ejs, /agent-ops-paused/);
    assert.match(ejs, /\/agent-ops\/settings/);
    assert.match(ejs, /autoTick/);
  });

  it('settings save toggles autoTick and dashboard reflects pause', () => {
    const wid = 'ws_pause_ui';
    agentOps.saveSettings(wid, { enabled: true, roles: { prospect: { autoTick: true } } });
    let dash = agentOps.dashboardForWorkspace(wid);
    assert.equal(dash.roles.find((r) => r.id === 'prospect').autoTick, true);

    agentOps.saveSettings(wid, { roles: { prospect: { autoTick: false } } });
    dash = agentOps.dashboardForWorkspace(wid);
    const prospect = dash.roles.find((r) => r.id === 'prospect');
    assert.equal(prospect.autoTick, false);
    assert.equal(prospect.enabled, true);

    agentOps.saveSettings(wid, { enabled: false });
    dash = agentOps.dashboardForWorkspace(wid);
    assert.equal(dash.enabled, false);
  });

  it('settings route returns dashboard after patch', () => {
    const routeSrc = fs.readFileSync(path.join(ROOT, 'routes/agentOps.js'), 'utf8');
    assert.match(routeSrc, /dashboard:\s*agentOps\.dashboardForWorkspace/);
  });
});
