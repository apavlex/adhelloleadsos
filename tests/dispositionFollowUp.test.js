const test = require('node:test');
const assert = require('node:assert/strict');
const {
  needsFollowUpForDisposition,
  defaultScheduledAt,
  resolveFollowUpForDisposition,
  resolveTaskOwnerEmail,
} = require('../services/dispositionFollowUp');

test('needsFollowUpForDisposition skips terminal dispositions', () => {
  assert.equal(needsFollowUpForDisposition('not_interested'), false);
  assert.equal(needsFollowUpForDisposition('wrong_number'), false);
  assert.equal(needsFollowUpForDisposition('callback'), true);
  assert.equal(needsFollowUpForDisposition('no_answer'), true);
});

test('defaultScheduledAt no_answer is +18h', () => {
  const now = new Date('2026-08-05T08:00:00.000Z');
  const at = defaultScheduledAt('no_answer', now);
  assert.equal(at.getTime() - now.getTime(), 18 * 60 * 60 * 1000);
});

test('defaultScheduledAt callback is tomorrow 10am local', () => {
  const now = new Date('2026-08-05T14:00:00');
  const at = defaultScheduledAt('callback', now);
  assert.equal(at.getDate(), 6);
  assert.equal(at.getHours(), 10);
  assert.equal(at.getMinutes(), 0);
});

test('resolveFollowUpForDisposition uses client scheduledAt for callback', () => {
  const now = new Date('2026-08-05T10:00:00.000Z');
  const client = '2026-08-12T15:30:00.000Z';
  const plan = resolveFollowUpForDisposition('callback', {
    scheduledAt: client,
    lead: { title: 'Acme Co' },
    now,
  });
  assert.equal(plan.skipFollowUp, false);
  assert.equal(plan.scheduledAt, client);
  assert.match(plan.taskTitle, /Acme Co/);
});

test('resolveFollowUpForDisposition honors skipFollowUp', () => {
  const plan = resolveFollowUpForDisposition('connected', {
    skipFollowUp: true,
    lead: { title: 'X' },
    now: new Date(),
  });
  assert.equal(plan.skipFollowUp, true);
  assert.equal(plan.scheduledAt, null);
});

test('resolveTaskOwnerEmail prefers assignee then owner', () => {
  assert.equal(
    resolveTaskOwnerEmail({ assignedTo: 'Rep@Example.com' }, { ownerUserId: 'owner@example.com' }),
    'rep@example.com',
  );
  assert.equal(
    resolveTaskOwnerEmail({}, { ownerUserId: 'Owner@Example.com' }),
    'owner@example.com',
  );
});
