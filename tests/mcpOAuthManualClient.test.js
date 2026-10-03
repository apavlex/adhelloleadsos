const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.APP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-oauth-manual-'));
delete process.env.MCP_ACCESS_TOKEN;

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const session = require('express-session');
const dbService = require('../services/database');
const mcpOAuth = require('../services/mcp/mcpOAuth');
const oauthRoutes = require('../routes/oauth');
const mcpRoutes = require('../routes/mcp');

const OWNER = 'owner@example.com';
const MUSE_REDIRECT = 'https://www.meta.ai/oauth/callback';

let wsCounter = 0;
async function makeWorkspace() {
  wsCounter += 1;
  const wid = `ws_manual_${wsCounter}`;
  await dbService.saveWorkspace(wid, { id: wid, name: `Manual WS ${wsCounter}`, ownerUserId: OWNER, members: { [OWNER]: { role: 'owner' } } });
  await dbService.addUserWorkspaceId(OWNER, wid);
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
  app.use('/ceo/mcp', mcpRoutes);
  app.use('/', oauthRoutes);
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` }));
  });
}

function form(body, cookie) {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...(cookie ? { cookie } : {}) },
    body: new URLSearchParams(body).toString(),
    redirect: 'manual',
  };
}

async function consent(base, clientId, redirectUri) {
  const qs = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: redirectUri, state: 's1', scope: 'crm' });
  const res = await fetch(`${base}/oauth/authorize?${qs}`, { redirect: 'manual' });
  const cookie = (res.headers.get('set-cookie') || '').split(';')[0];
  return { res, html: await res.text(), cookie };
}

async function listTools(base, token) {
  const res = await fetch(`${base}/ceo/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  });
  return res.status;
}

test('admin-created Client ID connects without PKCE, locks its callback, and stays in its workspace', async () => {
  const wid = await makeWorkspace();
  const otherWid = await makeWorkspace();
  const { client, clientSecret } = await mcpOAuth.createManualClient({ workspaceId: wid, name: 'Meta AI (Muse)', createdBy: OWNER });
  assert.deepEqual(client.redirectUris, []);
  const { server, base } = await startApp();
  try {
    const { res, html, cookie } = await consent(base, client.id, MUSE_REDIRECT);
    assert.equal(res.status, 200);
    assert.match(html, /Meta AI \(Muse\)/);
    assert.ok(html.includes(`value="${wid}"`));
    assert.ok(!html.includes(`value="${otherWid}"`), 'only the workspace the client was made in is offered');
    assert.deepEqual((await mcpOAuth.getClient(client.id)).redirectUris, [MUSE_REDIRECT]);

    const other = await consent(base, client.id, 'https://evil.example/cb');
    assert.equal(other.res.status, 400);

    const txn = /name="txn" value="([a-f0-9]+)"/.exec(html)[1];
    const wrongWs = await fetch(`${base}/oauth/authorize`, form({ txn, decision: 'allow', workspaceId: otherWid }, cookie));
    assert.equal(wrongWs.status, 403);

    const again = await consent(base, client.id, MUSE_REDIRECT);
    const txn2 = /name="txn" value="([a-f0-9]+)"/.exec(again.html)[1];
    const approved = await fetch(`${base}/oauth/authorize`, form({ txn: txn2, decision: 'allow', workspaceId: wid }, again.cookie));
    assert.equal(approved.status, 302);
    const loc = new URL(approved.headers.get('location'));
    assert.equal(`${loc.origin}${loc.pathname}`, MUSE_REDIRECT);
    const code = loc.searchParams.get('code');

    const noSecret = await fetch(`${base}/oauth/token`, form({ grant_type: 'authorization_code', code, client_id: client.id, redirect_uri: MUSE_REDIRECT }));
    assert.equal(noSecret.status, 401);

    const again2 = await consent(base, client.id, MUSE_REDIRECT);
    const txn3 = /name="txn" value="([a-f0-9]+)"/.exec(again2.html)[1];
    const approved2 = await fetch(`${base}/oauth/authorize`, form({ txn: txn3, decision: 'allow', workspaceId: wid }, again2.cookie));
    const code2 = new URL(approved2.headers.get('location')).searchParams.get('code');
    const basic = Buffer.from(`${client.id}:${clientSecret}`).toString('base64');
    const tokenRes = await fetch(`${base}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: `Basic ${basic}` },
      body: new URLSearchParams({ grant_type: 'authorization_code', code: code2, redirect_uri: MUSE_REDIRECT }).toString(),
    });
    assert.equal(tokenRes.status, 200);
    const tokens = await tokenRes.json();
    assert.ok(tokens.access_token && tokens.refresh_token);
    assert.equal(await listTools(base, tokens.access_token), 200);
    assert.equal((await mcpOAuth.validateAccessToken(tokens.access_token)).workspaceId, wid);

    const listed = await mcpOAuth.listManualClients(wid);
    assert.equal(listed.length, 1);
    assert.equal(listed[0].id, client.id);
    assert.equal((await mcpOAuth.listManualClients(otherWid)).length, 0);

    assert.equal(await mcpOAuth.deleteManualClient(otherWid, client.id), false);
    assert.equal(await mcpOAuth.deleteManualClient(wid, client.id), true);
    assert.equal(await mcpOAuth.validateAccessToken(tokens.access_token), null);
    assert.equal(await mcpOAuth.getClient(client.id), null);
  } finally {
    server.close();
  }
});

test('self-registered public clients still must use PKCE', async () => {
  await makeWorkspace();
  const reg = await mcpOAuth.registerClient({ client_name: 'ChatGPT', redirect_uris: [MUSE_REDIRECT], token_endpoint_auth_method: 'none' });
  const { server, base } = await startApp();
  try {
    const { res } = await consent(base, reg.client_id, MUSE_REDIRECT);
    assert.equal(res.status, 302);
    assert.equal(new URL(res.headers.get('location')).searchParams.get('error'), 'invalid_request');
  } finally {
    server.close();
  }
});

test('a callback URL given up front is enforced from the start', async () => {
  const wid = await makeWorkspace();
  await assert.rejects(() => mcpOAuth.createManualClient({ workspaceId: wid, name: 'Bad', redirectUri: 'javascript:alert(1)' }), /not allowed/);
  const { client } = await mcpOAuth.createManualClient({ workspaceId: wid, name: 'Grok', redirectUri: MUSE_REDIRECT });
  const { server, base } = await startApp();
  try {
    assert.equal((await consent(base, client.id, 'https://other.example/cb')).res.status, 400);
    assert.equal((await consent(base, client.id, MUSE_REDIRECT)).res.status, 200);
  } finally {
    server.close();
  }
});
