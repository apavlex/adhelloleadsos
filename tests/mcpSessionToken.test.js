const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  createMcpSessionToken,
  verifyMcpSessionToken,
} = require('../services/mcp/mcpSessionToken');
const { executeCrmTool, TOOL_NAMES } = require('../services/mcp/mcpToolExecutor');

describe('mcpSessionToken', () => {
  it('creates and verifies a session token', () => {
    const token = createMcpSessionToken({
      workspaceId: 'ws-test',
      userEmail: 'alex@example.com',
      ttlSec: 300,
    });
    assert.ok(token);
    const auth = verifyMcpSessionToken(token);
    assert.equal(auth.workspaceId, 'ws-test');
    assert.equal(auth.userEmail, 'alex@example.com');
    assert.equal(auth.authMethod, 'session_token');
  });

  it('rejects tampered tokens', () => {
    const token = createMcpSessionToken({
      workspaceId: 'ws-test',
      userEmail: 'alex@example.com',
    });
    const bad = token.slice(0, -2) + 'xx';
    assert.equal(verifyMcpSessionToken(bad), null);
  });
});

describe('mcpToolExecutor', () => {
  it('exports all required CRM tools', () => {
    for (const name of [
      'list_folders',
      'get_folder',
      'count_leads',
      'list_leads',
      'get_lead',
      'update_lead',
      'bulk_update_leads',
      'search_leads',
    ]) {
      assert.ok(TOOL_NAMES.includes(name));
    }
  });

  it('returns error payload for unknown tool', async () => {
    const out = await executeCrmTool({ workspaceId: 'x', userEmail: 'a@b.com' }, 'nope', {});
    assert.equal(out.success, false);
    assert.match(out.error, /Unknown tool/);
  });
});
