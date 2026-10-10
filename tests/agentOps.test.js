const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-ops-'));
process.env.APP_DATA_DIR = tmpDir;

const dbService = require('../services/database');
const agentOps = require('../services/agentOps');

describe('agentOps role bots', () => {
  before(async () => {
    await dbService.saveWorkspace('ws_ops', {
      id: 'ws_ops',
      name: 'Ops Co',
      members: { 'owner@ops.test': { role: 'owner' } },
    });
    await dbService.saveLead({
      title: 'Early Plumbing Co',
      company: 'Early Plumbing Co',
      phone: '5035550100',
      pipelineStage: 1,
      workspaceId: 'ws_ops',
      source: 'test',
    });
    await dbService.saveLead({
      title: 'Happy Customer LLC',
      company: 'Happy Customer LLC',
      phone: '5035550199',
      email: 'happy@customer.test',
      pipelineStage: 7,
      status: 'Won',
      workspaceId: 'ws_ops',
      source: 'test',
    });
  });

  after(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it('lists four role bots with default jobs', () => {
    const roles = agentOps.listRoles();
    assert.equal(roles.length, 4);
    assert.ok(roles.every((r) => r.defaultJob && r.id));
    assert.equal(agentOps.roleForJob('sdr.prepare_focus').id, 'sdr');
  });

  it('SDR prepare_focus builds a Focus insight', async () => {
    const out = await agentOps.enqueueAndRun('ws_ops', 'sdr.prepare_focus', {
      onBehalfOf: 'owner@ops.test',
    });
    assert.equal(out.ok, true);
    assert.ok(out.result.counts.queue >= 1);
    const dash = agentOps.dashboardForWorkspace('ws_ops');
    const sdr = dash.roles.find((r) => r.id === 'sdr');
    assert.ok(sdr.insight);
    assert.match(sdr.insight.body, /Focus|early-stage/i);
  });

  it('Review scan finds won-stage customers', async () => {
    const out = await agentOps.enqueueAndRun('ws_ops', 'review.scan', {
      onBehalfOf: 'owner@ops.test',
    });
    assert.equal(out.ok, true);
    assert.ok(out.result.counts.candidates >= 1);
    const insight = agentOps.listInsights('ws_ops').find((i) => i.roleId === 'review');
    assert.ok(insight);
    assert.equal(insight.severity, 'action');
  });

  it('Dispatcher and Ops jobs write insights', async () => {
    const disp = await agentOps.enqueueAndRun('ws_ops', 'dispatcher.scan_pool', {
      onBehalfOf: 'owner@ops.test',
    });
    assert.equal(disp.ok, true);
    const ops = await agentOps.enqueueAndRun('ws_ops', 'ops.health', {
      onBehalfOf: 'owner@ops.test',
    });
    assert.equal(ops.ok, true);
    assert.ok(ops.result.summary);
    const runs = agentOps.listRecentRuns('ws_ops', 10);
    assert.ok(runs.length >= 2);
    assert.ok(runs.some((r) => r.type === 'ops.health' && r.status === 'ok'));
  });

  it('settings can disable a role and block enqueue', () => {
    agentOps.saveSettings('ws_ops', { roles: { sdr: { enabled: false } } });
    return agentOps.enqueueAndRun('ws_ops', 'sdr.prepare_focus').then((out) => {
      assert.equal(out.ok, false);
      assert.match(out.error, /disabled/i);
      agentOps.saveSettings('ws_ops', { roles: { sdr: { enabled: true } } });
    });
  });

  it('tickWorkspace respects cooldown unless forced', async () => {
    await agentOps.tickWorkspace('ws_ops', { force: true });
    const cool = await agentOps.tickWorkspace('ws_ops', { force: false });
    assert.equal(cool.ok, true);
    assert.ok(cool.results.every((r) => r.skipped === true || r.ok === true));
    const skippedCool = cool.results.filter((r) => r.reason === 'cooldown');
    assert.ok(skippedCool.length >= 1);
  });
});
