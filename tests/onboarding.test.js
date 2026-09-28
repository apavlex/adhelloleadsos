const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.APP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'onboarding-'));

const test = require('node:test');
const assert = require('node:assert/strict');
const dbService = require('../services/database');
const onboardingConfig = require('../services/onboardingConfig');
const onboardingDrip = require('../services/onboardingDrip');
const activationService = require('../services/activationService');

const TZ = 'America/Los_Angeles';

test('normalizeOnboarding falls back to the default 7 steps and sanitizes input', () => {
  const def = onboardingConfig.normalizeOnboarding(null);
  assert.equal(def.enabled, true);
  assert.equal(def.sendHour, 9);
  assert.deepEqual(def.steps.map((s) => s.id), ['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7']);

  const cfg = onboardingConfig.normalizeOnboarding({
    enabled: false,
    sendHour: 42,
    steps: [
      { id: 'd1', title: 'Book a measure', href: 'javascript:alert(1)', event: 'nope', body: 'x' },
      { id: 'd1', title: 'Duplicate id', href: '/sequences', event: 'sequence_started' },
      { title: '' },
    ],
  });
  assert.equal(cfg.enabled, false);
  assert.equal(cfg.sendHour, 23);
  assert.equal(cfg.steps.length, 2);
  assert.equal(cfg.steps[0].href, '/today');
  assert.equal(cfg.steps[0].event, '');
  assert.notEqual(cfg.steps[1].id, 'd1');
  assert.equal(cfg.steps[1].event, 'sequence_started');
  assert.equal(cfg.steps[1].subject, 'Day {{day}}: Duplicate id');
});

test('renderTemplate fills merge tags and blanks unknown ones', () => {
  const out = onboardingConfig.renderTemplate('Hi {{first_name}} — {{ workspace_name }} {{unknown}}!', {
    first_name: 'Isabelle',
    workspace_name: 'Adhello Agency',
  });
  assert.equal(out, 'Hi Isabelle — Adhello Agency !');
});

test('bodyToHtml escapes text and links URLs', () => {
  const html = onboardingDrip.bodyToHtml('Hi <b>you</b>\n\nGo: https://leads.adhello.ai/today?x=1&y=2.');
  assert.match(html, /&lt;b&gt;you&lt;\/b&gt;/);
  assert.match(html, /<a href="https:\/\/leads\.adhello\.ai\/today\?x=1&amp;y=2">/);
  assert.equal((html.match(/<p /g) || []).length, 2);
});

test('nextAction: Day 1 at join, later days at the send hour, one per local day', () => {
  const cfg = onboardingConfig.normalizeOnboarding({});
  // Joined 3:00 PM Pacific on Sep 28.
  const enr = { enrolledAt: '2026-09-28T22:00:00.000Z', nextIndex: 0, lastSentAt: '' };
  assert.equal(onboardingDrip.nextAction(enr, cfg, TZ, new Date('2026-09-28T22:00:05Z')).type, 'send');

  const afterDay1 = { ...enr, nextIndex: 1, lastSentAt: '2026-09-28T22:00:05.000Z' };
  // 8:59 AM Pacific Sep 29 — still waiting.
  assert.equal(onboardingDrip.nextAction(afterDay1, cfg, TZ, new Date('2026-09-29T15:59:00Z')).type, 'wait');
  // 9:00 AM Pacific Sep 29 — Day 2 due.
  const due = onboardingDrip.nextAction(afterDay1, cfg, TZ, new Date('2026-09-29T16:00:00Z'));
  assert.equal(due.type, 'send');
  assert.equal(due.index, 1);

  // Catch-up: days behind, but already sent one today → wait until tomorrow.
  const behind = { ...enr, nextIndex: 2, lastSentAt: '2026-10-03T16:05:00.000Z' };
  assert.equal(onboardingDrip.nextAction(behind, cfg, TZ, new Date('2026-10-03T20:00:00Z')).type, 'wait');
  assert.equal(onboardingDrip.nextAction(behind, cfg, TZ, new Date('2026-10-04T16:00:00Z')).type, 'send');

  const finished = { ...enr, nextIndex: cfg.steps.length };
  assert.equal(onboardingDrip.nextAction(finished, cfg, TZ, new Date('2026-10-10T16:00:00Z')).type, 'done');
});

test('nextAction skips completed steps after Day 1 when enabled', () => {
  const cfg = onboardingConfig.normalizeOnboarding({});
  const enr = { enrolledAt: '2026-09-28T22:00:00.000Z', nextIndex: 0, lastSentAt: '' };
  const completed = { d1: { at: 'x' }, d2: { at: 'x' } };
  assert.equal(onboardingDrip.nextAction(enr, cfg, TZ, new Date('2026-09-28T22:01:00Z'), completed).type, 'send');
  const day2 = { ...enr, nextIndex: 1, lastSentAt: '2026-09-28T22:01:00.000Z' };
  assert.equal(onboardingDrip.nextAction(day2, cfg, TZ, new Date('2026-09-29T16:00:00Z'), completed).type, 'skip');
  const off = onboardingConfig.normalizeOnboarding({ skipCompleted: false });
  assert.equal(onboardingDrip.nextAction(day2, off, TZ, new Date('2026-09-29T16:00:00Z'), completed).type, 'send');
});

test('invite email, Day 1 on join, and the daily drip go through the workspace GHL', async (t) => {
  const ghlClient = require('../services/ghlClient');
  const workspaceIntegrations = require('../services/workspaceIntegrations');
  const sent = [];
  const created = [];
  t.mock.method(workspaceIntegrations, 'getResolvedIntegrationEnv', async () => ({
    GHL_API_KEY: 'k',
    GHL_LOCATION_ID: 'loc_1',
    GHL_EMAIL_FROM: 'team@floors.example',
  }));
  t.mock.method(ghlClient, 'searchContactByEmailOrPhone', async () => null);
  t.mock.method(ghlClient, 'createContact', async (contact) => {
    created.push(contact);
    return { id: `c_${created.length}` };
  });
  t.mock.method(ghlClient, 'sendConversationMessage', async (payload) => {
    sent.push(payload);
    return { messageId: `m_${sent.length}` };
  });

  const wid = 'ws_drip';
  const ws = {
    id: wid,
    name: 'Floor Pros',
    timezone: TZ,
    members: { 'new@floors.example': { role: 'sdr', joinedAt: new Date().toISOString() } },
    onboarding: { skipCompleted: false },
  };
  await dbService.saveWorkspace(wid, ws);

  const invite = await onboardingDrip.sendInviteEmail({
    ws,
    email: 'new@floors.example',
    inviteLink: 'https://app.example/workspace/invite/tok',
    inviterName: 'Alex',
    baseUrl: 'https://app.example',
  });
  assert.equal(invite.sent, true);
  assert.equal(sent[0].type, 'Email');
  assert.equal(sent[0].emailFrom, 'team@floors.example');
  assert.equal(sent[0].subject, "You're invited to Floor Pros on Agency OS");
  assert.match(sent[0].message, /Alex added you/);
  assert.match(sent[0].message, /https:\/\/app\.example\/workspace\/invite\/tok/);
  assert.equal(created[0].companyName, '');
  assert.deepEqual(created[0].tags, [onboardingDrip.TEAMMATE_TAG]);

  const enr = await onboardingDrip.enrollMember({
    workspaceId: wid,
    email: 'new@floors.example',
    name: 'Isabelle Pavlenko',
    baseUrl: 'https://app.example',
  });
  assert.equal(enr.nextIndex, 1);
  assert.equal(sent[1].subject, 'Day 1: Run your first lead search');
  assert.match(sent[1].message, /^Hi Isabelle,/);
  assert.match(sent[1].message, /https:\/\/app\.example\//);

  // Same day: nothing more goes out.
  await onboardingDrip.runOnboardingDrips(new Date(Date.now() + 60 * 1000));
  assert.equal(sent.length, 2);

  // Next morning at 9 AM workspace time: Day 2.
  const { DateTime } = require('luxon');
  const nextMorning = DateTime.now().setZone(TZ).plus({ days: 1 }).set({ hour: 9, minute: 5 }).toJSDate();
  await onboardingDrip.runOnboardingDrips(nextMorning);
  assert.equal(sent.length, 3);
  assert.equal(sent[2].subject, 'Day 2: Bring in the leads you already have');
  assert.equal(sent[2].contactId, 'c_2');

  await onboardingDrip.stopMember(wid, 'new@floors.example');
  const later = DateTime.now().setZone(TZ).plus({ days: 2 }).set({ hour: 9, minute: 5 }).toJSDate();
  await onboardingDrip.runOnboardingDrips(later);
  assert.equal(sent.length, 3);

  const statuses = await onboardingDrip.memberStatuses(await dbService.getWorkspace(wid));
  assert.equal(statuses[0].status, 'stopped');
  assert.equal(statuses[0].sentCount, 2);
});

test('activation checklist uses workspace steps and keeps legacy progress', async () => {
  const email = 'rep@example.com';
  await dbService.saveActivationState(email, {
    version: 1,
    startedAt: '2026-01-01T00:00:00.000Z',
    days: { d1: { at: '2026-01-01T00:00:00.000Z', event: 'search_saved' }, d5: { at: '2026-01-02T00:00:00.000Z', manual: true } },
  });

  const defaultWs = { id: 'ws_default', members: {} };
  const before = await activationService.getState(email, defaultWs);
  assert.equal(before.total, 7);
  assert.equal(before.progress, 2);
  assert.ok(before.days.d1 && before.days.d5);

  const flooringWs = {
    id: 'ws_floor',
    onboarding: {
      steps: [
        { id: 'measure', title: 'Book a measure', event: '' },
        { id: 'search', title: 'Find builders', event: 'search_saved' },
        { id: 'cadence', title: 'Follow up on quotes', event: 'sequence_started' },
      ],
    },
  };
  let floor = await activationService.getState(email, flooringWs);
  assert.equal(floor.total, 3);
  assert.equal(floor.plan[0].label, 'Day 1 — Book a measure');
  assert.equal(floor.progress, 1);

  await activationService.completeDay(email, 'measure', flooringWs);
  await activationService.recordEvent(email, 'sequence_started');
  floor = await activationService.getState(email, flooringWs);
  assert.equal(floor.progress, 3);

  // Manual marks are per workspace.
  const other = await activationService.getState(email, { ...flooringWs, id: 'ws_other' });
  assert.equal(other.progress, 2);

  await activationService.completeDay(email, 'not-a-step', flooringWs);
  assert.equal((await activationService.getState(email, flooringWs)).progress, 3);
});
