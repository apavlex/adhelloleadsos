const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.APP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-personal-leads-'));

const test = require('node:test');
const assert = require('node:assert/strict');
const dbService = require('../services/database');
const teamActivity = require('../services/teamActivity');
const { executeCrmTool } = require('../services/mcp/mcpToolExecutor');

const ME = 'alex@example.com';
const MARIA = 'maria@example.com';
const WID = 'ws_personal';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const keys = {};

function asUser(email) {
  return { workspaceId: WID, actor: { email, name: '', avatar: '' } };
}

async function bookmark(email, key, on = true) {
  await dbService.updateLead(key, { bookmarked: on }, WID);
  teamActivity.record(asUser(email), { category: 'leads', action: 'lead_edit', summary: on ? 'Bookmarked' : 'Removed bookmark', leadKey: key });
  await sleep(3);
}

async function list(args, email = ME) {
  const res = await executeCrmTool({ workspaceId: WID, userEmail: email }, 'list_leads', args);
  assert.equal(res.success, true, res.error);
  return res;
}
const titles = (res) => res.leads.map((l) => l.title).sort();

test.before(async () => {
  await dbService.saveWorkspace(WID, {
    id: WID,
    name: 'Personal WS',
    ownerUserId: ME,
    members: { [ME]: { role: 'owner', name: 'Alex' }, [MARIA]: { role: 'member', name: 'Maria Lopez' } },
  });
  for (const [id, title, totalScore, reviewsCount, phone] of [
    ['a', 'Acme Roofing', 4.8, 120, '+15555550101'],
    ['b', 'Best Plumbing', 4.1, 15, '+15555550102'],
    ['c', 'City HVAC', 4.9, 300, '+15555550103'],
    ['d', 'Delta Electric', 3.9, 8, '+15555550104'],
    ['e', 'Echo Painting', 4.6, 40, '+15555550105'],
  ]) {
    // eslint-disable-next-line no-await-in-loop
    keys[id] = (await dbService.saveLeadWithMeta({ workspaceId: WID, title, totalScore, reviewsCount, phone })).key;
    // eslint-disable-next-line no-await-in-loop
    await sleep(2);
  }
  await bookmark(ME, keys.a);
  await bookmark(ME, keys.b);
  await bookmark(ME, keys.b, false);
  await bookmark(MARIA, keys.c);
  const tagged = await executeCrmTool({ workspaceId: WID, userEmail: ME, clientName: 'Muse', viaMcp: true }, 'tag_leads', {
    lead_ids: [keys.d],
    add: ['Hot'],
  });
  assert.equal(tagged.success, true, tagged.error);
  await sleep(3);
  teamActivity.record(asUser(ME), { category: 'notes', action: 'note_add', summary: 'Note: call Tuesday', leadKey: keys.e });
});

test('bookmarked_by "me" finds only leads I bookmarked and still are bookmarked', async () => {
  const mine = await list({ bookmarked_by: 'me' });
  assert.deepEqual(titles(mine), ['Acme Roofing']);
  assert.equal(mine.filters.bookmarked_by, 'you');
  assert.equal(mine.leads[0].last_action.by, 'you');

  assert.deepEqual(titles(await list({ bookmarked_only: true })), ['Acme Roofing', 'City HVAC']);
  assert.deepEqual(titles(await list({ bookmarked_by: 'Maria' })), ['City HVAC']);
  assert.deepEqual(titles(await list({ bookmarked_by: 'me' }, MARIA)), ['City HVAC'], '"me" is whoever is signed in');
});

test('tagged_by and tag use tag names, including tags an assistant added at my request', async () => {
  const mine = await list({ tagged_by: 'me' });
  assert.deepEqual(titles(mine), ['Delta Electric']);
  assert.deepEqual(mine.leads[0].tag_names, ['Hot']);
  assert.deepEqual(titles(await list({ tag: 'hot' })), ['Delta Electric']);
  assert.deepEqual(titles(await list({ tagged_by: 'Muse' })), ['Delta Electric']);
  assert.equal((await list({ tagged_by: 'Maria' })).leads.length, 0);

  const missing = await executeCrmTool({ workspaceId: WID, userEmail: ME }, 'list_leads', { tag: 'Nope' });
  assert.equal(missing.success, false);
  assert.match(missing.error, /Tags: Hot/);
});

test('worked_by "me" = leads I reviewed or touched, newest first, combinable with Google review filters', async () => {
  const worked = await list({ worked_by: 'me' });
  assert.equal(worked.sort, 'recent');
  assert.deepEqual(worked.leads.map((l) => l.title), ['Echo Painting', 'Delta Electric', 'Best Plumbing', 'Acme Roofing']);
  assert.equal(worked.leads[0].last_action.summary, 'Note: call Tuesday');

  assert.deepEqual(titles(await list({ worked_by: 'me', min_rating: 4.5 })), ['Acme Roofing', 'Echo Painting']);
  assert.deepEqual(titles(await list({ min_reviews: 100 })), ['Acme Roofing', 'City HVAC']);
  assert.deepEqual(titles(await list({ max_reviews: 10 })), ['Delta Electric']);
});

test('unknown people and filterless calls explain what to pass', async () => {
  const who = await executeCrmTool({ workspaceId: WID, userEmail: ME }, 'list_leads', { worked_by: 'Zed' });
  assert.equal(who.success, false);
  assert.match(who.error, /Maria Lopez/);
  const bare = await executeCrmTool({ workspaceId: WID, userEmail: ME }, 'list_leads', {});
  assert.equal(bare.success, false);
  assert.match(bare.error, /bookmarked_by/);
});

test('the filters are published to MCP clients', async () => {
  const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
  const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
  const { createCrmMcpServer, getOpenAiToolManifest } = require('../services/mcp/mcpServerFactory');
  const server = createCrmMcpServer({ workspaceId: WID, userEmail: ME });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: 'test', version: '1' });
  await client.connect(clientSide);
  const { tools } = await client.listTools();
  const props = tools.find((t) => t.name === 'list_leads').inputSchema.properties;
  for (const p of ['bookmarked_by', 'tagged_by', 'worked_by', 'tag', 'min_rating']) assert.ok(props[p], p);
  const result = await client.callTool({ name: 'list_leads', arguments: { bookmarked_by: 'me' } });
  assert.equal(JSON.parse(result.content[0].text).leads[0].title, 'Acme Roofing');
  await client.close();
  const manifest = getOpenAiToolManifest().tools.find((t) => t.name === 'list_leads');
  assert.ok(manifest.input_schema.properties.worked_by);
});
