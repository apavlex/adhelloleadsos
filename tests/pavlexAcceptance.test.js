const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { CRM_COMMAND_HINTS } = require('../services/pavlex/pavlexConstants');
const { TOOL_NAMES, executeCrmTool } = require('../services/mcp/tools');
const { connectMCP, invokeMcpTool } = require('../services/mcp/client');
const { resolvePavlexAuth } = require('../services/pavlex/pavlexAuth');

describe('Pavlex acceptance — CRM tool mapping', () => {
  it('Test 1: list_folders is available', () => {
    assert.ok(TOOL_NAMES.includes('list_folders'));
    assert.match(CRM_COMMAND_HINTS, /list_folders/);
  });

  it('Test 2: count_leads supports folder_name Landscaping', () => {
    assert.ok(TOOL_NAMES.includes('count_leads'));
    assert.match(CRM_COMMAND_HINTS, /count_leads/);
    assert.match(CRM_COMMAND_HINTS, /Landscaping|folder_name/i);
  });

  it('Test 3: list_leads supports limit', () => {
    assert.ok(TOOL_NAMES.includes('list_leads'));
    assert.match(CRM_COMMAND_HINTS, /list_leads/);
    assert.match(CRM_COMMAND_HINTS, /limit/i);
  });

  it('Test 4: search_leads is available', () => {
    assert.ok(TOOL_NAMES.includes('search_leads'));
    assert.match(CRM_COMMAND_HINTS, /search_leads/);
  });

  it('Test 5: update_lead is available', () => {
    assert.ok(TOOL_NAMES.includes('update_lead'));
    assert.match(CRM_COMMAND_HINTS, /update_lead/);
  });
});

describe('MCP client', () => {
  it('connectMCP falls back to inline when no server URL', async () => {
    const conn = await connectMCP({
      userId: 'alex@example.com',
      workspaceId: 'ws-1',
      userEmail: 'alex@example.com',
    });
    assert.equal(conn.connected, true);
    assert.equal(conn.transport, 'inline');
    assert.ok(conn.tools.includes('list_folders'));
  });

  it('invokeMcpTool returns structured result with latency', async () => {
    const out = await invokeMcpTool(
      { workspaceId: 'missing-ws', userEmail: 'a@b.com' },
      'list_folders',
      {},
    );
    assert.equal(out.tool, 'list_folders');
    assert.ok(typeof out.latencyMs === 'number');
    assert.ok(out.result);
  });

  it('executeCrmTool rejects unknown tools', async () => {
    const out = await executeCrmTool({ workspaceId: 'x', userEmail: 'a@b.com' }, 'bad_tool', {});
    assert.equal(out.success, false);
  });
});

describe('Pavlex auth', () => {
  it('resolvePavlexAuth requires email and workspace', () => {
    const auth = resolvePavlexAuth({
      workspaceId: 'ws-1',
      user: { emails: [{ value: 'alex@adhello.ai' }] },
      canManageWorkspace: true,
    });
    assert.equal(auth.email, 'alex@adhello.ai');
    assert.equal(auth.workspaceId, 'ws-1');
    assert.equal(auth.authenticated, true);
    assert.equal(auth.permissions.canReadCrm, true);
  });
});

describe('Gateway routes', () => {
  it('loads pavlex and debug routes', () => {
    assert.ok(require('../routes/pavlex'));
    assert.ok(require('../routes/debug'));
  });
});
