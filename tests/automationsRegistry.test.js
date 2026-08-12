const test = require('node:test');
const assert = require('node:assert/strict');
const { DateTime } = require('luxon');
const {
  computeNextDailyRunUtc,
  computeScheduleNextRun,
  outreachStatus,
  summarizeEnrolledLead,
  listGhlOutreachEnrolledLeads,
  listCadenceEnrolledLeads,
} = require('../services/automationsRegistry');

test('outreachStatus returns running when enabled', () => {
  assert.equal(outreachStatus({ enabled: true }), 'running');
});

test('outreachStatus returns paused when disabled but has run history', () => {
  assert.equal(outreachStatus({ enabled: false, lastRunAt: '2026-01-01T09:30:00Z' }), 'paused');
  assert.equal(outreachStatus({ enabled: false, lastEnrolled: 3 }), 'paused');
});

test('outreachStatus returns idle when never run', () => {
  assert.equal(outreachStatus({ enabled: false }), 'idle');
});

test('computeNextDailyRunUtc returns future 09:30 UTC', () => {
  const before = DateTime.utc().set({ hour: 8, minute: 0, second: 0, millisecond: 0 });
  const next = computeNextDailyRunUtc(before.toJSDate());
  const dt = DateTime.fromISO(next, { zone: 'utc' });
  assert.equal(dt.hour, 9);
  assert.equal(dt.minute, 30);
  assert.ok(dt > before);
});

test('computeScheduleNextRun handles one-time future schedule', () => {
  const future = DateTime.utc().plus({ days: 2 }).toISO();
  const next = computeScheduleNextRun({
    scheduledRunAt: future,
    lastRun: null,
  });
  assert.equal(DateTime.fromISO(next).toUTC().toISO(), DateTime.fromISO(future).toUTC().toISO());
});

test('computeScheduleNextRun returns null for completed one-time schedule', () => {
  const past = DateTime.utc().minus({ days: 1 }).toISO();
  const next = computeScheduleNextRun({
    scheduledRunAt: past,
    lastRun: past,
  });
  assert.equal(next, null);
});

test('summarizeEnrolledLead builds GHL outreach summary with open link', () => {
  const lead = {
    key: 'lead:abc123',
    title: 'Acme Plumbing',
    prospecting: {
      status: 'active',
      campaign: 'auto_outreach_7',
      lastEnrolledAt: '2026-03-01T10:00:00Z',
      senderOfferKey: 'offer_a',
    },
    updates: [
      {
        type: 'email_outbound',
        timestamp: '2026-03-02T14:00:00Z',
        value: 'Day 1 email',
      },
    ],
  };
  const summary = summarizeEnrolledLead(lead, 'ghl_outreach');
  assert.equal(summary.title, 'Acme Plumbing');
  assert.equal(summary.shortKey, 'abc123');
  assert.equal(summary.enrolledAt, '2026-03-01T10:00:00Z');
  assert.equal(summary.lastTouchLabel, 'Email sent');
  assert.match(summary.openUrl, /\/focus\?lead=abc123/);
  assert.match(summary.statusDetail, /GHL auto-outreach/);
});

test('listGhlOutreachEnrolledLeads filters by folder and active prospecting', () => {
  const leads = [
    {
      key: 'lead:1',
      title: 'In folder',
      folderKey: 'f1',
      prospecting: { status: 'active', campaign: 'auto_outreach_7' },
    },
    {
      key: 'lead:2',
      title: 'Other folder',
      folderKey: 'f2',
      prospecting: { status: 'active', campaign: 'auto_outreach_7' },
    },
    {
      key: 'lead:3',
      title: 'Inactive',
      folderKey: 'f1',
      prospecting: { status: 'paused' },
    },
  ];
  const inFolder = listGhlOutreachEnrolledLeads(leads, 'f1');
  assert.equal(inFolder.length, 1);
  assert.equal(inFolder[0].title, 'In folder');
});

test('listCadenceEnrolledLeads excludes auto_outreach_7 template', () => {
  const leads = [
    {
      key: 'lead:c1',
      title: 'Cadence lead',
      sequenceState: { status: 'active', templateId: 'welcome', stepIndex: 0 },
    },
    {
      key: 'lead:c2',
      title: 'GHL cadence',
      sequenceState: { status: 'active', templateId: 'auto_outreach_7', stepIndex: 1 },
    },
  ];
  const enrolled = listCadenceEnrolledLeads(leads);
  assert.equal(enrolled.length, 1);
  assert.equal(enrolled[0].title, 'Cadence lead');
  assert.match(enrolled[0].statusDetail, /welcome/);
});
