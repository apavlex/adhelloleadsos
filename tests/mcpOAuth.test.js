const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

process.env.APP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-oauth-'));
delete process.env.MCP_ACCESS_TOKEN;

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const session = require('express-session');
const dbService = require('../services/database');
const store = require('../services/networkStore');
const networkReferrals = require('../services/networkReferrals');
const mcpOAuth = require('../services/mcp/mcpOAuth');
const { executeCrmTool, getOpenAiFunctionTools } = require('../services/mcp/mcpToolExecutor');
const { createCrmMcpServer } = require('../services/mcp/mcpServerFactory');
const oauthRoutes = require('../routes/oauth');
const mcpRoutes = require('../routes/mcp');

const OWNER = 'owner@example.com';
const VIEWER = 'viewer@example.com';
const REDIRECT = 'https://chatgpt.com/connector_platform_oauth_redirect';

let wsCounter = 0;

async function setupWorkspace() {
  wsCounter += 1;
  const wid = `ws_oauth_${wsCounter}`;
  await dbService.saveWorkspace(wid, {
    id: wid,
    name: `OAuth WS ${wsCounter}`,
    ownerUserId: OWNER,
    members: { [OWNER]: { role: 'owner' }, [VIEWER]: { role: 'viewer' } },
  });
  await dbService.addUserWorkspaceId(OWNER, wid);
  const network = await store.getOrCreateNetworkForWorkspace(wid, { name: 'Camas Pros' });
  const zone = await store.saveZone(network.id, { name: 'Camas', cities: ['Camas'], zips: ['98607'] });
  const saved = await dbService.saveLeadWithMeta({ workspaceId: wid, title: 'Patrick Plumbing', phone: 'N/A', city: 'Camas' });
  const { member } = await networkReferrals.saveMemberWithSeats(network, {
    leadKey: saved.key,
    companyName: 'Patrick Plumbing',
    contactName: 'Patrick OBrien',
    status: 'active',
  }, { trades: ['plumbing'], zoneIds: [zone.id] });
  return { wid, network, zone, member };
}

function startApp() {
  const state = { email: '' };
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
  app.use(session({ secret: 'test', resave: false, saveUninitialized: false }));
  app.use((req, _res, next) => {
    if (state.email) req.user = { emails: [{ value: state.email }] };
    req.isAuthenticated = () => Boolean(state.email);
    next();
  });
  app.use('/ceo/mcp', mcpRoutes);
  app.use('/', oauthRoutes);
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve({ server, state, base: `http://127.0.0.1:${server.address().port}` }));
  });
}

function pkce() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  return { verifier, challenge: crypto.createHash('sha256').update(verifier).digest('base64url') };
}

function form(body) {
  return { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString(), redirect: 'manual' };
}

async function mcpCall(base, token, method, params) {
  const res = await fetch(`${base}/ceo/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: params || {} }),
  });
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null };
}

/** Register a client, sign in, approve on the consent page, and return the code + verifier. */
async function authorize(base, state, { wid, cookie: jar = {} } = {}) {
  const reg = await fetch(`${base}/oauth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_name: 'ChatGPT', redirect_uris: [REDIRECT], token_endpoint_auth_method: 'none' }),
  });
  assert.equal(reg.status, 201);
  const client = await reg.json();
  const { verifier, challenge } = pkce();
  const qs = new URLSearchParams({
    response_type: 'code',
    client_id: client.client_id,
    redirect_uri: REDIRECT,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: 'xyz123',
    resource: `${base}/ceo/mcp`,
  });
  const withCookie = (init = {}) => ({ ...init, headers: { ...(init.headers || {}), ...(jar.value ? { cookie: jar.value } : {}) } });
  const keepCookie = (res) => {
    const set = res.headers.get('set-cookie');
    if (set) jar.value = set.split(';')[0];
  };

  state.email = '';
  const loggedOut = await fetch(`${base}/oauth/authorize?${qs}`, withCookie({ redirect: 'manual' }));
  keepCookie(loggedOut);
  assert.equal(loggedOut.status, 302);
  assert.equal(loggedOut.headers.get('location'), '/auth/login');

  state.email = OWNER;
  const consent = await fetch(`${base}/oauth/authorize?${qs}`, withCookie({ redirect: 'manual' }));
  keepCookie(consent);
  assert.equal(consent.status, 200);
  assert.equal(consent.headers.get('x-frame-options'), 'DENY');
  const html = await consent.text();
  assert.match(html, /Connect ChatGPT to your workspace/);
  const txn = /name="txn" value="([a-f0-9]+)"/.exec(html)[1];

  const approved = await fetch(`${base}/oauth/authorize`, withCookie(form({ txn, decision: 'allow', workspaceId: wid })));
  assert.equal(approved.status, 302);
  const location = new URL(approved.headers.get('location'));
  assert.equal(`${location.origin}${location.pathname}`, REDIRECT);
  assert.equal(location.searchParams.get('state'), 'xyz123');

  const replay = await fetch(`${base}/oauth/authorize`, withCookie(form({ txn, decision: 'allow', workspaceId: wid })));
  assert.equal(replay.status, 400);

  return { client, verifier, code: location.searchParams.get('code') };
}

test('MCP tools publish real input schemas and annotations, and accept arguments', async () => {
  const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
  const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
  const { wid } = await setupWorkspace();
  const server = createCrmMcpServer({ workspaceId: wid, userEmail: OWNER });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: 'test', version: '1' });
  await client.connect(clientSide);
  const { tools } = await client.listTools();
  const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
  assert.ok(byName.list_leads.inputSchema.properties.folder_name);
  assert.ok(byName.send_referral.inputSchema.properties.homeowner_consent);
  assert.equal(byName.list_folders.annotations.readOnlyHint, true);
  assert.equal(byName.sync_leads_to_ghl.annotations.destructiveHint, true);
  assert.equal(byName.send_referral.annotations.openWorldHint, true);
  const result = await client.callTool({ name: 'get_network_overview', arguments: {} });
  const payload = JSON.parse(result.content[0].text);
  assert.equal(payload.success, true);
  assert.equal(payload.network.name, 'Camas Pros');
  assert.ok(getOpenAiFunctionTools().some((t) => t.function.name === 'list_referrals'));
  await client.close();
});

test('network tools route referrals, move them along, and guard approvals', async () => {
  const { wid, network } = await setupWorkspace();
  const ctx = { workspaceId: wid, userEmail: OWNER, baseUrl: 'https://leads.example' };

  const noConsent = await executeCrmTool(ctx, 'send_referral', { trade: 'plumber', homeowner_name: 'Dana', phone: '3605550100', city: 'Camas', homeowner_consent: false });
  assert.equal(noConsent.success, false);

  const sent = await executeCrmTool(ctx, 'send_referral', { trade: 'plumber', homeowner_name: 'Dana Lee', phone: '3605550100', city: 'Camas', note: 'Leaky water heater', homeowner_consent: true });
  assert.equal(sent.success, true, sent.error);
  assert.equal(sent.referral.status, 'sent');
  assert.equal(sent.referral.to, 'Patrick Plumbing');

  const accepted = await executeCrmTool(ctx, 'update_referral', { referral_id: sent.referral.id, action: 'accept' });
  assert.equal(accepted.referral.status, 'accepted');
  const won = await executeCrmTool(ctx, 'update_referral', { referral_id: sent.referral.id, action: 'win', job_value: 1850 });
  assert.equal(won.referral.status, 'won');
  assert.equal(won.referral.job_value, 1850);

  const listed = await executeCrmTool(ctx, 'list_referrals', { member: 'patrick', direction: 'received' });
  assert.equal(listed.total, 1);
  const members = await executeCrmTool(ctx, 'list_network_members', {});
  assert.equal(members.members[0].stats.wonValue, 1850);

  const badTrade = await executeCrmTool(ctx, 'send_referral', { trade: 'astronaut', homeowner_name: 'X', phone: '1', homeowner_consent: true });
  assert.equal(badTrade.code, 'TRADE_UNKNOWN');

  const app = await store.saveApplication(network.id, { companyName: 'Evergreen Landscaping', phone: '3605550199', tradeSlug: 'landscaping', city: 'Camas' });
  const denied = await executeCrmTool({ ...ctx, userEmail: VIEWER }, 'approve_network_application', { application_id: app.id });
  assert.equal(denied.code, 'FORBIDDEN');
  const pending = await executeCrmTool(ctx, 'list_network_applications', {});
  assert.equal(pending.applications[0].suggested_zone, 'Camas');
  const rejected = await executeCrmTool(ctx, 'reject_network_application', { application_id: app.id });
  assert.equal(rejected.success, true);
});

test('manage_network_trades lists, adds built-in and custom trades, and hides them', async () => {
  const { wid } = await setupWorkspace();
  const ctx = { workspaceId: wid, userEmail: OWNER };

  const listed = await executeCrmTool(ctx, 'manage_network_trades', { action: 'list' });
  assert.equal(listed.success, true, listed.error);
  assert.ok(listed.hidden_trades.includes('Interior design'));

  const added = await executeCrmTool(ctx, 'manage_network_trades', { action: 'add', trades: ['Interior designers', 'Property managers', 'Flooring'] });
  assert.equal(added.success, true, added.error);
  assert.ok(added.active_trades.includes('Interior design'));
  assert.ok(added.active_trades.includes('Property managers'));
  assert.match(added.skipped.join(' '), /Flooring: already on the list/);

  const hidden = await executeCrmTool(ctx, 'manage_network_trades', { action: 'hide', trades: ['plumbing', 'Property managers'] });
  assert.match(hidden.skipped.join(' '), /Plumbing: a member holds its seat in Camas/);
  assert.ok(hidden.hidden_trades.includes('Property managers'));

  const denied = await executeCrmTool({ ...ctx, userEmail: VIEWER }, 'manage_network_trades', { action: 'add', trades: ['Solar'] });
  assert.equal(denied.code, 'FORBIDDEN');
  assert.ok(getOpenAiFunctionTools().some((t) => t.function.name === 'manage_network_trades'));
});

test('redirect URI rules for dynamic registration', () => {
  assert.equal(mcpOAuth.validRedirectUri('https://claude.ai/api/mcp/auth_callback'), true);
  assert.equal(mcpOAuth.validRedirectUri('http://localhost:6274/oauth/callback'), true);
  assert.equal(mcpOAuth.validRedirectUri('cursor://anysphere.cursor-mcp/oauth/callback'), true);
  assert.equal(mcpOAuth.validRedirectUri('http://evil.example/cb'), false);
  assert.equal(mcpOAuth.validRedirectUri('javascript:alert(1)'), false);
  assert.equal(mcpOAuth.validRedirectUri('https://ok.example/cb#frag'), false);
});

test('OAuth: discovery, consent, PKCE token exchange, MCP access, refresh rotation, revoke', async () => {
  const { wid } = await setupWorkspace();
  const { server, state, base } = await startApp();
  try {
    const anon = await mcpCall(base, '', 'tools/list');
    assert.equal(anon.status, 401);
    assert.match(anon.headers.get('www-authenticate'), /resource_metadata="http:\/\/127\.0\.0\.1:\d+\/\.well-known\/oauth-protected-resource"/);

    const prm = await (await fetch(`${base}/.well-known/oauth-protected-resource/ceo/mcp`)).json();
    assert.equal(prm.resource, `${base}/ceo/mcp`);
    assert.deepEqual(prm.authorization_servers, [base]);
    const asm = await (await fetch(`${base}/.well-known/oauth-authorization-server`)).json();
    assert.equal(asm.token_endpoint, `${base}/oauth/token`);
    assert.deepEqual(asm.code_challenge_methods_supported, ['S256']);

    const badReg = await fetch(`${base}/oauth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ redirect_uris: ['http://evil.example/cb'] }),
    });
    assert.equal(badReg.status, 400);

    const { client, verifier, code } = await authorize(base, state, { wid });

    const wrongVerifier = await fetch(`${base}/oauth/token`, form({ grant_type: 'authorization_code', code, client_id: client.client_id, redirect_uri: REDIRECT, code_verifier: 'x'.repeat(43) }));
    assert.equal(wrongVerifier.status, 400);
    assert.equal((await wrongVerifier.json()).error, 'invalid_grant');

    // Codes are single-use, so a failed attempt burns it; run a fresh authorization.
    const second = await authorize(base, state, { wid });
    const tokenRes = await fetch(`${base}/oauth/token`, form({ grant_type: 'authorization_code', code: second.code, client_id: second.client.client_id, redirect_uri: REDIRECT, code_verifier: second.verifier }));
    assert.equal(tokenRes.status, 200);
    assert.equal(tokenRes.headers.get('cache-control'), 'no-store');
    const tokens = await tokenRes.json();
    assert.equal(tokens.token_type, 'Bearer');
    assert.ok(tokens.access_token.startsWith('aho_at_'));

    const codeReplay = await fetch(`${base}/oauth/token`, form({ grant_type: 'authorization_code', code: second.code, client_id: second.client.client_id, code_verifier: second.verifier }));
    assert.equal(codeReplay.status, 400);

    state.email = '';
    const list = await mcpCall(base, tokens.access_token, 'tools/list');
    assert.equal(list.status, 200);
    assert.ok(list.body.result.tools.some((t) => t.name === 'send_referral'));
    const call = await mcpCall(base, tokens.access_token, 'tools/call', { name: 'list_network_members', arguments: {} });
    assert.equal(JSON.parse(call.body.result.content[0].text).members[0].company, 'Patrick Plumbing');

    const refreshed = await (await fetch(`${base}/oauth/token`, form({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: second.client.client_id }))).json();
    assert.ok(refreshed.access_token && refreshed.access_token !== tokens.access_token);
    const oldRefresh = await fetch(`${base}/oauth/token`, form({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: second.client.client_id }));
    assert.equal(oldRefresh.status, 400);
    assert.equal((await mcpCall(base, tokens.access_token, 'tools/list')).status, 401);
    assert.equal((await mcpCall(base, refreshed.access_token, 'tools/list')).status, 200);

    const grants = await mcpOAuth.listGrantsForWorkspace(wid);
    assert.equal(grants.length, 1);
    assert.equal(grants[0].clientName, 'ChatGPT');
    assert.equal(grants[0].userEmail, OWNER);
    assert.equal(await mcpOAuth.revokeGrantForWorkspace('someone_else', grants[0].id), false);
    assert.equal(await mcpOAuth.revokeGrantForWorkspace(wid, grants[0].id), true);
    assert.equal((await mcpCall(base, refreshed.access_token, 'tools/list')).status, 401);
    const afterRevoke = await fetch(`${base}/oauth/token`, form({ grant_type: 'refresh_token', refresh_token: refreshed.refresh_token, client_id: second.client.client_id }));
    assert.equal(afterRevoke.status, 400);
  } finally {
    server.close();
  }
});

test('OAuth: tokens stop working when the user loses workspace access; deny returns access_denied', async () => {
  const { wid } = await setupWorkspace();
  const { server, state, base } = await startApp();
  try {
    const { client, verifier, code } = await authorize(base, state, { wid });
    const tokens = await (await fetch(`${base}/oauth/token`, form({ grant_type: 'authorization_code', code, client_id: client.client_id, code_verifier: verifier }))).json();
    state.email = '';
    assert.equal((await mcpCall(base, tokens.access_token, 'tools/list')).status, 200);

    const ws = await dbService.getWorkspace(wid);
    await dbService.saveWorkspace(wid, { ...ws, ownerUserId: 'someone@example.com', members: {} });
    assert.equal((await mcpCall(base, tokens.access_token, 'tools/list')).status, 401);

    const unknown = await fetch(`${base}/oauth/authorize?client_id=mcp_${'0'.repeat(24)}&response_type=code`, { redirect: 'manual' });
    assert.equal(unknown.status, 400);
    assert.match(await unknown.text(), /not registered/);

    const noPkce = await fetch(`${base}/oauth/authorize?${new URLSearchParams({ client_id: client.client_id, redirect_uri: REDIRECT, response_type: 'code', state: 's1' })}`, { redirect: 'manual' });
    assert.equal(noPkce.status, 302);
    const loc = new URL(noPkce.headers.get('location'));
    assert.equal(loc.searchParams.get('error'), 'invalid_request');
    assert.equal(loc.searchParams.get('state'), 's1');
  } finally {
    server.close();
  }
});
