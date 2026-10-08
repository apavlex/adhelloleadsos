const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

process.env.APP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-trial-'));
delete process.env.MCP_ACCESS_TOKEN;

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const session = require('express-session');
const dbService = require('../services/database');
const trials = require('../services/trials');
const oauthRoutes = require('../routes/oauth');
const mcpRoutes = require('../routes/mcp');
const signupRoutes = require('../routes/signup');

const NEWBIE = 'newbie@example.com';
const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';

function startApp() {
  const state = { email: '' };
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
  app.use(session({ secret: 'test', resave: false, saveUninitialized: false }));
  app.use((req, _res, next) => {
    if (state.email) req.user = { displayName: 'New Bie', emails: [{ value: state.email }] };
    req.isAuthenticated = () => Boolean(state.email);
    next();
  });
  app.use('/', signupRoutes);
  app.use('/ceo/mcp', mcpRoutes);
  app.use('/', oauthRoutes);
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve({ server, state, base: `http://127.0.0.1:${server.address().port}` }));
  });
}

function form(body, cookie) {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
    body: new URLSearchParams(body).toString(),
    redirect: 'manual',
  };
}

async function mcpCall(base, token, method, params) {
  const res = await fetch(`${base}/ceo/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 7, method, params: params || {} }),
  });
  return { status: res.status, body: await res.json() };
}

test('a brand-new user connecting an AI app signs up for a trial and lands back on consent', async () => {
  const { server, state, base } = await startApp();
  const jar = { value: '' };
  const keep = (res) => {
    const set = res.headers.get('set-cookie');
    if (set) jar.value = set.split(';')[0];
    return res;
  };
  const get = (url) => fetch(url, { redirect: 'manual', headers: jar.value ? { cookie: jar.value } : {} }).then(keep);
  try {
    const client = await (await fetch(`${base}/oauth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_name: 'Claude', redirect_uris: [REDIRECT], token_endpoint_auth_method: 'none' }),
    })).json();
    const verifier = crypto.randomBytes(32).toString('base64url');
    const qs = new URLSearchParams({
      response_type: 'code',
      client_id: client.client_id,
      redirect_uri: REDIRECT,
      code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
      state: 'st1',
    });
    const authorizePath = `/oauth/authorize?${qs}`;

    // Signed in with Google, but no workspace yet → trial signup instead of a dead end.
    state.email = NEWBIE;
    const noWs = await get(`${base}${authorizePath}`);
    assert.equal(noWs.status, 302);
    assert.equal(noWs.headers.get('location'), '/signup?connect=1');

    const page = await (await get(`${base}/signup?connect=1`)).text();
    assert.match(page, /<strong>Claude<\/strong> wants to connect to AdHello/);

    const posted = keep(await fetch(`${base}/signup`, form({
      name: 'New Bie', phone: '555-222-3333', company: 'Bie Agency', niche: 'dentists', teamSize: 'Just me', source: 'Other',
    }, jar.value)));
    assert.equal(posted.headers.get('location'), '/signup/complete');

    const done = await get(`${base}/signup/complete`);
    assert.equal(done.status, 302);
    assert.equal(done.headers.get('location'), authorizePath);

    const consent = await (await get(`${base}${authorizePath}`)).text();
    assert.match(consent, /Connect Claude to your workspace/);
    const txn = /name="txn" value="([a-f0-9]+)"/.exec(consent)[1];
    const wid = trials.getSignup(NEWBIE).workspaceId;
    const approved = await fetch(`${base}/oauth/authorize`, form({ txn, decision: 'allow', workspaceId: wid }, jar.value));
    const code = new URL(approved.headers.get('location')).searchParams.get('code');
    const tokens = await (await fetch(`${base}/oauth/token`, form({
      grant_type: 'authorization_code', code, client_id: client.client_id, redirect_uri: REDIRECT, code_verifier: verifier,
    }))).json();
    assert.ok(tokens.access_token);

    state.email = '';
    const overview = await mcpCall(base, tokens.access_token, 'tools/call', { name: 'get_workspace_overview', arguments: {} });
    const data = JSON.parse(overview.body.result.content[0].text);
    assert.equal(data.workspace.name, 'Bie Agency');
    assert.equal(data.free_trial.state, 'trial');
    assert.equal(data.free_trial.days_left, 7);

    // Trial over: tool calls come back as a readable error, listing tools still works.
    await trials.adminUpdate(wid, { action: 'end', by: 'admin@adhello.ai' });
    const ended = await mcpCall(base, tokens.access_token, 'tools/call', { name: 'get_workspace_overview', arguments: {} });
    assert.equal(ended.status, 200);
    assert.equal(ended.body.id, 7);
    assert.equal(ended.body.result.isError, true);
    assert.match(ended.body.result.content[0].text, /free trial for the AdHello workspace "Bie Agency" has ended/);
    assert.equal((await mcpCall(base, tokens.access_token, 'tools/list')).status, 200);

    await trials.adminUpdate(wid, { action: 'extend', days: 7 });
    const back = await mcpCall(base, tokens.access_token, 'tools/call', { name: 'get_workspace_overview', arguments: {} });
    assert.notEqual(back.body.result.isError, true);
    assert.ok(await dbService.getWorkspace(wid));
  } finally {
    server.close();
  }
});
