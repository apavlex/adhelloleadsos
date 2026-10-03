const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.APP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-agent-tokens-'));
process.env.BASE_URL = 'https://leads.adhello.io';

const test = require('node:test');
const assert = require('node:assert/strict');
const dbService = require('../services/database');
const {
  createAgentMcpToken,
  listAgentMcpTokens,
  revokeAgentMcpToken,
  validateMcpBearerToken,
  mcpAuthContext,
  AGENT_TOKEN_PREFIX,
} = require('../services/mcp/mcpAuth');

const OWNER = 'owner@example.com';
const SDR = 'sdr@example.com';
const WID = 'ws_agent_tokens';

function fakeReq(headers) {
  const lower = Object.fromEntries(Object.entries({ host: 'leads.adhello.io', ...headers }).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    headers: lower,
    protocol: 'https',
    path: '/',
    get: (name) => lower[String(name).toLowerCase()],
  };
}

function runAuth(headers) {
  return new Promise((resolve, reject) => {
    const req = fakeReq(headers);
    const res = {
      statusCode: 200,
      set() { return this; },
      status(code) { this.statusCode = code; return this; },
      json(body) { resolve({ req, status: this.statusCode, body }); return this; },
    };
    mcpAuthContext(req, res, (err) => (err ? reject(err) : resolve({ req, status: 200 })));
  });
}

test.before(async () => {
  await dbService.saveWorkspace(WID, {
    id: WID,
    name: 'Agent tokens WS',
    ownerUserId: OWNER,
    members: { [OWNER]: { role: 'owner' }, [SDR]: { role: 'sdr' } },
  });
});

test('agent token authenticates as its creator and is attributed to the agent name', async () => {
  const issued = await createAgentMcpToken(WID, { label: 'Muse', createdBy: OWNER });
  assert.ok(issued.token.startsWith(AGENT_TOKEN_PREFIX));
  assert.equal(issued.hint, issued.token.slice(-4));

  const auth = await validateMcpBearerToken(issued.token);
  assert.equal(auth.workspaceId, WID);
  assert.equal(auth.authMethod, 'agent_token');
  assert.equal(auth.userEmail, OWNER);
  assert.equal(auth.clientName, 'Muse');

  const ws = await dbService.getWorkspace(WID);
  assert.ok(!JSON.stringify(ws.mcpAccessTokens).includes(issued.token), 'raw token must not be stored');

  const viaHeader = await runAuth({ authorization: `Bearer ${issued.token}` });
  assert.equal(viaHeader.status, 200);
  assert.equal(viaHeader.req.mcpClientName, 'Muse');
  assert.equal(viaHeader.req.workspaceId, WID);
});

test('agents that can only set X-API-Key still get in', async () => {
  const issued = await createAgentMcpToken(WID, { label: 'Grok', createdBy: OWNER });
  const { status, req } = await runAuth({ 'x-api-key': issued.token });
  assert.equal(status, 200);
  assert.equal(req.mcpClientName, 'Grok');
});

test('pasting the workspace ID explains it is not a token and points to AI Connector', async () => {
  const { status, body } = await runAuth({ authorization: 'Bearer 3f2b8c1e-9a4d-4e7b-8c2a-1d5e6f7a8b9c' });
  assert.equal(status, 401);
  assert.match(body.error.message, /workspace ID, not an MCP access token/);
  assert.match(body.error.message, /AI Connector \(https:\/\/leads\.adhello\.io\/workspace\/ai-apps\)/);

  const missing = await runAuth({});
  assert.equal(missing.status, 401);
  assert.match(missing.body.error.message, /AI Connector/);
});

test('members only see and revoke their own tokens; admins manage all', async () => {
  const mine = await createAgentMcpToken(WID, { label: 'n8n', createdBy: SDR });
  const ws = await dbService.getWorkspace(WID);
  assert.deepEqual(listAgentMcpTokens(ws, { email: SDR, canManage: false }).map((t) => t.label), ['n8n']);
  assert.ok(listAgentMcpTokens(ws, { email: OWNER, canManage: true }).length >= 3);
  assert.ok(listAgentMcpTokens(ws, {}).every((t) => !('hash' in t)));

  const ownerToken = listAgentMcpTokens(ws, { canManage: true }).find((t) => t.label === 'Muse');
  assert.deepEqual(await revokeAgentMcpToken(WID, ownerToken.id, { email: SDR, canManage: false }), { revoked: false, status: 403 });
  assert.deepEqual(await revokeAgentMcpToken(WID, 'tok_missing', { email: OWNER, canManage: true }), { revoked: false, status: 404 });

  assert.deepEqual(await revokeAgentMcpToken(WID, mine.id, { email: SDR, canManage: false }), { revoked: true });
  assert.equal(await validateMcpBearerToken(mine.token), null);
});

test('a token stops working once its creator leaves the workspace', async () => {
  const issued = await createAgentMcpToken(WID, { label: 'Script', createdBy: SDR });
  assert.ok(await validateMcpBearerToken(issued.token));
  const ws = await dbService.getWorkspace(WID);
  const members = { ...ws.members };
  delete members[SDR];
  await dbService.saveWorkspace(WID, { ...ws, members });
  assert.equal(await validateMcpBearerToken(issued.token), null);
});
