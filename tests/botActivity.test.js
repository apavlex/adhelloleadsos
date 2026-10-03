const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.APP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-activity-'));

const test = require('node:test');
const assert = require('node:assert/strict');
const ejs = require('ejs');
const dbService = require('../services/database');
const teamActivity = require('../services/teamActivity');
const { executeCrmTool } = require('../services/mcp/mcpToolExecutor');

const OWNER = 'owner@example.com';
let n = 0;

async function setup() {
  n += 1;
  const wid = `ws_bot_${n}`;
  await dbService.saveWorkspace(wid, { id: wid, name: 'Bot WS', ownerUserId: OWNER, members: { [OWNER]: { role: 'owner', name: 'Alex' } } });
  const saved = await dbService.saveLeadWithMeta({ workspaceId: wid, title: 'Patrick Plumbing', phone: '+15555550100' });
  return { wid, leadKey: saved.key };
}

test('MCP bot changes are credited to the bot, with the user it acted for', async () => {
  const { wid, leadKey } = await setup();
  const ctx = { workspaceId: wid, userEmail: OWNER, clientName: 'Muse', viaMcp: true };

  const tagged = await executeCrmTool(ctx, 'tag_leads', { lead_ids: [leadKey], add: ['Hot'] });
  assert.equal(tagged.success, true, tagged.error);
  const folder = await executeCrmTool(ctx, 'create_folder', { name: 'Roofers' });
  assert.equal(folder.success, true, folder.error);

  const rows = dbService.listTeamActivity({ workspaceId: wid });
  assert.deepEqual(rows.map((r) => r.action).sort(), ['folder_create', 'lead_tags', 'tag_create']);
  assert.ok(rows.every((r) => r.actor_email === 'bot:muse' && r.actor_name === 'Muse'));
  assert.ok(rows.every((r) => r.meta.onBehalfOf === OWNER));
  const tagRow = rows.find((r) => r.action === 'lead_tags');
  assert.equal(tagRow.lead_key, leadKey);
  assert.equal(rows.find((r) => r.action === 'folder_create').summary, 'Created folder "Roofers"');

  assert.equal(dbService.getLeadAttributions(wid, [leadKey])[leadKey].last_by, 'bot:muse');
});

test('reads are not tracked; Ask AI and unnamed MCP connections get their own bot', async () => {
  const { wid, leadKey } = await setup();
  await executeCrmTool({ workspaceId: wid, userEmail: OWNER, clientName: 'Muse' }, 'list_leads', { limit: 5 });
  await executeCrmTool({ workspaceId: wid, userEmail: OWNER, clientName: 'Muse' }, 'get_lead', { lead_id: leadKey });
  assert.equal(dbService.listTeamActivity({ workspaceId: wid }).length, 0);

  await executeCrmTool({ workspaceId: wid, userEmail: OWNER }, 'bookmark_leads', { lead_ids: [leadKey] });
  await executeCrmTool({ workspaceId: wid, userEmail: OWNER, viaMcp: true }, 'bookmark_leads', { lead_ids: [leadKey], bookmarked: false });
  const actors = dbService.listTeamActivity({ workspaceId: wid }).map((r) => r.actor_email).sort();
  assert.deepEqual(actors, ['bot:ai-assistant', 'bot:ask-ai']);
});

test('tools that log their own activity are not double-counted and credit the bot', async () => {
  const { wid, leadKey } = await setup();
  const ctx = { workspaceId: wid, userEmail: OWNER, clientName: 'Grok', viaMcp: true };
  const res = await executeCrmTool(ctx, 'create_task', { title: 'Call Pat back', lead_id: leadKey });
  assert.equal(res.success, true, res.error);
  const rows = dbService.listTeamActivity({ workspaceId: wid });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].actor_email, 'bot:grok');
  assert.match(rows[0].summary, /Call Pat back/);
});

test('bots join the member directory and Team history page like teammates, but not task assignees', async () => {
  const { wid, leadKey } = await setup();
  await executeCrmTool({ workspaceId: wid, userEmail: OWNER, clientName: 'ChatGPT', viaMcp: true }, 'tag_leads', { lead_ids: [leadKey], add: ['Warm'] });
  const ws = await dbService.getWorkspace(wid);

  const dir = teamActivity.memberDirectory(ws, []);
  const bot = dir.find((m) => m.email === 'bot:chatgpt');
  assert.ok(bot, 'registered bot listed even without stats');
  assert.equal(bot.isBot, true);
  assert.equal(teamActivity.displayName(bot), 'ChatGPT');

  const team = await executeCrmTool({ workspaceId: wid, userEmail: OWNER }, 'list_team_members', {});
  assert.ok(!JSON.stringify(team).includes('bot:'), 'bots are never task assignees');

  const router = require('../routes/teamHistory');
  const layer = router.stack.find((l) => l.route && l.route.path === '/' && l.route.methods.get);
  let rendered;
  const req = { workspaceId: wid, workspace: ws, query: { member: 'all', view: 'all' }, user: { emails: [{ value: 'viewer@example.com' }] }, session: {} };
  const res = { render: (view, locals) => (rendered = { view, locals }) };
  await layer.route.stack[0].handle(req, res, (e) => {
    throw e || new Error('next called');
  });
  const item = rendered.locals.items[0];
  assert.equal(item.isBot, true);
  assert.equal(item.actorLabel, 'ChatGPT');
  assert.equal(item.onBehalfLabel, 'Alex');
  const member = rendered.locals.members.find((m) => m.email === 'bot:chatgpt');
  assert.ok(member.unseen >= 1);

  const tpl = fs.readFileSync(path.join(__dirname, '..', 'views', 'team-history.ejs'), 'utf8');
  assert.match(tpl, /m\.isBot/);
  assert.match(tpl, /it\.onBehalfLabel/);
  assert.ok(ejs.compile(tpl, { filename: path.join(__dirname, '..', 'views', 'team-history.ejs') }));
});
