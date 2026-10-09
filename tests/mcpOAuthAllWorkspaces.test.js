const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

process.env.APP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-oauth-all-'));
delete process.env.MCP_ACCESS_TOKEN;

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const session = require('express-session');
const dbService = require('../services/database');
const mcpOAuth = require('../services/mcp/mcpOAuth');
const { createCrmMcpServer } = require('../services/mcp/mcpServerFactory');
const oauthRoutes = require('../routes/oauth');

const OWNER = 'owner@example.com';
const REDIRECT = 'https://chatgpt.com/connector_platform_oauth_redirect';
let n = 0;

async function makeWorkspace(name, members = { [OWNER]: { role: 'owner' } }) {
  n += 1;
  const wid = `ws_all_${n}`;
  await dbService.saveWorkspace(wid, { id: wid, name, slug: name.toLowerCase().replace(/\s+/g, '-'), ownerUserId: OWNER, members });
  for (const email of Object.keys(members)) await dbService.addUserWorkspaceId(email, wid);
  return wid;
}

function startApp() {
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
  app.use(session({ secret: 'test', resave: false, saveUninitialized: false }));
  app.use((req, _res, next) => {
    req.user = { emails: [{ value: OWNER }] };
    req.isAuthenticated = () => true;
    next();
  });
  app.use('/', oauthRoutes);
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` }));
  });
}

async function connectAll(base, { sessionWorkspaceId } = {}) {
  const client = await mcpOAuth.registerClient({ client_name: 'Grok', redirect_uris: [REDIRECT], token_endpoint_auth_method: 'none' });
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const qs = new URLSearchParams({
    response_type: 'code',
    client_id: client.client_id,
    redirect_uri: REDIRECT,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: 's',
  });
  const consent = await fetch(`${base}/oauth/authorize?${qs}`, { redirect: 'manual' });
  const cookie = (consent.headers.get('set-cookie') || '').split(';')[0];
  const html = await consent.text();
  const txn = /name="txn" value="([a-f0-9]+)"/.exec(html)[1];
  const approved = await fetch(`${base}/oauth/authorize`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
    body: new URLSearchParams({ txn, decision: 'allow', workspaceId: '__all__' }).toString(),
    redirect: 'manual',
  });
  const code = new URL(approved.headers.get('location')).searchParams.get('code');
  const tokens = await mcpOAuth.exchangeAuthorizationCode({ code, clientId: client.client_id, redirectUri: REDIRECT, codeVerifier: verifier });
  return { html, tokens, sessionWorkspaceId };
}

async function mcpClientFor(auth) {
  const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
  const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
  const server = createCrmMcpServer({
    workspaceId: auth.workspaceId,
    userEmail: auth.userEmail,
    allWorkspaces: auth.allWorkspaces,
    grantId: auth.grantId,
    workspaceName: auth.workspace.name,
  });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: 'test', version: '1' });
  await client.connect(clientSide);
  return client;
}

const parse = (res) => JSON.parse(res.content[0].text);

test('consent defaults to one workspace; all-workspaces is opt-in', async () => {
  const agency = await makeWorkspace('AdHello Agency');
  await makeWorkspace('Bright Electric');
  const { server, base } = await startApp();
  try {
    const client = await mcpOAuth.registerClient({ client_name: 'Grok', redirect_uris: [REDIRECT], token_endpoint_auth_method: 'none' });
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const qs = new URLSearchParams({
      response_type: 'code',
      client_id: client.client_id,
      redirect_uri: REDIRECT,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state: 's',
    });
    const html = await (await fetch(`${base}/oauth/authorize?${qs}`, { redirect: 'manual' })).text();
    assert.match(html, /All my workspaces/);
    assert.doesNotMatch(html, /<option value="__all__" selected>/);
    assert.match(html, /<option value="[^"]+" selected>/);
    assert.match(html, new RegExp(`value="${agency}"`));
  } finally {
    server.close();
  }
});

test('one connection can reach every workspace per call, but the default stays locked', async () => {
  const agency = await makeWorkspace('AdHello Agency');
  const roofers = await makeWorkspace('Camas Roofers');
  const { server, base } = await startApp();
  try {
    const { tokens } = await connectAll(base);
    const auth = await mcpOAuth.validateAccessToken(tokens.access_token);
    assert.equal(auth.allWorkspaces, true);
    const lockedId = auth.workspaceId;
    assert.ok([agency, roofers].includes(lockedId) || typeof lockedId === 'string');
    const client = await mcpClientFor(auth);
    assert.match(client.getInstructions() || '', /locked to/);

    const { tools } = await client.listTools();
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    assert.ok(byName.list_workspaces && byName.switch_workspace);
    assert.ok(byName.list_folders.inputSchema.properties.workspace, 'every tool takes an optional workspace');
    assert.ok(byName.get_lead_script.inputSchema.properties.workspace);

    const listed = parse(await client.callTool({ name: 'list_workspaces', arguments: {} }));
    assert.ok(listed.count >= 2);
    assert.match(listed.how_to_use, /locked/i);
    assert.equal(listed.current.id, lockedId);

    const here = parse(await client.callTool({ name: 'list_folders', arguments: {} }));
    assert.equal(here.workspace.id, lockedId);
    const there = parse(await client.callTool({ name: 'list_folders', arguments: { workspace: 'Camas Roofers' } }));
    assert.equal(there.workspace.id, roofers);

    const bad = await client.callTool({ name: 'list_folders', arguments: { workspace: 'Nope Inc' } });
    assert.equal(bad.isError, true);
    assert.match(parse(bad).error, /Workspaces on this connection/);

    const other = lockedId === agency ? roofers : agency;
    const switched = await client.callTool({ name: 'switch_workspace', arguments: { workspace: other } });
    assert.equal(switched.isError, true);
    assert.match(parse(switched).error, /locked/i);
    assert.equal(await mcpOAuth.setGrantActiveWorkspace(auth.grantId, other), false);
    assert.equal((await mcpOAuth.validateAccessToken(tokens.access_token)).workspaceId, lockedId);
    await client.close();
  } finally {
    server.close();
  }
});

test('an admin can block an all-workspaces app from their workspace; the owner disconnects it everywhere', async () => {
  const ADMIN = 'admin@example.com';
  const mine = await makeWorkspace('Mine Co');
  const shared = await makeWorkspace('Shared Co', { [OWNER]: { role: 'member' }, [ADMIN]: { role: 'owner' } });
  const { server, base } = await startApp();
  try {
    const { tokens } = await connectAll(base);
    const { grantId } = await mcpOAuth.validateAccessToken(tokens.access_token);
    assert.ok((await mcpOAuth.listGrantsForWorkspace(shared)).some((g) => g.id === grantId && g.allWorkspaces));

    assert.equal(await mcpOAuth.revokeGrantForWorkspace(shared, grantId), true);
    const after = await mcpOAuth.listGrantWorkspaces(grantId);
    assert.ok(!after.workspaces.some((w) => w.id === shared), 'blocked workspace is gone');
    assert.ok(after.workspaces.some((w) => w.id === mine), 'other workspaces keep working');
    assert.ok(!(await mcpOAuth.listGrantsForWorkspace(shared)).some((g) => g.id === grantId));
    assert.equal(await mcpOAuth.setGrantActiveWorkspace(grantId, shared), false);

    assert.equal(await mcpOAuth.revokeGrantForWorkspace(mine, grantId, { byOwner: true }), true);
    assert.equal(await mcpOAuth.validateAccessToken(tokens.access_token), null);
  } finally {
    server.close();
  }
});

test('single-workspace connections and locked Client IDs are unchanged', async () => {
  const a = await makeWorkspace('Solo A');
  await makeWorkspace('Solo B');
  const locked = await mcpOAuth.createManualClient({ workspaceId: a, name: 'Locked', redirectUri: REDIRECT });
  const open = await mcpOAuth.createManualClient({ workspaceId: a, name: 'Muse', redirectUri: REDIRECT, allWorkspaces: true });
  const { server, base } = await startApp();
  try {
    const page = async (clientId) =>
      (await fetch(`${base}/oauth/authorize?${new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: REDIRECT })}`, { redirect: 'manual' })).text();
    assert.ok(!(await page(locked.client.id)).includes('__all__'));
    assert.match(await page(open.client.id), /All my workspaces/);
  } finally {
    server.close();
  }
});
