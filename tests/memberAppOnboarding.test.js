const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.APP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'member-app-onboarding-'));

const test = require('node:test');
const assert = require('node:assert/strict');
const memberAppOnboarding = require('../services/memberAppOnboarding');
const push = require('../services/pushNotifications');

test('setup checklist brands before Home Screen', () => {
  assert.equal(memberAppOnboarding.STEPS.length, 5);
  assert.deepEqual(
    memberAppOnboarding.STEPS.map((s) => s.id),
    ['profile', 'branding', 'review_links', 'notifications', 'home_screen'],
  );
  assert.ok(memberAppOnboarding.BRAND_ACCENT_PRESETS.length >= 5);
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
  assert.equal(list.steps.find((s) => s.id === 'branding').done, false);
  assert.equal(list.installLocked, true);
  assert.equal(list.steps.find((s) => s.id === 'home_screen').installLocked, true);
  assert.equal(list.steps.find((s) => s.id === 'home_screen').action, 'branding');
  assert.equal(list.next.id, 'branding');
});

test('brandingComplete after name, accent, and image', () => {
  const member = {
    id: 'm_brand',
    companyName: 'Acme HVAC',
    contactName: 'Pat',
    phone: '555',
    reviewLinks: { google: 'https://g.page/x/review', other: [] },
    brandAppName: 'Acme Reviews',
    brandAccent: '#0EA5E9',
    brandSavedAt: '2026-11-22T00:00:00.000Z',
    heroUpdatedAt: '2026-11-22T00:00:00.000Z',
    joinedAt: new Date().toISOString(),
    plan: 'app_free',
    setupChecklist: { dismissedAt: '', marked: {} },
  };
  push.saveMemberSubscription({
    subscription: {
      endpoint: 'https://push.example.com/onboard',
      keys: { p256dh: 'p', auth: 'a' },
    },
    networkId: 'n_brand',
    memberId: 'm_brand',
  });
  const list = memberAppOnboarding.buildChecklist({
    member,
    network: { id: 'n_brand' },
    base: '/m/tok',
  });
  assert.equal(list.brandingComplete, true);
  assert.equal(list.installLocked, false);
  assert.equal(list.steps.find((s) => s.id === 'branding').done, true);
  assert.equal(list.steps.find((s) => s.id === 'notifications').done, true);
  assert.equal(list.steps.find((s) => s.id === 'home_screen').done, false);
  assert.equal(list.steps.find((s) => s.id === 'home_screen').action, 'install');

  const marked = memberAppOnboarding.markStep(member.setupChecklist, 'home_screen');
  const after = memberAppOnboarding.buildChecklist({
    member: { ...member, setupChecklist: marked },
    network: { id: 'n_brand' },
    base: '/m/tok',
  });
  assert.equal(after.allDone, true);
  assert.equal(after.show, false);
});

test('paid partners also brand before install (Reviews is the front gate)', () => {
  const member = {
    id: 'm_partner',
    companyName: 'Partner Co',
    contactName: 'Sam',
    phone: '555',
    reviewLinks: {},
    joinedAt: new Date().toISOString(),
    plan: '',
    setupChecklist: { dismissedAt: '', marked: {} },
  };
  const list = memberAppOnboarding.buildChecklist({
    member,
    network: { id: 'n1' },
    base: '/m/tok',
  });
  assert.equal(list.brandingComplete, false);
  assert.equal(list.installLocked, true);
  assert.equal(list.steps.find((s) => s.id === 'branding').done, false);

  const branded = {
    ...member,
    brandAppName: 'Partner Co',
    brandAccent: '#111827',
    brandSavedAt: '2026-11-22T12:00:00.000Z',
    profilePhotoUpdatedAt: '2026-11-22T12:00:00.000Z',
  };
  const after = memberAppOnboarding.buildChecklist({
    member: branded,
    network: { id: 'n1' },
    base: '/m/tok',
  });
  assert.equal(after.brandingComplete, true);
  assert.equal(after.installLocked, false);
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

test('Home and routes expose branding-before-install setup', () => {
  const home = fs.readFileSync(path.join(__dirname, '../views/member_app/home.ejs'), 'utf8');
  const partial = fs.readFileSync(path.join(__dirname, '../views/member_app/_onboarding.ejs'), 'utf8');
  const route = fs.readFileSync(path.join(__dirname, '../routes/memberApp.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '../public/css/member-app.css'), 'utf8');
  const service = fs.readFileSync(path.join(__dirname, '../services/memberAppOnboarding.js'), 'utf8');
  const js = fs.readFileSync(path.join(__dirname, '../public/js/member-app.js'), 'utf8');
  assert.match(home, /_onboarding/);
  assert.match(partial, /Get set up/);
  assert.match(partial, /Brand your Reviews app/);
  assert.match(partial, /data-ma-onboard-action="branding"/);
  assert.match(partial, /data-ma-install-locked/);
  assert.match(partial, /maBrandSheet/);
  assert.match(partial, /brandAccent/);
  assert.match(service, /Brand your app/);
  assert.match(service, /installLocked/);
  assert.match(service, /brandingComplete/);
  assert.match(route, /setup\/branding/);
  assert.match(route, /brandSavedAt/);
  assert.match(route, /Finish branding/);
  assert.match(css, /\.ma-brand-sheet/);
  assert.match(js, /installLockedByOnboarding/);
});

test('Reviews email Day 1 asks for branding before Home Screen', () => {
  const cfg = require('../services/reviewsOnboardingConfig');
  assert.match(cfg.DEFAULT_STEPS[0].body, /profile/i);
  assert.match(cfg.DEFAULT_STEPS[0].body, /Brand your app/i);
  assert.match(cfg.DEFAULT_STEPS[0].body, /colors/i);
  assert.match(cfg.DEFAULT_STEPS[0].body, /Home Screen/i);
  assert.match(cfg.DEFAULT_STEPS[0].body, /before you save it to your phone/i);
});

test('free-app brandView uses saved name and accent', () => {
  const networkBrand = require('../services/networkBrand');
  const brand = networkBrand.brandView(
    { id: 'n1', name: 'Host Agency', brand: { appName: 'Agency', accent: '#111111' } },
    {
      plan: 'app_free',
      companyName: 'Acme HVAC',
      brandAppName: 'Acme Pro',
      brandAccent: '#0ea5e9',
    },
  );
  assert.equal(brand.appName, 'Acme Pro');
  assert.equal(brand.heroName, 'Acme Pro');
  assert.equal(brand.accent, '#0ea5e9');
  assert.equal(brand.isFreeApp, true);

  const unset = networkBrand.brandView(
    { id: 'n1', name: 'Host Agency' },
    { plan: 'app_free', companyName: 'Sunrise HVAC' },
  );
  assert.equal(unset.appName, 'AdHello Reviews App');
  assert.equal(unset.heroName, 'Sunrise HVAC');
  assert.equal(unset.accent, '#FFDB3A');

  const paid = networkBrand.brandView(
    { id: 'n1', name: 'Agency Net', brand: { appName: 'Agency Net', accent: '#111111' } },
    {
      plan: '',
      companyName: 'Partner Co',
      brandAppName: 'Partner Pro',
      brandAccent: '#10b981',
      brandSavedAt: '2026-11-22T12:00:00.000Z',
    },
  );
  assert.equal(paid.appName, 'Partner Pro');
  assert.equal(paid.accent, '#10b981');
  assert.equal(paid.memberBranded, true);
});
