const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.APP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'member-app-onboarding-'));

const test = require('node:test');
const assert = require('node:assert/strict');
const memberAppOnboarding = require('../services/memberAppOnboarding');
const push = require('../services/pushNotifications');

test('setup checklist has the five signup steps', () => {
  assert.equal(memberAppOnboarding.STEPS.length, 5);
  assert.deepEqual(
    memberAppOnboarding.STEPS.map((s) => s.id),
    ['profile', 'review_links', 'banner', 'notifications', 'home_screen'],
  );
});

test('buildChecklist marks profile and review links from member data', () => {
  const member = {
    id: 'm1',
    companyName: 'Acme HVAC',
    contactName: 'Pat',
    phone: '+15551234567',
    email: '',
    reviewLinks: { google: 'https://g.page/acme/review', other: [] },
    heroUpdatedAt: '',
    joinedAt: new Date().toISOString(),
    plan: 'app_free',
    setupChecklist: { dismissedAt: '', marked: {} },
  };
  const list = memberAppOnboarding.buildChecklist({
    member,
    network: { id: 'n1' },
    base: '/m/tok',
  });
  assert.equal(list.show, true);
  assert.equal(list.steps.find((s) => s.id === 'profile').done, true);
  assert.equal(list.steps.find((s) => s.id === 'review_links').done, true);
  assert.equal(list.steps.find((s) => s.id === 'banner').done, false);
  assert.equal(list.steps.find((s) => s.id === 'notifications').done, false);
  assert.equal(list.doneCount, 2);
  assert.equal(list.next.id, 'banner');
});

test('banner and notifications complete from hero stamp and push subscription', () => {
  const member = {
    id: 'm_push',
    companyName: 'Acme',
    contactName: 'Pat',
    phone: '555',
    reviewLinks: { google: 'https://g.page/x/review', other: [] },
    heroUpdatedAt: '2026-10-23T00:00:00.000Z',
    joinedAt: new Date().toISOString(),
    plan: 'app_free',
    setupChecklist: { dismissedAt: '', marked: {} },
  };
  push.saveMemberSubscription({
    subscription: {
      endpoint: 'https://push.example.com/onboard',
      keys: { p256dh: 'p', auth: 'a' },
    },
    networkId: 'n_push',
    memberId: 'm_push',
  });
  const list = memberAppOnboarding.buildChecklist({
    member,
    network: { id: 'n_push' },
    base: '/m/tok',
  });
  assert.equal(list.steps.find((s) => s.id === 'banner').done, true);
  assert.equal(list.steps.find((s) => s.id === 'notifications').done, true);
  assert.equal(list.steps.find((s) => s.id === 'home_screen').done, false);

  const marked = memberAppOnboarding.markStep(member.setupChecklist, 'home_screen');
  const after = memberAppOnboarding.buildChecklist({
    member: { ...member, setupChecklist: marked },
    network: { id: 'n_push' },
    base: '/m/tok',
  });
  assert.equal(after.allDone, true);
  assert.equal(after.show, false);
});

test('dismiss hides the checklist', () => {
  const member = {
    id: 'm2',
    companyName: 'Acme',
    contactName: 'Pat',
    phone: '555',
    reviewLinks: {},
    joinedAt: new Date().toISOString(),
    plan: 'app_free',
    setupChecklist: { dismissedAt: '', marked: {} },
  };
  const dismissed = memberAppOnboarding.dismiss(member.setupChecklist);
  const list = memberAppOnboarding.buildChecklist({
    member: { ...member, setupChecklist: dismissed },
    network: { id: 'n1' },
    base: '/m/tok',
  });
  assert.equal(list.show, false);
  assert.equal(list.dismissed, true);
});

test('checklist only shows for new first-time members', () => {
  const fresh = {
    id: 'm_new',
    companyName: 'Acme',
    contactName: 'Pat',
    phone: '555',
    reviewLinks: {},
    joinedAt: new Date().toISOString(),
    plan: 'app_free',
    setupChecklist: { dismissedAt: '', marked: {} },
  };
  assert.equal(
    memberAppOnboarding.buildChecklist({ member: fresh, network: { id: 'n1' }, base: '/m/tok' }).show,
    true,
  );

  const oldJoin = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
  const veteran = { ...fresh, id: 'm_old', joinedAt: oldJoin, plan: 'app_flooring' };
  assert.equal(
    memberAppOnboarding.buildChecklist({ member: veteran, network: { id: 'n1' }, base: '/m/tok' }).show,
    false,
  );

  const noJoin = { ...fresh, id: 'm_none', joinedAt: '' };
  assert.equal(
    memberAppOnboarding.buildChecklist({ member: noJoin, network: { id: 'n1' }, base: '/m/tok' }).show,
    false,
  );
});

test('Home and routes expose the setup checklist', () => {
  const home = fs.readFileSync(path.join(__dirname, '../views/member_app/home.ejs'), 'utf8');
  const partial = fs.readFileSync(path.join(__dirname, '../views/member_app/_onboarding.ejs'), 'utf8');
  const route = fs.readFileSync(path.join(__dirname, '../routes/memberApp.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '../public/css/member-app.css'), 'utf8');
  const service = fs.readFileSync(path.join(__dirname, '../services/memberAppOnboarding.js'), 'utf8');
  assert.match(home, /_onboarding/);
  assert.match(home, /id="ma-onboarding-banner"/);
  assert.match(partial, /Get set up/);
  assert.match(partial, /data-ma-onboard-step/);
  assert.match(partial, /data-ma-onboard-action="notifications"/);
  assert.match(partial, /data-ma-install-open/);
  assert.match(partial, /data-ma-onboard-done/);
  assert.match(partial, /data-ma-onboard-progress/);
  assert.match(service, /Fill out your profile/);
  assert.match(service, /Add review links/);
  assert.match(service, /banner image/i);
  assert.match(service, /phone alerts/i);
  assert.match(service, /Home Screen/);
  assert.match(service, /isNewFirstTimeMember|firstOpenedAt|SHOW_DAYS/);
  assert.match(route, /setupChecklist/);
  assert.match(route, /markFirstOpened/);
  assert.match(route, /\/setup\/step/);
  assert.match(route, /\/setup\/dismiss/);
  assert.match(css, /\.ma-onboard__/);
});

test('Reviews email Day 1 points at the in-app setup checklist', () => {
  const cfg = require('../services/reviewsOnboardingConfig');
  assert.match(cfg.DEFAULT_STEPS[0].body, /profile/i);
  assert.match(cfg.DEFAULT_STEPS[0].body, /review links/i);
  assert.match(cfg.DEFAULT_STEPS[0].body, /banner/i);
  assert.match(cfg.DEFAULT_STEPS[0].body, /alerts/i);
  assert.match(cfg.DEFAULT_STEPS[0].body, /Home Screen/i);
});
