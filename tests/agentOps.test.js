const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-ops-'));
process.env.APP_DATA_DIR = tmpDir;

const dbService = require('../services/database');
const agentOps = require('../services/agentOps');
const { normalizeBoards } = require('../services/opportunityBoards');

describe('agentOps role bots', () => {
  before(async () => {
    const boards = normalizeBoards(null).boards;
    const pipeline = boards.pipelines[0];
    const stageNew = pipeline.stages[0];
    const stageProposal = pipeline.stages[Math.min(3, pipeline.stages.length - 1)];
    await dbService.saveWorkspace('ws_ops', {
      id: 'ws_ops',
      name: 'Ops Co',
      members: { 'owner@ops.test': { role: 'owner' } },
      opportunityBoards: boards,
    });
    await dbService.saveLead({
      title: 'Early Plumbing Co',
      company: 'Early Plumbing Co',
      phone: '5035550100',
      pipelineStage: 1,
      categoryName: 'Plumber',
      city: 'Vancouver',
      workspaceId: 'ws_ops',
      source: 'manual',
    });
    const bigKey = await dbService.saveLead({
      title: 'Big Deal HVAC',
      company: 'Big Deal HVAC',
      phone: '5035550188',
      email: 'ops@bigdeal.test',
      pipelineStage: 4,
      categoryName: 'HVAC contractor',
      city: 'Portland',
      opportunityValue: 12000,
      opportunityPipelineId: pipeline.id,
      opportunityStageId: stageProposal.id,
      workspaceId: 'ws_ops',
      source: 'manual',
    });
    const smallKey = await dbService.saveLead({
      title: 'Small Warm Lead',
      company: 'Small Warm Lead',
      phone: '5035550177',
      pipelineStage: 3,
      categoryName: 'Landscaping',
      city: 'Camas',
      opportunityValue: 1500,
      opportunityPipelineId: pipeline.id,
      opportunityStageId: stageNew.id,
      workspaceId: 'ws_ops',
      source: 'manual',
    });
    const stopKey = await dbService.saveLead({
      title: '1st Call Plumbing',
      company: '1st Call Plumbing',
      phone: '3605550199',
      pipelineStage: 4,
      categoryName: 'Plumber',
      city: 'Vancouver',
      tags: ['SMS STOP'],
      opportunityValue: 9000,
      opportunityPipelineId: pipeline.id,
      opportunityStageId: stageProposal.id,
      workspaceId: 'ws_ops',
      source: 'manual',
    });
    await dbService.saveLead({
      title: 'KO Sisters Seoul Food',
      company: 'KO Sisters Seoul Food',
      phone: '5035550111',
      pipelineStage: 1,
      categoryName: 'Korean restaurant',
      city: 'Portland',
      workspaceId: 'ws_ops',
      source: 'manual',
    });
    // Ensure opportunity fields persist (saveLead may strip unknowns on create).
    await dbService.updateLead(
      bigKey,
      {
        opportunityValue: 12000,
        opportunityPipelineId: pipeline.id,
        opportunityStageId: stageProposal.id,
        categoryName: 'HVAC contractor',
        city: 'Portland',
      },
      'ws_ops',
    );
    await dbService.updateLead(
      smallKey,
      {
        opportunityValue: 1500,
        opportunityPipelineId: pipeline.id,
        opportunityStageId: stageNew.id,
        categoryName: 'Landscaping',
        city: 'Camas',
      },
      'ws_ops',
    );
    await dbService.updateLead(
      stopKey,
      {
        opportunityValue: 9000,
        opportunityPipelineId: pipeline.id,
        opportunityStageId: stageProposal.id,
        tags: ['SMS STOP'],
        categoryName: 'Plumber',
        city: 'Vancouver',
      },
      'ws_ops',
    );
  });

  after(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it('lists Prospect + Opportunity SDRs with default jobs', () => {
    const roles = agentOps.listRoles();
    assert.equal(roles.length, 4);
    const prospect = roles.find((r) => r.id === 'prospect');
    const opportunity = roles.find((r) => r.id === 'opportunity');
    assert.equal(prospect.title, 'Prospect SDR');
    assert.equal(opportunity.title, 'Opportunity SDR');
    assert.equal(agentOps.roleForJob('prospect.prepare').id, 'prospect');
    assert.equal(agentOps.roleForJob('opportunity.scan_board').id, 'opportunity');
    assert.equal(agentOps.roleForJob('sdr.prepare_focus').id, 'prospect');
  });

  it('Prospect SDR prepare builds a prospect insight', async () => {
    const out = await agentOps.enqueueAndRun('ws_ops', 'prospect.prepare', {
      onBehalfOf: 'owner@ops.test',
      force: true,
    });
    assert.equal(out.ok, true);
    assert.ok(out.result.counts.queue >= 1);
    assert.ok(Array.isArray(out.result.items));
    assert.ok(out.result.items.length >= 1);
    assert.equal(out.result.items[0].kind, 'lead');
    assert.match(out.result.items[0].href || '', /\/focus\?lead=/);
    // Restaurant must not be the top prospect.
    assert.doesNotMatch(out.result.summary || '', /KO Sisters/i);
    const dash = agentOps.dashboardForWorkspace('ws_ops');
    const sdr = dash.roles.find((r) => r.id === 'prospect');
    assert.ok(sdr.insight);
    assert.match(sdr.insight.body, /prospect|Portland|Vancouver/i);
    assert.equal(sdr.insight.href, '/focus?from=today');
    assert.equal(sdr.title, 'Prospect SDR');
    assert.ok(sdr.items.length >= 1);
  });

  it('Opportunity SDR ranks open board deals', async () => {
    const out = await agentOps.enqueueAndRun('ws_ops', 'opportunity.scan_board', {
      onBehalfOf: 'owner@ops.test',
      force: true,
    });
    assert.equal(out.ok, true);
    assert.ok(out.result.counts.open >= 1);
    assert.ok(out.result.top.length >= 1);
    assert.ok(Array.isArray(out.result.items));
    assert.ok(out.result.items.length >= 1);
    assert.match(out.result.items[0].href || '', /\/focus\?lead=/);
    // SMS STOP lead must not be recommended.
    assert.ok(!out.result.top.some((t) => /1st Call Plumbing/i.test(t.title || '')));
    const insight = agentOps.listInsights('ws_ops').find((i) => i.roleId === 'opportunity');
    assert.ok(insight);
    assert.equal(insight.severity, 'action');
    assert.equal(insight.href, '/focus?from=today');
    assert.match(insight.body, /open|focus next/i);
    const dash = agentOps.dashboardForWorkspace('ws_ops');
    const opp = dash.roles.find((r) => r.id === 'opportunity');
    assert.ok(opp.items.length >= 1);
    // Highest value should surface first when both are on the board
    if (out.result.top.length >= 2) {
      assert.ok(out.result.top[0].value >= out.result.top[1].value);
    }

    // Immediate re-scan without force should be treated as fresh (no duplicate activity).
    const again = await agentOps.enqueueAndRun('ws_ops', 'opportunity.scan_board', {
      onBehalfOf: 'owner@ops.test',
      triggeredBy: 'scheduler',
    });
    assert.equal(again.ok, true);
    assert.equal(again.result.skipped, true);
    assert.equal(again.result.reason, 'fresh');
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
    agentOps.saveSettings('ws_ops', { roles: { prospect: { enabled: false } } });
    return agentOps.enqueueAndRun('ws_ops', 'prospect.prepare').then((out) => {
      assert.equal(out.ok, false);
      assert.match(out.error, /disabled/i);
      agentOps.saveSettings('ws_ops', { roles: { prospect: { enabled: true } } });
    });
  });

  it('tickWorkspace respects cooldown unless forced', async () => {
    // Seed auto cadence, then a non-forced tick should cool down.
    await agentOps.tickWorkspace('ws_ops', { force: false });
    const cool = await agentOps.tickWorkspace('ws_ops', { force: false });
    assert.equal(cool.ok, true);
    assert.ok(cool.results.every((r) => r.skipped === true || r.ok === true));
    const skippedCool = cool.results.filter((r) => r.reason === 'cooldown');
    assert.ok(skippedCool.length >= 1);
    const forced = await agentOps.tickWorkspace('ws_ops', { force: true });
    assert.ok(forced.results.some((r) => r.ok === true || r.skipped === true));
  });

  it('manual Run does not delay the next auto-tick', async () => {
    const store = require('../services/agentOps/store');
    // Clear auto cadence for prospect (merge overwrites the key).
    store.saveSettings('ws_ops', { lastAutoTickByRole: { prospect: '' } });
    const manual = await agentOps.enqueueAndRun('ws_ops', 'prospect.prepare', {
      triggeredBy: 'user',
      onBehalfOf: 'owner@ops.test',
    });
    assert.equal(manual.ok, true);
    const settings = store.getSettings('ws_ops');
    assert.ok(settings.lastTickByRole.prospect);
    assert.ok(!settings.lastAutoTickByRole.prospect);
    const auto = await agentOps.tickWorkspace('ws_ops', { force: false });
    const prospect = auto.results.find((r) => r.roleId === 'prospect');
    assert.ok(prospect);
    assert.notEqual(prospect.reason, 'cooldown');
    assert.equal(prospect.ok, true);
  });

  it('dashboard marks a role running while its job is in progress', async () => {
    const store = require('../services/agentOps/store');
    const job = store.createJob('ws_ops', {
      type: 'prospect.prepare',
      roleId: 'prospect',
      triggeredBy: 'test',
    });
    store.updateJob('ws_ops', job.id, { status: 'running', startedAt: store.nowIso() });
    const dash = agentOps.dashboardForWorkspace('ws_ops');
    const prospect = dash.roles.find((r) => r.id === 'prospect');
    assert.equal(prospect.running, true);
    assert.ok(Array.isArray(dash.runningRoles));
    assert.ok(dash.runningRoles.some((r) => r.id === 'prospect'));
    const blocked = await agentOps.enqueueAndRun('ws_ops', 'prospect.prepare', {
      triggeredBy: 'user',
    });
    assert.equal(blocked.ok, false);
    assert.match(blocked.error || '', /already running/i);
    store.updateJob('ws_ops', job.id, { status: 'done', finishedAt: store.nowIso() });
    const after = agentOps.dashboardForWorkspace('ws_ops');
    assert.equal(after.roles.find((r) => r.id === 'prospect').running, false);
  });
});
