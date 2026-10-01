const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pavlex-conv-'));
process.env.APP_DATA_DIR = tmpDataDir;

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const express = require('express');
const dbService = require('../services/database');
const { pavlexChatChannel } = require('../services/pavlex/pavlexWorkspaceScope');
const conv = require('../services/pavlex/pavlexConversations');

const OWNER = 'owner@example.com';
const MATE = 'mate@example.com';

test('create, list, rename, pin and delete a conversation', () => {
  const a = conv.createConversation('ws_a', OWNER);
  assert.match(a.id, /^c_/);
  assert.equal(a.title, conv.DEFAULT_TITLE);
  assert.equal(a.messageCount, 0);

  const b = conv.createConversation('ws_a', OWNER, { title: 'Pricing ideas' });
  assert.equal(b.title, 'Pricing ideas');

  let list = conv.listConversations('ws_a', OWNER);
  assert.deepEqual(
    list.map((c) => c.id).sort(),
    [a.id, b.id].sort(),
  );

  const renamed = conv.updateConversation('ws_a', OWNER, a.id, { title: '  Camas designers  ' });
  assert.equal(renamed.title, 'Camas designers');
  const pinned = conv.updateConversation('ws_a', OWNER, a.id, { pinned: true });
  assert.equal(pinned.pinned, true);
  list = conv.listConversations('ws_a', OWNER);
  assert.equal(list[0].id, a.id, 'pinned chats sort first');

  assert.equal(conv.listConversations('ws_a', OWNER, { q: 'pricing' }).length, 1);

  assert.equal(conv.deleteConversation('ws_a', OWNER, b.id), true);
  assert.equal(conv.deleteConversation('ws_a', OWNER, b.id), false);
  assert.equal(conv.getConversation('ws_a', OWNER, b.id), null);
  assert.equal(conv.updateConversation('ws_a', OWNER, 'c_missing00', { title: 'x' }), null);
});

test('conversations are isolated per workspace and per user', () => {
  const mine = conv.createConversation('ws_iso', OWNER);
  conv.createConversation('ws_iso_other', OWNER);

  assert.equal(conv.getConversation('ws_iso', MATE, mine.id), null, 'teammate cannot read it');
  assert.equal(conv.getConversation('ws_iso_other', OWNER, mine.id), null, 'other workspace cannot read it');
  assert.equal(conv.getConversationMessages('ws_iso', MATE, mine.id), null);
  assert.equal(conv.updateConversation('ws_iso', MATE, mine.id, { title: 'hijack' }), null);
  assert.equal(conv.deleteConversation('ws_iso_other', OWNER, mine.id), false);
  assert.equal(conv.listConversations('ws_iso', MATE).length, 0);
  assert.equal(conv.listConversations('ws_iso', 'OWNER@example.com').length, 1, 'email is case-insensitive');

  assert.throws(() => conv.listConversations('', OWNER), (err) => err.status === 401);
  assert.throws(() => conv.createConversation('ws_iso', ''), (err) => err.status === 401);
});

test('first message auto-titles; user titles stick; messages are deleted with the chat', () => {
  const c = conv.createConversation('ws_t', OWNER);
  const channel = pavlexChatChannel('ws_t', OWNER, c.id);
  const longAsk =
    'Find 20 interior designers in Camas, WA and save them to a Referral Partners folder please, thanks a lot';
  dbService.saveChatMessage(channel, 'user', longAsk, 'web');
  dbService.saveChatMessage(channel, 'assistant', 'Started a **search** for interior designers.', 'web');
  const touched = conv.recordExchange('ws_t', OWNER, c.id, {
    userMessage: longAsk,
    reply: 'Started a **search** for interior designers.',
    toolsUsed: ['find_leads'],
  });
  assert.ok(touched.title.length <= 60, touched.title);
  assert.ok(touched.title.startsWith('Find 20 interior designers in Camas'));
  assert.equal(touched.messageCount, 2);
  assert.equal(touched.lastPreview, 'Started a search for interior designers.');

  const second = conv.recordExchange('ws_t', OWNER, c.id, { userMessage: 'And plumbers?', reply: 'Sure.' });
  assert.equal(second.title, touched.title, 'title only set from the first message');

  conv.updateConversation('ws_t', OWNER, c.id, { title: 'My title' });
  const third = conv.recordExchange('ws_t', OWNER, c.id, { userMessage: 'x', reply: 'y' });
  assert.equal(third.title, 'My title');

  const msgs = conv.getConversationMessages('ws_t', OWNER, c.id);
  assert.equal(msgs.length, 2);
  assert.deepEqual(msgs[1].toolsUsed, undefined, 'only replies recorded through recordExchange get tools');

  assert.equal(conv.deleteConversation('ws_t', OWNER, c.id), true);
  assert.equal(dbService.getChatHistory(channel, 50).length, 0);
});

test('tool chips line up with assistant replies after reload', () => {
  const c = conv.createConversation('ws_tools', OWNER);
  const channel = pavlexChatChannel('ws_tools', OWNER, c.id);
  const turns = [
    ['Show my bookmarked leads', 'Here they are.', ['list_leads']],
    ['Thanks', 'Anytime.', []],
  ];
  for (const [u, a, tools] of turns) {
    dbService.saveChatMessage(channel, 'user', u, 'web');
    dbService.saveChatMessage(channel, 'assistant', a, 'web');
    conv.recordExchange('ws_tools', OWNER, c.id, { userMessage: u, reply: a, toolsUsed: tools });
  }
  const msgs = conv.getConversationMessages('ws_tools', OWNER, c.id);
  assert.deepEqual(msgs[1].toolsUsed, ['list_leads']);
  assert.equal(msgs[3].toolsUsed, undefined);
});

test('recordExchange on a deleted chat cleans up stray messages', () => {
  const c = conv.createConversation('ws_gone', OWNER);
  const channel = pavlexChatChannel('ws_gone', OWNER, c.id);
  conv.deleteConversation('ws_gone', OWNER, c.id);
  dbService.saveChatMessage(channel, 'user', 'late', 'web');
  assert.equal(conv.recordExchange('ws_gone', OWNER, c.id, { userMessage: 'late', reply: 'r' }), null);
  assert.equal(dbService.getChatHistory(channel, 10).length, 0);
});

test('autoTitleFromMessage strips markdown and falls back to the default', () => {
  assert.equal(conv.autoTitleFromMessage('  **what** should I work on today?\nmore'), 'What should I work on today?');
  assert.equal(conv.autoTitleFromMessage('   '), conv.DEFAULT_TITLE);
});

// ── Routes ────────────────────────────────────────────────────────────────────

const agent = require('../services/pavlex/pavlexAgent');
let stubCalls = [];
agent.runPavlexChat = async (req, opts) => {
  stubCalls.push(opts);
  if (opts.message === 'boom') {
    const err = new Error('CRM connection unavailable.');
    err.status = 502;
    throw err;
  }
  const reply = `Echo: ${opts.message}`;
  if (opts.persistHistory) {
    const channel = pavlexChatChannel(req.workspaceId, req.user.emails[0].value, opts.conversationId);
    dbService.saveChatMessage(channel, 'user', opts.message, 'web');
    dbService.saveChatMessage(channel, 'assistant', reply, 'web');
  }
  return { reply, toolsUsed: ['search_leads'], provider: 'stub', conversationId: opts.conversationId };
};
const pavlexRoutes = require('../routes/pavlex');
const { apiRouter } = require('../routes/pavlexChatPage');

function buildApp() {
  const app = express();
  app.use((req, res, next) => {
    const email = String(req.headers['x-test-user'] || OWNER);
    req.user = { email, emails: [{ value: email }] };
    req.workspaceId = String(req.headers['x-test-ws'] || 'ws_route');
    req.workspace = { id: req.workspaceId, name: 'Route WS' };
    req.workspaceRole = 'owner';
    req.canManageWorkspace = true;
    next();
  });
  app.use('/api/pavlex', pavlexRoutes);
  app.use('/api/pavlex', apiRouter);
  return app;
}

async function withServer(fn) {
  const server = http.createServer(buildApp());
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function call(base, method, url, body, headers = {}) {
  return fetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  }).then(async (r) => ({ status: r.status, body: await r.json() }));
}

test('chat page API: new chat auto-creates, continues, lists, and rejects foreign ids', async () => {
  await withServer(async (base) => {
    stubCalls = [];
    const first = await call(base, 'POST', '/api/pavlex/chat', { message: 'What should I work on today?', platform: 'chat' });
    assert.equal(first.status, 200);
    assert.equal(first.body.reply, 'Echo: What should I work on today?');
    const id = first.body.conversation.id;
    assert.equal(first.body.conversation.title, 'What should I work on today?');
    assert.equal(stubCalls[0].platform, 'chat');
    assert.equal(stubCalls[0].persistHistory, true);

    const second = await call(base, 'POST', '/api/pavlex/chat', { message: 'And tomorrow?', platform: 'chat', conversationId: id });
    assert.equal(second.status, 200);
    assert.equal(second.body.conversation.messageCount, 4);
    assert.deepEqual(
      stubCalls[1].history.map((m) => m.role),
      ['user', 'assistant'],
      'server replays stored history',
    );

    const list = await call(base, 'GET', '/api/pavlex/conversations');
    assert.equal(list.body.conversations.length, 1);

    const msgs = await call(base, 'GET', `/api/pavlex/conversations/${id}/messages`);
    assert.equal(msgs.body.messages.length, 4);
    assert.deepEqual(msgs.body.messages[1].toolsUsed, ['search_leads']);

    const foreignUser = await call(base, 'POST', '/api/pavlex/chat', { message: 'hi', platform: 'chat', conversationId: id }, { 'x-test-user': MATE });
    assert.equal(foreignUser.status, 404);
    const foreignWs = await call(base, 'GET', `/api/pavlex/conversations/${id}/messages`, null, { 'x-test-ws': 'ws_elsewhere' });
    assert.equal(foreignWs.status, 404);
    const foreignDelete = await call(base, 'DELETE', `/api/pavlex/conversations/${id}`, null, { 'x-test-user': MATE });
    assert.equal(foreignDelete.status, 404);
    assert.equal((await call(base, 'GET', '/api/pavlex/conversations', null, { 'x-test-user': MATE })).body.conversations.length, 0);

    const renamed = await call(base, 'PATCH', `/api/pavlex/conversations/${id}`, { title: 'Daily plan', pinned: true });
    assert.equal(renamed.body.conversation.title, 'Daily plan');
    assert.equal(renamed.body.conversation.pinned, true);

    const del = await call(base, 'DELETE', `/api/pavlex/conversations/${id}`);
    assert.equal(del.status, 200);
    assert.equal((await call(base, 'GET', `/api/pavlex/conversations/${id}/messages`)).status, 404);
  });
});

test('chat page API: failed first message does not leave an empty chat behind', async () => {
  await withServer(async (base) => {
    const before = (await call(base, 'GET', '/api/pavlex/conversations', null, { 'x-test-ws': 'ws_fail' })).body.conversations.length;
    const res = await call(base, 'POST', '/api/pavlex/chat', { message: 'boom', platform: 'chat' }, { 'x-test-ws': 'ws_fail' });
    assert.equal(res.status, 502);
    const after = (await call(base, 'GET', '/api/pavlex/conversations', null, { 'x-test-ws': 'ws_fail' })).body.conversations.length;
    assert.equal(after, before);

    const created = await call(base, 'POST', '/api/pavlex/conversations', {}, { 'x-test-ws': 'ws_fail' });
    assert.equal(created.status, 201);
    assert.match(created.body.conversation.id, /^c_/);
  });
});

test('floating widget (global platform, no conversation) is unchanged', async () => {
  await withServer(async (base) => {
    stubCalls = [];
    const res = await call(base, 'POST', '/api/pavlex/chat', { message: 'hello', platform: 'global' }, { 'x-test-ws': 'ws_float' });
    assert.equal(res.status, 200);
    assert.equal(res.body.conversation, undefined);
    assert.equal(stubCalls[0].conversationId, undefined);
    assert.equal((await call(base, 'GET', '/api/pavlex/conversations', null, { 'x-test-ws': 'ws_float' })).body.conversations.length, 0);
  });
});
