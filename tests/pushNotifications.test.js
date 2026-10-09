const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.APP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'push-notifications-'));

const test = require('node:test');
const assert = require('node:assert/strict');
const webpush = require('web-push');
const dbService = require('../services/database');
const push = require('../services/pushNotifications');
const { runTaskPushReminders, dueReminders } = require('../services/taskPushReminders');

const subscription = (n) => ({
  endpoint: `https://push.example.com/send/${n}`,
  keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
});

test('a public VAPID key is generated once and reused', () => {
  const key = push.publicKey();
  assert.ok(key.length > 40);
  assert.equal(push.publicKey(), key);
});

test('subscriptions are stored per user and remember each workspace they were used in', () => {
  assert.equal(push.saveSubscription({ subscription: { endpoint: 'nope' }, userEmail: 'a@x.com' }).ok, false);
  push.saveSubscription({ subscription: subscription(1), userEmail: 'Owner@Example.com', workspaceId: 'ws_a' });
  push.saveSubscription({ subscription: subscription(1), userEmail: 'owner@example.com', workspaceId: 'ws_b' });

  const [sub] = push.matchingSubscriptions({ userEmail: 'owner@example.com' });
  assert.deepEqual(sub.workspaceIds.sort(), ['ws_a', 'ws_b']);
  assert.equal(push.matchingSubscriptions({ workspaceId: 'ws_c' }).length, 0);
  assert.equal(push.matchingSubscriptions({}).length, 0);
});

test('contractor portal subscriptions are scoped by package and get new-lead pushes', async (t) => {
  assert.equal(
    push.savePortalSubscription({ subscription: subscription(9), workspaceId: 'ws_a' }).ok,
    false,
  );
  push.savePortalSubscription({
    subscription: subscription(9),
    workspaceId: 'ws_a',
    packageId: 'pkg_electrician',
  });
  assert.equal(push.matchingPortalSubscriptions({ packageId: 'pkg_electrician' }).length, 1);
  assert.equal(push.matchingPortalSubscriptions({ packageId: 'pkg_other' }).length, 0);

  const sent = [];
  t.mock.method(webpush, 'sendNotification', async (sub, body) => {
    sent.push({ endpoint: sub.endpoint, body: JSON.parse(body) });
  });
  const result = await push.notifyContractorNewLead({
    workspaceId: 'ws_a',
    packageId: 'pkg_electrician',
    businessName: 'Spark Electric',
    leadName: 'Jane Homeowner',
    formName: 'Website quote',
    preview: 'Needs panel upgrade',
    url: '/p/token/leads',
  });
  assert.equal(result.sent, 1);
  assert.match(sent[0].body.title, /Spark Electric/);
  assert.match(sent[0].body.body, /Website quote/);
  assert.equal(sent[0].body.url, '/p/token/leads');
});

test('a finished search pushes to its owner and drops subscriptions the push service says are gone', async (t) => {
  push.saveSubscription({ subscription: subscription(2), userEmail: 'gone@example.com', workspaceId: 'ws_a' });
  const sent = [];
  t.mock.method(webpush, 'sendNotification', async (sub, body) => {
    if (sub.endpoint.endsWith('/2')) {
      const err = new Error('Gone');
      err.statusCode = 410;
      throw err;
    }
    sent.push({ endpoint: sub.endpoint, body: JSON.parse(body) });
  });

  await push.notifyJobFinished({ workspaceId: 'ws_a', status: 'completed', keyword: 'interior design', city: 'Camas', state: 'WA', resultCount: 12, searchKey: 'search:1' });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].body.title, 'Search finished');
  assert.match(sent[0].body.body, /"interior design" in Camas, WA · 12 leads found/);
  assert.equal(sent[0].body.url, '/search/search%3A1');
  assert.equal(push.matchingSubscriptions({ userEmail: 'gone@example.com' }).length, 0);

  sent.length = 0;
  await push.notifyJobFinished({ workspaceId: 'ws_a', status: 'failed', error: 'No businesses found.', keyword: 'roofers', createdBy: 'owner@example.com' });
  assert.equal(sent[0].body.title, 'Search failed');
  assert.equal(sent[0].body.url, '/history');
});

test('task reminders fire once when due, skip done tasks and very old ones', () => {
  const now = Date.parse('2026-10-01T15:00:00Z');
  const task = (scheduledAt, extra = {}) => ({ id: 't1', title: 'Call back Studio Nine', scheduledAt, column: 'todo', source: 'manual', ...extra });

  assert.deepEqual(dueReminders(task('2026-10-01T14:59:00Z'), now), ['due']);
  assert.deepEqual(dueReminders(task('2026-10-01T15:10:00Z', { remindMinutesBefore: 15 }), now), ['early']);
  assert.deepEqual(dueReminders(task('2026-10-01T14:59:00Z', { column: 'done' }), now), []);
  assert.deepEqual(dueReminders(task('2026-10-01T13:00:00Z'), now), []);
  assert.deepEqual(dueReminders(task('2026-10-01T16:00:00Z'), now), []);
});

test('the reminder job pushes a due task to its owner exactly once', async (t) => {
  const sent = [];
  t.mock.method(webpush, 'sendNotification', async (sub, body) => sent.push(JSON.parse(body)));
  const now = Date.now();
  await dbService.saveUserTask('ws_a', 'owner@example.com', {
    id: 'task_push_1',
    title: 'Call back Studio Nine',
    column: 'todo',
    source: 'manual',
    scheduledAt: new Date(now - 60 * 1000).toISOString(),
  });

  await runTaskPushReminders(now);
  await runTaskPushReminders(now + 60 * 1000);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].title, 'Task reminder');
  assert.equal(sent[0].body, 'Call back Studio Nine');
});
