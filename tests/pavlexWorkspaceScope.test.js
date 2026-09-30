const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pavlex-scope-'));
process.env.APP_DATA_DIR = tmpDataDir;

const test = require('node:test');
const assert = require('node:assert/strict');
const dbService = require('../services/database');
const { pinPavlexWorkspace, pavlexChatChannel } = require('../services/pavlex/pavlexWorkspaceScope');

const OWNER = 'owner@example.com';

function reqFor(workspace) {
  return {
    user: { email: OWNER, emails: [{ value: OWNER }] },
    workspace,
    workspaceId: workspace.id,
    workspaceRole: 'owner',
    canManageWorkspace: true,
  };
}

test('chat history channel is separate per workspace and per user', () => {
  const a = pavlexChatChannel('ws_flooring', OWNER);
  const b = pavlexChatChannel('ws_new', OWNER);
  const c = pavlexChatChannel('ws_new', 'teammate@example.com');
  assert.notEqual(a, b);
  assert.notEqual(b, c);
  assert.equal(pavlexChatChannel('ws_new', 'Owner@Example.com'), b);

  dbService.saveChatMessage(a, 'user', 'flooring message', 'web');
  assert.equal(dbService.getChatHistory(b, 50).length, 0);
  assert.equal(dbService.getChatHistory(a, 50).length, 1);
});

test('pinPavlexWorkspace switches the request to the page workspace', async () => {
  const flooring = { id: 'ws_flooring', name: 'Flooring', ownerUserId: OWNER, members: { [OWNER]: { role: 'owner' } } };
  const fresh = { id: 'ws_new', name: 'Trades', ownerUserId: OWNER, members: { [OWNER]: { role: 'owner' } } };
  await dbService.saveWorkspace(flooring.id, flooring);
  await dbService.saveWorkspace(fresh.id, fresh);

  const req = reqFor(flooring);
  assert.equal(await pinPavlexWorkspace(req, 'ws_new'), true);
  assert.equal(req.workspaceId, 'ws_new');
  assert.equal(req.workspace.name, 'Trades');
  assert.equal(req.canManageWorkspace, true);

  assert.equal(await pinPavlexWorkspace(req, ''), false);
  assert.equal(req.workspaceId, 'ws_new');
});

test('pinPavlexWorkspace refuses workspaces the user cannot access', async () => {
  const other = { id: 'ws_other', name: 'Other', ownerUserId: 'someone@else.com', members: {} };
  await dbService.saveWorkspace(other.id, other);
  const req = reqFor({ id: 'ws_flooring', name: 'Flooring' });
  await assert.rejects(() => pinPavlexWorkspace(req, 'ws_other'), (err) => err.status === 403);
  assert.equal(req.workspaceId, 'ws_flooring');
});
