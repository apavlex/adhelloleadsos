const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.APP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'job-visit-'));
process.env.SESSION_SECRET = 'job-visit-test-secret';

const { describe, it, mock } = require('node:test');
const assert = require('node:assert/strict');
const { DateTime } = require('luxon');
const store = require('../services/networkStore');
const work = require('../services/memberWork');
const notify = require('../services/networkNotify');
const ghlMessaging = require('../services/ghlMessaging');
const reminders = require('../services/jobVisitReminders');

describe('job visit reminders', () => {
  it('computes fire time from date, time, and lead minutes', () => {
    const job = {
      date: '2026-10-20',
      time: '10:00',
      timeZone: 'America/Los_Angeles',
      status: 'scheduled',
      remindOwnerBeforeMins: 60,
      ownerRemindedAt: '',
    };
    const start = reminders.visitStartMs(job);
    const expected = DateTime.fromISO('2026-10-20T10:00', { zone: 'America/Los_Angeles' }).toMillis();
    assert.equal(start, expected);

    const fireAt = start - 60 * 60000;
    assert.equal(reminders.dueForSide(job, 'owner', fireAt - 1000), false);
    assert.equal(reminders.dueForSide(job, 'owner', fireAt), true);
    assert.equal(reminders.dueForSide({ ...job, ownerRemindedAt: '2026-10-20T16:00:00.000Z' }, 'owner', fireAt), false);
    assert.equal(reminders.dueForSide({ ...job, status: 'completed' }, 'owner', fireAt), false);
  });

  it('sends owner and customer reminders once when due', async () => {
    const network = await store.getOrCreateNetworkForWorkspace('ws_job_visit', { name: 'Visit Net' });
    const member = await store.saveMember(network.id, {
      companyName: 'Zippy Blinds',
      contactName: 'Alex',
      phone: '+15551112222',
      status: 'active',
    });
    const { customer } = await work.saveCustomer(network.id, member.id, {
      name: 'Casey Customer',
      phone: '+15553334444',
    });
    const startLocal = DateTime.now().setZone('America/Los_Angeles').plus({ hours: 1 }).set({ second: 0, millisecond: 0 });
    const saved = await work.saveJob(network.id, member.id, {
      customerId: customer.id,
      title: 'Living room blinds',
      status: 'scheduled',
      date: startLocal.toISODate(),
      time: startLocal.toFormat('HH:mm'),
      remindOwnerBeforeMins: '60',
      remindCustomerBeforeMins: '60',
    }, { timeZone: 'America/Los_Angeles' });
    assert.equal(saved.ok, true);

    const memberCalls = [];
    const customerCalls = [];
    mock.method(notify, 'messageMember', async (_network, _member, payload) => {
      memberCalls.push(payload);
      return { ok: true, channel: 'sms', provider: 'ghl', messageId: 'm1' };
    });
    mock.method(ghlMessaging, 'messagingReady', () => ({ configured: true, smsReady: true, emailReady: true }));
    mock.method(ghlMessaging, 'sendSmsToPerson', async (payload) => {
      customerCalls.push(payload);
      return { messageId: 'c1', provider: 'ghl' };
    });

    const now = reminders.visitStartMs(saved.job) - 30 * 60000;
    const result = await reminders.runJobVisitReminders(now);
    assert.ok(result.sent >= 2);
    assert.equal(memberCalls.length, 1);
    assert.match(memberCalls[0].sms, /Living room blinds/);
    assert.equal(customerCalls.length, 1);
    assert.match(customerCalls[0].message, /Zippy Blinds/);

    const after = await work.getJob(network.id, member.id, saved.job.id);
    assert.ok(after.ownerRemindedAt);
    assert.ok(after.customerRemindedAt);

    const again = await reminders.runJobVisitReminders(now);
    assert.equal(again.sent, 0);
    assert.equal(memberCalls.length, 1);
    assert.equal(customerCalls.length, 1);
  });
});
