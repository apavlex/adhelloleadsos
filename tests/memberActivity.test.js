/**
 * Member-app lead bell: in-app activity feed + phone alert on/off UI wiring.
 */
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const dbService = require('../services/database');
const memberActivity = require('../services/memberActivity');

describe('memberActivity store', () => {
  const nid = 'net_bell_test';
  const mid = 'mem_bell_test';

  beforeEach(() => {
    dbService.deleteKvSync(`memberActivity:${nid}:${mid}`);
  });

  it('adds lead alerts, tracks unread, and marks read', () => {
    const a = memberActivity.add(nid, mid, {
      kind: 'form',
      title: 'New website lead',
      body: 'Jordan · Roof quote',
      href: '/m/tok/referrals',
    });
    assert.ok(a && a.id);
    assert.equal(a.read, false);
    assert.equal(a.kind, 'form');
    assert.equal(memberActivity.unreadCount(nid, mid), 1);

    memberActivity.add(nid, mid, {
      kind: 'referral',
      title: 'New referral',
      body: 'Handyman job for Sam',
      href: '/m/tok/referrals',
    });
    assert.equal(memberActivity.list(nid, mid).length, 2);
    assert.equal(memberActivity.unreadCount(nid, mid), 2);

    const { updated } = memberActivity.markAllRead(nid, mid);
    assert.equal(updated, 2);
    assert.equal(memberActivity.unreadCount(nid, mid), 0);
    assert.ok(memberActivity.list(nid, mid).every((e) => e.read));
    // Read items stay in the inbox until Done / Clear.
    assert.equal(memberActivity.listInbox(nid, mid).length, 2);
    assert.equal(memberActivity.listHistory(nid, mid).length, 0);
  });

  it('Clear / Done moves inbox alerts into History', () => {
    const a = memberActivity.add(nid, mid, { kind: 'sms', title: 'Text: Pat' });
    const b = memberActivity.add(nid, mid, { kind: 'form', title: 'New website lead' });
    assert.equal(memberActivity.listInbox(nid, mid).length, 2);

    const one = memberActivity.clear(nid, mid, [a.id]);
    assert.equal(one.updated, 1);
    assert.equal(memberActivity.listInbox(nid, mid).length, 1);
    assert.equal(memberActivity.listInbox(nid, mid)[0].id, b.id);
    assert.equal(memberActivity.listHistory(nid, mid).length, 1);
    assert.equal(memberActivity.listHistory(nid, mid)[0].id, a.id);
    assert.ok(memberActivity.listHistory(nid, mid)[0].clearedAt);

    const all = memberActivity.clearAll(nid, mid);
    assert.equal(all.updated, 1);
    assert.equal(memberActivity.listInbox(nid, mid).length, 0);
    assert.equal(memberActivity.listHistory(nid, mid).length, 2);
    assert.equal(memberActivity.unreadCount(nid, mid), 0);
  });

  it('rejects empty titles and strips unsafe hrefs', () => {
    assert.equal(memberActivity.add(nid, mid, { title: '' }), null);
    const bad = memberActivity.add(nid, mid, {
      title: 'Pool lead',
      href: 'https://evil.example/phish',
    });
    assert.equal(bad.href, '');
    const ok = memberActivity.add(nid, mid, {
      title: 'Pool lead',
      href: 'https://leads.adhello.io/m/abc/referrals?view=pool',
    });
    assert.equal(ok.href, '/m/abc/referrals?view=pool');
  });

  it('marks only selected ids as read', () => {
    const first = memberActivity.add(nid, mid, { title: 'A' });
    const second = memberActivity.add(nid, mid, { title: 'B' });
    const { updated } = memberActivity.markRead(nid, mid, [first.id]);
    assert.equal(updated, 1);
    const list = memberActivity.list(nid, mid);
    assert.equal(list.find((e) => e.id === first.id).read, true);
    assert.equal(list.find((e) => e.id === second.id).read, false);
  });
});

describe('member lead bell UI + routes', () => {
  it('top bar ships Notifications panel with phone alerts on/off', () => {
    const top = fs.readFileSync(path.join(root, 'views/member_app/_top.ejs'), 'utf8');
    const css = fs.readFileSync(path.join(root, 'public/css/member-app.css'), 'utf8');
    const js = fs.readFileSync(path.join(root, 'public/js/member-app-notifications.js'), 'utf8');
    const tab = fs.readFileSync(path.join(root, 'views/member_app/_tabbar.ejs'), 'utf8');
    const icons = fs.readFileSync(path.join(root, 'services/memberAppIcons.js'), 'utf8');

    assert.match(top, /maBellRoot/);
    assert.match(top, /Lead notifications/);
    assert.match(top, /data-ma-bell-scrim/);
    assert.match(top, /data-ma-bell-push-enable/);
    assert.match(top, /data-ma-bell-ghl-toggle/);
    assert.match(top, /GHL calls &amp; texts/);
    assert.match(top, /Turn off on this device/);
    assert.match(top, /All leads &amp; referrals/);
    assert.match(top, /data-ma-bell-clear/);
    assert.match(top, /data-ma-bell-history/);
    assert.match(top, />History</);
    assert.match(tab, /member-app-notifications\.js/);
    assert.match(js, /Turn on /);
    assert.match(js, /on · Send test/);
    assert.match(js, /ma-bell-open/);
    assert.match(js, /\/activity\.json/);
    assert.match(js, /\/activity\/ghl-alerts/);
    assert.match(js, /\/activity\/clear/);
    assert.match(js, /data-ma-bell-activity-done/);
    assert.match(js, /clearInbox/);
    assert.match(js, /\/push\/subscribe/);
    assert.match(js, /\/push\/unsubscribe/);
    assert.match(css, /\.ma-bell__panel/);
    assert.match(css, /\.ma-bell__scrim/);
    assert.match(css, /\.ma-bell__ghl/);
    assert.match(css, /\.ma-bell__clear/);
    assert.match(css, /background:\s*#ffffff/);
    assert.match(css, /position:\s*fixed/);
    assert.match(icons, /bell:/);
    const historyPage = fs.readFileSync(path.join(root, 'views/member_app/notifications.ejs'), 'utf8');
    assert.match(historyPage, /Notification history/);
  });

  it('memberApp exposes activity feed + push subscribe routes', () => {
    const route = fs.readFileSync(path.join(root, 'routes/memberApp.js'), 'utf8');
    assert.match(route, /require\('\.\.\/services\/memberActivity'\)/);
    assert.match(route, /require\('\.\.\/services\/memberGhlAlerts'\)/);
    assert.match(route, /\/m\/:token\/activity\.json/);
    assert.match(route, /\/m\/:token\/activity\/read/);
    assert.match(route, /\/m\/:token\/activity\/clear/);
    assert.match(route, /\/m\/:token\/notifications/);
    assert.match(route, /listInbox/);
    assert.match(route, /listHistory/);
    assert.match(route, /\/m\/:token\/activity\/ghl-alerts/);
    assert.match(route, /\/m\/:token\/activity\/ghl-done/);
    assert.match(route, /\/m\/:token\/push\/subscribe/);
    assert.match(route, /\/m\/:token\/push\/unsubscribe/);
    assert.match(route, /\/m\/:token\/push\/test/);
    assert.match(route, /Lead alerts are on/);
  });

  it('networkNotify records member activity for form leads and referrals', () => {
    const notify = fs.readFileSync(path.join(root, 'services/networkNotify.js'), 'utf8');
    assert.match(notify, /function recordMemberActivity/);
    assert.match(notify, /memberActivity\.add/);
    assert.match(notify, /kind:\s*'referral'/);
    assert.match(notify, /kind:\s*'pool'/);
    assert.match(notify, /kind:\s*source === 'agency' \? 'agency' : 'form'/);
  });
});
