const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-agent-ops-'));
process.env.APP_DATA_DIR = tmpDir;

const dbService = require('../services/database');
const { TOOL_NAMES, executeCrmTool, getOpenAiFunctionTools } = require('../services/mcp/mcpToolExecutor');
const { getOpenAiToolManifest } = require('../services/mcp/mcpServerFactory');
const {
  AGENT_OPS_TOOL_NAMES,
  resolveRole,
  listOpsAgents,
  updateOpsAgent,
  runOpsAgent,
} = require('../services/mcp/mcpAgentOps');
const agentOps = require('../services/agentOps');

const WID = 'ws_mcp_ops';
const OWNER = 'owner@mcp-ops.test';

describe('Ops agents MCP tools', () => {
  before(async () => {
    await dbService.saveWorkspace(WID, {
      id: WID,
      name: 'MCP Ops Co',
      members: { [OWNER]: { role: 'owner' } },
    });
    await dbService.saveLead({
      title: 'PDX Plumbing Pros',
      company: 'PDX Plumbing Pros',
      phone: '5035550100',
      pipelineStage: 1,
      categoryName: 'Plumber',
      city: 'Portland',
      workspaceId: WID,
      source: 'manual',
    });
  });

  after(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {
      /* ignore */
    }
  });

  it('registers Ops agent tools on the CRM MCP surface', () => {
    for (const name of AGENT_OPS_TOOL_NAMES) {
      assert.ok(TOOL_NAMES.includes(name), `missing ${name}`);
    }
    const fnNames = getOpenAiFunctionTools().map((t) => t.function.name);
    const manifestNames = getOpenAiToolManifest().tools.map((t) => t.name);
    for (const name of AGENT_OPS_TOOL_NAMES) {
      assert.ok(fnNames.includes(name), `function tools missing ${name}`);
      assert.ok(manifestNames.includes(name), `manifest missing ${name}`);
    }
  });

  it('resolves agent aliases', () => {
    assert.equal(resolveRole('Prospect SDR').id, 'prospect');
    assert.equal(resolveRole('opportunity').id, 'opportunity');
    assert.equal(resolveRole('Review bot').id, 'opportunity');
    assert.equal(resolveRole('ops bot').id, 'ops');
  });

  it('list_ops_agents returns the four role bots', async () => {
    const out = await listOpsAgents({ workspaceId: WID, userEmail: OWNER });
    assert.equal(out.count, 4);
    assert.equal(out.ops_enabled, true);
    const ids = out.agents.map((a) => a.id).sort();
    assert.deepEqual(ids, ['dispatcher', 'opportunity', 'ops', 'prospect']);
  });

  it('update_ops_agent can disable auto-tick for Prospect SDR', async () => {
    const out = await updateOpsAgent(
      { workspaceId: WID, userEmail: OWNER },
      { agent: 'prospect', auto_tick: false },
    );
    assert.equal(out.ops_enabled, true);
    const prospect = out.agents.find((a) => a.id === 'prospect');
    assert.equal(prospect.auto_tick, false);
    const settings = agentOps.getSettings(WID);
    assert.equal(settings.roles.prospect.autoTick, false);
    // restore
    await updateOpsAgent({ workspaceId: WID, userEmail: OWNER }, { agent: 'prospect', auto_tick: true });
  });

  it('run_ops_agent runs Prospect SDR and surfaces a summary', async () => {
    const out = await runOpsAgent(
      { workspaceId: WID, userEmail: OWNER },
      { agent: 'prospect', force: true },
    );
    assert.ok(out.summary);
    assert.equal(out.agent.id, 'prospect');
    assert.ok(out.job && out.job.id);
  });

  it('executeCrmTool routes list_ops_agents and blocks viewers from updates', async () => {
    const listed = await executeCrmTool(
      { workspaceId: WID, userEmail: OWNER },
      'list_ops_agents',
      {},
    );
    assert.equal(listed.success, true);
    assert.equal(listed.count, 4);

    await dbService.saveWorkspace(WID, {
      ...(await dbService.getWorkspace(WID)),
      members: {
        [OWNER]: { role: 'owner' },
        'viewer@mcp-ops.test': { role: 'viewer' },
      },
    });
    const blocked = await executeCrmTool(
      { workspaceId: WID, userEmail: 'viewer@mcp-ops.test' },
      'update_ops_agent',
      { agent: 'ops', enabled: false },
    );
    assert.equal(blocked.success, false);
    assert.match(blocked.error || '', /owners and admins/i);
  });
});
