const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.APP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'network-broadcast-'));

const test = require('node:test');
const assert = require('node:assert/strict');
const webpush = require('web-push');
const dbService = require('../services/database');
const push = require('../services/pushNotifications');
const memberActivity = require('../services/memberActivity');
const networkBroadcast = require('../services/networkBroadcast');
const networkNews = require('../services/networkNews');
const networkNotify = require('../services/networkNotify');

const subscription = (n) => ({
  endpoint: `https://push.example.com/member/${n}`,
  keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
});

test('parseChannels and audience helpers', () => {
  assert.deepEqual(networkBroadcast.parseChannels({ channelApp: '1' }), { app: true, sms: false });
  assert.deepEqual(networkBroadcast.parseChannels({ channelSms: 'on' }), { app: false, sms: true });
  assert.deepEqual(networkBroadcast.parseChannels({ channels: { app: true, sms: true } }), { app: true, sms: true });
  assert.equal(networkBroadcast.parseAudience('free'), 'free');
  assert.equal(networkBroadcast.parseAudience('nope'), 'all');
  assert.equal(networkBroadcast.memberMatchesAudience({ status: 'active', plan: 'app_free' }, 'free'), true);
  assert.equal(networkBroadcast.memberMatchesAudience({ status: 'active', plan: 'app_free' }, 'partner'), false);
  assert.equal(networkBroadcast.memberMatchesAudience({ status: 'paused', plan: '' }, 'all'), false);
  assert.equal(networkBroadcast.memberMatchesAudience({ status: 'active', workspaceStaff: true }, 'all'), false);
});

test('member-scoped push subscriptions deliver phone alerts', async (t) => {
  assert.equal(
    push.saveMemberSubscription({ subscription: subscription(1), networkId: 'net_1' }).ok,
    false,
  );
  const saved = push.saveMemberSubscription({
    subscription: subscription(1),
    networkId: 'net_1',
    memberId: 'mem_1',
  });
  assert.equal(saved.ok, true);
  assert.equal(push.matchingMemberSubscriptions({ networkId: 'net_1', memberId: 'mem_1' }).length, 1);

  const sent = [];
  t.mock.method(webpush, 'sendNotification', async (sub, body) => {
    sent.push({ endpoint: sub.endpoint, body: JSON.parse(body) });
  });

  const result = await push.sendMemberPush(
    { networkId: 'net_1', memberId: 'mem_1' },
    { title: 'From agency', body: 'Hello partners', url: '/m/tok' },
  );
  assert.equal(result.sent, 1);
  assert.equal(sent[0].body.title, 'From agency');
  assert.match(sent[0].body.body, /Hello partners/);

  push.removeMemberSubscription(subscription(1).endpoint, { networkId: 'net_1', memberId: 'mem_1' });
  assert.equal(push.matchingMemberSubscriptions({ networkId: 'net_1', memberId: 'mem_1' }).length, 0);
});

test('broadcastToMembers saves news feed, inbox activity, and app push', async (t) => {
  const store = require('../services/networkStore');
  const network = {
    id: 'net_bcast',
    name: 'Test Network',
    ownerWorkspaceId: 'ws_bcast',
  };
  const members = [
    {
      id: 'm_free',
      companyName: 'Free Co',
      phone: '+15551234567',
      email: 'free@example.com',
      status: 'active',
      plan: 'app_free',
    },
    {
      id: 'm_partner',
      companyName: 'Partner Co',
      phone: '+15557654321',
      email: 'partner@example.com',
      status: 'active',
      plan: '',
    },
    {
      id: 'm_paused',
      companyName: 'Paused Co',
      status: 'paused',
      plan: '',
    },
  ];

  t.mock.method(store, 'listMembers', async () => members);
  t.mock.method(networkNotify, 'memberPortalLink', () => '/m/test-token');
  t.mock.method(networkNotify, 'messageMember', async () => ({ ok: true, channel: 'sms' }));

  push.saveMemberSubscription({
    subscription: subscription(42),
    networkId: network.id,
    memberId: 'm_free',
  });

  const sent = [];
  t.mock.method(webpush, 'sendNotification', async (sub, body) => {
    sent.push(JSON.parse(body));
  });

  const result = await networkBroadcast.broadcastToMembers({
    network,
    title: 'Friday bonus',
    message: 'Friday referral bonus is live — open the app.',
    link: 'https://example.com/bonus',
    channels: { app: true, sms: false },
    audience: 'free',
    baseUrl: 'https://reviews.adhello.io',
    createdBy: 'admin@example.com',
  });

  assert.equal(result.ok, true);
  assert.equal(result.targeted, 1);
  assert.equal(result.appDelivered, 1);
  assert.equal(result.smsSent, 0);
  assert.ok(result.post && result.post.id);
  assert.equal(sent.length, 1);
  assert.match(sent[0].body, /Friday referral bonus/);
  assert.match(sent[0].url, /\/news/);

  const feed = networkNews.list(network.id);
  assert.equal(feed.length, 1);
  assert.equal(feed[0].title, 'Friday bonus');
  assert.equal(feed[0].link, 'https://example.com/bonus');

  const inbox = memberActivity.listInbox(network.id, 'm_free');
  assert.ok(inbox.some((e) => e.kind === 'news' && /Friday referral bonus/.test(e.body)));
  assert.ok(inbox.some((e) => /\/news/.test(e.href || '')));
  assert.equal(memberActivity.listInbox(network.id, 'm_partner').length, 0);

  dbService.deleteKvSync(`memberActivity:${network.id}:m_free`);
  dbService.deleteKvSync(`networkNews:${network.id}`);
});

test('broadcast requires a channel and a message', async () => {
  const empty = await networkBroadcast.broadcastToMembers({
    network: { id: 'n1' },
    message: '   ',
    channels: { app: true, sms: false },
  });
  assert.equal(empty.ok, false);

  const noChannel = await networkBroadcast.broadcastToMembers({
    network: { id: 'n1' },
    message: 'Hi',
    channels: { app: false, sms: false },
  });
  assert.equal(noChannel.ok, false);
  assert.match(noChannel.error, /Notify by app|SMS/i);
});

test('Network members view and Reviews bell expose News & updates', () => {
  const view = fs.readFileSync(path.join(__dirname, '../views/network.ejs'), 'utf8');
  assert.match(view, /News &amp; updates/);
  assert.match(view, /\/network\/members\/broadcast/);
  assert.match(view, /name="title"/);
  assert.match(view, /channelApp/);
  assert.match(view, /channelSms/);
  assert.match(view, /Notify by app/);
  assert.match(view, /Send SMS/);

  const top = fs.readFileSync(path.join(__dirname, '../views/member_app/_top.ejs'), 'utf8');
  assert.match(top, /data-ma-bell-history/);
  assert.match(top, /data-ma-bell-news/);
  assert.match(top, /\/news/);
  assert.match(top, /News &amp; updates/);

  const newsView = fs.readFileSync(path.join(__dirname, '../views/member_app/news.ejs'), 'utf8');
  assert.match(newsView, /News &amp; updates/);
  assert.match(newsView, /ma-news-card/);
});
