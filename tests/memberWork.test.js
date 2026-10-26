const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.APP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'member-work-'));

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const dbService = require('../services/database');
const store = require('../services/networkStore');
const work = require('../services/memberWork');
const { createMemberPortalToken } = require('../services/networkLinkSign');
const memberApp = require('../routes/memberApp');

const NET = 'net1abc';
const MEM_A = 'mema1';
const MEM_B = 'memb2';

test('googleMapsSearchUrl uses Google Maps with name + address for business profiles', () => {
  assert.equal(work.googleMapsSearchUrl({}), '');
  assert.equal(work.googleMapsSearchUrl({ name: '  ', address: '' }), '');
  const named = work.googleMapsSearchUrl({ name: 'Alchemy Holdings Inc', address: '123 Main St, Portland OR' });
  assert.match(named, /^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=/);
  assert.match(named, /Alchemy%20Holdings%20Inc/);
  assert.match(named, /123%20Main%20St/);
  assert.doesNotMatch(named, /maps\.apple/);
  const nameOnly = work.googleMapsSearchUrl({ name: 'Zippy Blinds' });
  assert.match(nameOnly, /Zippy%20Blinds/);
});

test('customers: create, update, list and validate', async () => {
  const bad = await work.saveCustomer(NET, MEM_A, { name: '   ' });
  assert.equal(bad.ok, false);
  const badEmail = await work.saveCustomer(NET, MEM_A, { name: 'Ann', email: 'not-an-email' });
  assert.match(badEmail.error, /email/i);

  const created = await work.saveCustomer(NET, MEM_A, {
    name: '  Ann   Lee ',
    phone: '360-555-0100',
    email: 'ANN@Example.com',
    address: '1 Main St',
    notes: 'x'.repeat(5000),
  });
  assert.equal(created.ok, true);
  assert.equal(created.customer.name, 'Ann Lee');
  assert.equal(created.customer.email, 'ann@example.com');
  assert.equal(created.customer.notes.length, 2000);
  assert.match(created.customer.id, /^[a-z0-9]+$/);

  const updated = await work.saveCustomer(NET, MEM_A, { name: 'Ann Lee-Park', phone: '1' }, { id: created.customer.id });
  assert.equal(updated.ok, true);
  assert.equal(updated.customer.id, created.customer.id);
  assert.equal(updated.customer.createdAt, created.customer.createdAt);
  assert.equal(updated.customer.name, 'Ann Lee-Park');

  const missing = await work.saveCustomer(NET, MEM_A, { name: 'Ghost' }, { id: 'zzzzzzzzzz' });
  assert.equal(missing.ok, false);

  const list = await work.listCustomers(NET, MEM_A);
  assert.equal(list.length, 1);
});

test('listCustomers sorts recent to oldest by updatedAt', async () => {
  const older = await work.saveCustomer(NET, MEM_A, { name: 'Zed Old' });
  assert.equal(older.ok, true);
  // Ensure a measurable gap so ISO timestamps differ.
  await new Promise((r) => setTimeout(r, 5));
  const newer = await work.saveCustomer(NET, MEM_A, { name: 'Amy New' });
  assert.equal(newer.ok, true);
  const names = (await work.listCustomers(NET, MEM_A)).map((c) => c.name);
  assert.equal(names[0], 'Amy New');
  assert.ok(names.indexOf('Amy New') < names.indexOf('Zed Old'));
  assert.equal(
    work.compareCustomersRecentFirst(
      { name: 'A', updatedAt: '2026-01-02T00:00:00.000Z' },
      { name: 'B', updatedAt: '2026-01-01T00:00:00.000Z' },
    ) < 0,
    true,
  );
});

test('customer sort prefers latest SMS/call touch like notifications', () => {
  const index = work.buildLeadTouchIndex([
    {
      ghlContactId: 'ghl_sms',
      phone: '360-555-0100',
      inboundEvents: [{ type: 'sms', at: '2026-10-21T21:45:00.000Z' }],
    },
    {
      phone: '503-555-0199',
      inboundEvents: [{ type: 'missed_call', at: '2026-10-20T12:00:00.000Z' }],
    },
  ]);
  const freshSms = {
    name: 'C Hattenhauer',
    ghlContactId: 'ghl_sms',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
  const olderCall = {
    name: 'Will Wormington',
    phone: '5035550199',
    updatedAt: '2026-10-21T00:00:00.000Z',
  };
  const stale = {
    name: 'Old Contact',
    updatedAt: '2026-09-01T00:00:00.000Z',
  };
  const rows = [stale, olderCall, freshSms].map((c) => ({
    ...c,
    lastTouchMs: Math.max(work.customerLastTouchMs(c), work.leadTouchMsForCustomer(c, index)),
  }));
  rows.sort(work.compareCustomersRecentFirst);
  assert.deepEqual(rows.map((r) => r.name), ['C Hattenhauer', 'Will Wormington', 'Old Contact']);
});

test('customers: mark as lead lists under contact leads and survives detail edits', async () => {
  const created = await work.saveCustomer(NET, MEM_A, {
    name: 'Sam Caller',
    phone: '360-555-0199',
  });
  assert.equal(created.ok, true);
  assert.equal(created.customer.isLead, false);

  const marked = await work.setCustomerLeadFlag(NET, MEM_A, created.customer.id, true);
  assert.equal(marked.ok, true);
  assert.equal(marked.customer.isLead, true);
  assert.ok(marked.customer.markedAsLeadAt);

  const leads = await work.listContactLeads(NET, MEM_A);
  assert.ok(leads.some((c) => c.id === created.customer.id));

  const edited = await work.saveCustomer(
    NET,
    MEM_A,
    { name: 'Sam Caller', phone: '360-555-0199', notes: 'Called about roof' },
    { id: created.customer.id },
  );
  assert.equal(edited.ok, true);
  assert.equal(edited.customer.isLead, true);
  assert.equal(edited.customer.markedAsLeadAt, marked.customer.markedAsLeadAt);

  const unmarked = await work.setCustomerLeadFlag(NET, MEM_A, created.customer.id, false);
  assert.equal(unmarked.ok, true);
  assert.equal(unmarked.customer.isLead, false);
  assert.equal(unmarked.customer.markedAsLeadAt, '');
  assert.equal((await work.listContactLeads(NET, MEM_A)).some((c) => c.id === created.customer.id), false);
});

test('customers: mark-as-lead routes put contact on Leads Received', async () => {
  const network = await store.getOrCreateNetworkForWorkspace('ws_member_mark_lead', { name: 'Mark lead network' });
  const member = await store.saveMember(network.id, {
    companyName: 'Mark Lead Co',
    contactName: 'Pat',
    status: 'active',
    plan: 'app_free',
    trades: ['roofing'],
  });
  const saved = await work.saveCustomer(network.id, member.id, {
    name: 'Inbound Texter',
    phone: '360-555-0444',
  });
  assert.equal(saved.ok, true);
  const token = createMemberPortalToken({ networkId: network.id, memberId: member.id });
  const { server, base } = await startApp();
  const A = `${base}/m/${token}`;
  try {
    const detail = await (await fetch(`${A}/customers/c/${saved.customer.id}`)).text();
    assert.match(detail, /Mark as lead/);
    assert.match(detail, /mark-lead/);

    const marked = await post(`${A}/customers/c/${saved.customer.id}/mark-lead`, {});
    assert.equal(marked.status, 303);
    assert.match(marked.headers.get('location') || '', /\/referrals\?ok=marked_lead/);

    const after = await work.getCustomer(network.id, member.id, saved.customer.id);
    assert.equal(after.isLead, true);

    const leadsPage = await (await fetch(`${A}/referrals`)).text();
    assert.match(leadsPage, /Leads from contacts and online forms/);
    assert.match(leadsPage, /Inbound Texter/);
    assert.match(leadsPage, /contact-lead-/);
    assert.match(leadsPage, /Mark as customer/);
    assert.match(leadsPage, /mark-customer/);

    const customersHidden = await (await fetch(`${A}/customers`)).text();
    assert.doesNotMatch(customersHidden, /Inbound Texter/);
    assert.match(customersHidden, /Open Leads/);

    const asCustomer = await post(`${A}/customers/c/${saved.customer.id}/mark-customer`, {});
    assert.equal(asCustomer.status, 303);
    assert.match(asCustomer.headers.get('location') || '', /\/customers\/c\/[^?]+\/?\?ok=marked_customer/);
    assert.equal((await work.getCustomer(network.id, member.id, saved.customer.id)).isLead, false);

    const customersShown = await (await fetch(`${A}/customers`)).text();
    assert.match(customersShown, /Inbound Texter/);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('customers and jobs are scoped to one member of one network', async () => {
  const mine = await work.saveCustomer(NET, MEM_B, { name: 'Bo' });
  assert.equal((await work.listCustomers(NET, MEM_B)).length, 1);
  assert.equal((await work.listCustomers('othernet', MEM_B)).length, 0);
  assert.equal(await work.getCustomer(NET, MEM_A, mine.customer.id), null);

  // A job for member A cannot point at member B's customer.
  const crossed = await work.saveJob(NET, MEM_A, { customerId: mine.customer.id, title: 'Steal', status: 'lead' });
  assert.equal(crossed.ok, false);

  const job = await work.saveJob(NET, MEM_B, { customerId: mine.customer.id, title: 'Deck', status: 'lead' });
  assert.equal(job.ok, true);
  assert.equal(await work.getJob(NET, MEM_A, job.job.id), null);
  assert.equal((await work.deleteJob(NET, MEM_A, job.job.id)).ok, false);
  assert.ok(await work.getJob(NET, MEM_B, job.job.id));

  // Underscores are allowed (workspace staff_* seats); reject other punctuation.
  await assert.rejects(work.listCustomers(NET, 'a/b'), /invalid scope/);
  await assert.rejects(work.listCustomers('net%', MEM_A), /invalid scope/);
  assert.equal(await work.getCustomer(NET, MEM_B, '../x'), null);
});

test('jobs: validation, status pipeline, completedAt and delete cascade', async () => {
  const { customer } = await work.saveCustomer(NET, MEM_A, { name: 'Cal' });
  const base = { customerId: customer.id, title: 'Roof repair' };

  assert.match((await work.saveJob(NET, MEM_A, { ...base, title: '' })).error, /what the job is/);
  assert.match((await work.saveJob(NET, MEM_A, { ...base, status: 'bogus' })).error, /status/);
  assert.match((await work.saveJob(NET, MEM_A, { ...base, status: 'scheduled' })).error, /date/);
  assert.match((await work.saveJob(NET, MEM_A, { ...base, date: '2026-02-30' })).error, /valid date/);
  assert.match((await work.saveJob(NET, MEM_A, { ...base, date: '2026-10-14', time: '25:00' })).error, /valid time/);
  assert.match((await work.saveJob(NET, MEM_A, { ...base, time: '09:00' })).error, /date for that time/);

  const saved = await work.saveJob(NET, MEM_A, {
    ...base,
    status: 'scheduled',
    value: '$4,800.50',
    date: '2026-10-14',
    time: '09:30',
    durationMins: '999999',
    notes: 'Bring ladder',
  });
  assert.equal(saved.ok, true);
  const job = saved.job;
  assert.equal(job.value, 4800.5);
  assert.equal(job.durationMins, 7 * 24 * 60);
  assert.equal(job.completedAt, '');

  assert.equal(work.nextStatus('lead'), 'estimate');
  assert.equal(work.nextStatus('in_progress'), 'completed');
  assert.equal(work.nextStatus('completed'), '');
  assert.equal(work.nextStatus('on_hold'), 'scheduled');

  const done = await work.setJobStatus(NET, MEM_A, job.id, 'completed');
  assert.equal(done.ok, true);
  assert.ok(done.job.completedAt);
  const reopened = await work.setJobStatus(NET, MEM_A, job.id, 'in_progress');
  assert.equal(reopened.job.completedAt, '');
  assert.equal((await work.setJobStatus(NET, MEM_A, job.id, 'nope')).ok, false);

  // Status chip: Scheduled without a date should still work (defaults to today).
  const undated = await work.saveJob(NET, MEM_A, { ...base, title: 'Site visit', status: 'completed' });
  assert.equal(undated.ok, true);
  assert.equal(undated.job.date, '');
  const scheduled = await work.setJobStatus(NET, MEM_A, undated.job.id, 'scheduled', { today: '2026-10-11' });
  assert.equal(scheduled.ok, true);
  assert.equal(scheduled.job.status, 'scheduled');
  assert.equal(scheduled.job.date, '2026-10-11');

  const second = await work.saveJob(NET, MEM_A, { ...base, title: 'Gutters', status: 'lead' });
  const removed = await work.deleteCustomer(NET, MEM_A, customer.id);
  assert.equal(removed.ok, true);
  assert.equal(removed.removedJobs, 3);
  assert.equal(await work.getJob(NET, MEM_A, second.job.id), null);
});

test('jobs: visit reminders and photos', async () => {
  const { customer } = await work.saveCustomer(NET, MEM_A, { name: 'Photo Pat', phone: '3605550101' });
  const saved = await work.saveJob(NET, MEM_A, {
    customerId: customer.id,
    title: 'Blind install',
    status: 'scheduled',
    date: '2026-10-20',
    time: '10:00',
    remindOwnerBeforeMins: '1440',
    remindCustomerBeforeMins: '120',
  }, { timeZone: 'America/Los_Angeles' });
  assert.equal(saved.ok, true);
  assert.equal(saved.job.remindOwnerBeforeMins, 1440);
  assert.equal(saved.job.remindCustomerBeforeMins, 120);
  assert.equal(saved.job.timeZone, 'America/Los_Angeles');
  assert.equal(saved.job.photos.length, 0);

  assert.match(
    (await work.saveJob(NET, MEM_A, {
      customerId: customer.id,
      title: 'No date',
      status: 'lead',
      remindOwnerBeforeMins: '60',
    })).error,
    /date before turning on/,
  );

  const stamped = await work.writeJob(NET, MEM_A, {
    ...saved.job,
    ownerRemindedAt: '2026-10-19T10:00:00.000Z',
    customerRemindedAt: '2026-10-20T08:00:00.000Z',
  });
  assert.ok(stamped.ownerRemindedAt);
  const rescheduled = await work.saveJob(NET, MEM_A, {
    ...stamped,
    customerId: customer.id,
    title: stamped.title,
    status: 'scheduled',
    date: '2026-10-21',
    time: '10:00',
    remindOwnerBeforeMins: '1440',
    remindCustomerBeforeMins: '120',
  }, { id: stamped.id, timeZone: 'America/Los_Angeles' });
  assert.equal(rescheduled.job.ownerRemindedAt, '');
  assert.equal(rescheduled.job.customerRemindedAt, '');

  const tinyPng = await require('sharp')({
    create: { width: 8, height: 8, channels: 3, background: { r: 200, g: 80, b: 40 } },
  }).png().toBuffer();
  const prepared = await require('../services/memberJobMedia').prepareJobPhoto(tinyPng);
  const photo = await work.addJobPhoto(NET, MEM_A, rescheduled.job.id, prepared, { caption: 'Before' });
  assert.equal(photo.ok, true);
  assert.equal(photo.job.photos.length, 1);
  assert.equal(photo.job.photos[0].caption, 'Before');

  const noted = await work.updateJobPhotoCaption(
    NET, MEM_A, rescheduled.job.id, photo.photoId, 'Before — living room\nGate on left',
  );
  assert.equal(noted.ok, true);
  assert.equal(noted.caption, 'Before — living room\nGate on left');
  assert.equal(noted.job.photos[0].caption, 'Before — living room\nGate on left');

  const media = require('../services/memberJobMedia');
  const blob = await media.getJobPhoto(NET, MEM_A, rescheduled.job.id, photo.photoId);
  assert.ok(blob && blob.buffer.length > 20);

  const gone = await work.removeJobPhoto(NET, MEM_A, rescheduled.job.id, photo.photoId);
  assert.equal(gone.ok, true);
  assert.equal(gone.job.photos.length, 0);
  assert.equal(await media.getJobPhoto(NET, MEM_A, rescheduled.job.id, photo.photoId), null);

  await work.deleteJob(NET, MEM_A, rescheduled.job.id);
  await work.deleteCustomer(NET, MEM_A, customer.id);
});

test('ensureOpenJobForPhotos creates a Site visit when none exist', async () => {
  const { customer } = await work.saveCustomer(NET, MEM_A, { name: 'Site Snap', phone: '5035550111' });
  const first = await work.ensureOpenJobForPhotos(NET, MEM_A, customer.id, { timeZone: 'America/Los_Angeles' });
  assert.equal(first.ok, true);
  assert.equal(first.created, true);
  assert.equal(first.job.title, 'Site visit');
  assert.equal(first.job.status, 'lead');
  assert.equal(first.job.customerId, customer.id);

  const again = await work.ensureOpenJobForPhotos(NET, MEM_A, customer.id);
  assert.equal(again.ok, true);
  assert.equal(again.created, false);
  assert.equal(again.job.id, first.job.id);

  await work.deleteJob(NET, MEM_A, first.job.id);
  await work.deleteCustomer(NET, MEM_A, customer.id);
});

test('calendar grid, week overview and upcoming agenda', () => {
  const jobs = [
    { id: 'a', date: '2026-10-01', time: '09:00', status: 'scheduled', value: 100 },
    { id: 'b', date: '2026-10-01', time: '08:00', status: 'completed', value: 50 },
    { id: 'c', date: '2026-10-03', status: 'in_progress', value: 200 },
    { id: 'd', date: '2026-10-20', status: 'cancelled', value: 999 },
    { id: 'e', date: '', status: 'lead', value: 25 },
    { id: 'f', date: '2026-09-28', status: 'scheduled', value: 0 },
  ];
  const grid = work.monthGrid('2026-10', jobs, { today: '2026-10-01', selected: '2026-10-03' });
  assert.equal(grid.label, 'October 2026');
  assert.equal(grid.prev, '2026-09');
  assert.equal(grid.next, '2026-11');
  assert.equal(grid.weeks[0][0].date, '2026-09-27');
  const days = grid.weeks.flat();
  const oct1 = days.find((d) => d.date === '2026-10-01');
  assert.equal(oct1.count, 2);
  assert.equal(oct1.open, 1);
  assert.equal(oct1.isToday, true);
  assert.equal(days.find((d) => d.date === '2026-10-03').isSelected, true);
  assert.equal(days.find((d) => d.date === '2026-10-20').count, 0);

  const ov = work.overview(jobs, { today: '2026-10-01', pendingReferrals: 3 });
  assert.deepEqual(ov.week, { start: '2026-09-27', end: '2026-10-03' });
  assert.equal(ov.pendingJobs, 4);
  assert.equal(ov.pendingValue, 325);
  assert.equal(ov.thisWeek, 3);
  assert.equal(ov.pendingReferrals, 3);

  assert.deepEqual(work.upcoming(jobs, '2026-10-01').map((j) => j.id), ['a', 'c']);
  assert.equal(work.todayIn('America/Los_Angeles', new Date('2026-10-02T03:00:00Z')), '2026-10-01');
  assert.equal(work.todayIn('Not/AZone', new Date('2026-10-02T03:00:00Z')), '2026-10-02');
});

test('ics export escapes text and uses floating local time', () => {
  const ics = work.buildIcs(
    { id: 'job123abc', title: 'Floor; install, phase 1', date: '2026-10-14', time: '09:30', durationMins: 90, notes: 'Line1\nLine2', updatedAt: '2026-10-01T00:00:00Z' },
    { name: 'Ann', phone: '555', address: '1 Main St, Camas' },
    { appName: 'Acme', host: 'leads.example.com' },
  );
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /DTSTART:20261014T093000\r\n/);
  assert.match(ics, /DTEND:20261014T110000\r\n/);
  assert.match(ics, /SUMMARY:Floor\\; install\\, phase 1 · Ann/);
  assert.match(ics, /LOCATION:1 Main St\\, Camas/);
  assert.match(ics, /Line1\\nLine2/);
  assert.match(ics, /UID:job123abc@leads\.example\.com/);
  const allDay = work.buildIcs({ id: 'x1y2z3', title: 'T', date: '2026-12-31' }, null, {});
  assert.match(allDay, /DTSTART;VALUE=DATE:20261231/);
  assert.match(allDay, /DTEND;VALUE=DATE:20270101/);
  assert.equal(work.buildIcs({ id: 'x1y2z3', title: 'T', date: '' }), '');
});

test('a received referral converts into a customer and job once', async () => {
  const referral = {
    id: 'ref123abc',
    toMemberId: MEM_A,
    status: 'booked',
    value: 0,
    tradeSlug: 'flooring',
    homeowner: { name: 'Dee', phone: '3605550111', email: 'bad', address: '9 Elm', city: 'Camas', zip: '98607', note: 'Wants oak' },
  };
  assert.equal((await work.convertReferral(NET, MEM_B, referral)).ok, false);
  assert.match((await work.convertReferral(NET, MEM_A, { ...referral, status: 'sent' })).error, /Accept/);

  const first = await work.convertReferral(NET, MEM_A, referral, { tradeLabel: 'Flooring', today: '2026-10-01' });
  assert.equal(first.ok, true);
  assert.equal(first.existing, false);
  assert.equal(first.customer.name, 'Dee');
  assert.equal(first.customer.email, '');
  assert.equal(first.customer.address, '9 Elm, Camas 98607');
  assert.equal(first.customer.referralId, 'ref123abc');
  assert.equal(first.customer.source, 'referral');
  assert.equal(work.customerSourceLabel(first.customer), 'Referral');
  assert.equal(first.job.title, 'Flooring referral');
  assert.equal(first.job.status, 'scheduled');
  assert.equal(first.job.date, '2026-10-01');

  const again = await work.convertReferral(NET, MEM_A, referral, { tradeLabel: 'Flooring', today: '2026-10-01' });
  assert.equal(again.existing, true);
  assert.equal(again.job.id, first.job.id);
});

test('customerSourceLabel covers manual, website form, referral, agency, csv, crm', () => {
  assert.equal(work.customerSourceLabel('manual'), 'Manual');
  assert.equal(work.customerSourceLabel('website_form'), 'Website form');
  assert.equal(work.customerSourceLabel('referral'), 'Referral');
  assert.equal(work.customerSourceLabel('agency'), 'Agency');
  assert.equal(work.customerSourceLabel('csv'), 'CSV import');
  assert.equal(work.customerSourceLabel('ghl'), 'CRM');
  assert.equal(work.customerSourceLabel({ source: 'website_form' }), 'Website form');
  assert.equal(work.customerSourceLabel({ source: 'manual', referralId: 'ref1' }), 'Referral');
  assert.equal(work.customerSourceLabel({ referralId: 'ref1' }), 'Referral');
  assert.equal(work.customerSourcePillClass('website_form'), 'ma-pill--accepted');
  assert.equal(work.customerSourcePillClass('referral'), 'ma-pill--sent');
  assert.ok(work.CUSTOMER_SOURCES.has('website_form'));
  assert.ok(work.CUSTOMER_SOURCES.has('agency'));
});

test('saveCustomer keeps website_form and agency sources', async () => {
  const form = await work.saveCustomer(NET, MEM_A, {
    name: 'Form Person',
    phone: '3605550991',
  }, { source: 'website_form' });
  assert.equal(form.ok, true);
  assert.equal(form.customer.source, 'website_form');
  assert.equal(work.normalizeCustomer(form.customer).source, 'website_form');

  const agency = await work.saveCustomer(NET, MEM_A, {
    name: 'Agency Person',
    phone: '3605550992',
  }, { source: 'agency' });
  assert.equal(agency.ok, true);
  assert.equal(agency.customer.source, 'agency');
});

test('shareCustomerWithTeammate copies contact and all projects', async () => {
  const cust = await work.saveCustomer(NET, MEM_A, {
    name: 'Share Customer',
    phone: '3605550888',
    email: 'share@example.com',
    address: '88 Pine',
  });
  assert.equal(cust.ok, true);
  const job1 = await work.saveJob(NET, MEM_A, {
    customerId: cust.customer.id,
    title: 'Shared install',
    status: 'scheduled',
    date: '2026-11-05',
    time: '10:00',
    durationMins: 120,
    notes: 'Bring samples',
  });
  const job2 = await work.saveJob(NET, MEM_A, {
    customerId: cust.customer.id,
    title: 'Follow-up punch',
    status: 'estimate',
    date: '2026-11-12',
  });
  assert.equal(job1.ok, true);
  assert.equal(job2.ok, true);

  // Tiny JPEG so share copies real site-visit blobs onto the teammate’s book.
  const jpeg = Buffer.from(
    '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a'
    + 'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIy'
    + 'MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIA'
    + 'AhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEB'
    + 'AQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGfAP/E'
    + 'ABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAQUCf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAI'
    + 'AQMBAT8Bf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIBAT8Bf//EABQQAQAAAAAAAAAAAAAAAA'
    + 'AAAAD/2gAIAQEABj8Cf//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAT8hf//Z',
    'base64',
  );
  const photoA = await work.addJobPhoto(NET, MEM_A, job1.job.id, {
    contentType: 'image/jpeg',
    buffer: jpeg,
  }, { caption: 'Kitchen before' });
  const photoB = await work.addJobPhoto(NET, MEM_A, job1.job.id, {
    contentType: 'image/jpeg',
    buffer: jpeg,
  }, { caption: 'Living room' });
  assert.equal(photoA.ok && photoB.ok, true);

  const shared = await work.shareCustomerWithTeammate(NET, MEM_A, MEM_B, cust.customer.id, {
    sharedByName: 'Pat',
  });
  assert.equal(shared.ok, true);
  assert.equal(shared.existing, false);
  assert.equal(shared.jobsShared, 2);
  assert.equal(shared.customer.sharedFromMemberId, MEM_A);
  assert.equal(shared.customer.sharedFromCustomerId, cust.customer.id);
  assert.equal(shared.customer.name, 'Share Customer');
  assert.ok(shared.jobs.some((j) => j.title === 'Shared install'));
  assert.ok(shared.jobs.some((j) => j.title === 'Follow-up punch'));

  const theirInstall = shared.jobs.find((j) => j.title === 'Shared install');
  assert.ok(theirInstall);
  assert.equal(theirInstall.photos.length, 2);
  assert.ok(theirInstall.photos.some((p) => p.caption === 'Kitchen before'));
  assert.ok(theirInstall.photos.some((p) => p.caption === 'Living room'));
  const jobMedia = require('../services/memberJobMedia');
  const blob = await jobMedia.getJobPhoto(NET, MEM_B, theirInstall.id, theirInstall.photos[0].id);
  assert.ok(blob && blob.buffer && blob.buffer.length > 20);

  const sourceCust = await work.getCustomer(NET, MEM_A, cust.customer.id);
  assert.ok(sourceCust.sharedWith.some((r) => r.memberId === MEM_B && r.customerId === shared.customer.id));

  const theirJobs = await work.listJobs(NET, MEM_B);
  assert.equal(theirJobs.filter((j) => j.customerId === shared.customer.id).length, 2);
  assert.ok(!theirJobs.some((j) => j.id === job1.job.id));

  // Sharing one job also shares the contact + every project on that lead.
  const viaJob = await work.shareJobWithTeammate(NET, MEM_A, MEM_B, job1.job.id, {
    sharedByName: 'Pat',
  });
  assert.equal(viaJob.ok, true);
  assert.equal(viaJob.existing, true);
  assert.equal(viaJob.jobsShared, 2);
  assert.equal(viaJob.job.sharedFromJobId, job1.job.id);
  // Re-share stays idempotent — still two photos, not four.
  assert.equal(viaJob.job.photos.length, 2);

  assert.equal((await work.shareCustomerWithTeammate(NET, MEM_A, MEM_A, cust.customer.id)).ok, false);
});

test('shareCustomerWithTeammate reuses teammate’s existing same-title job (no Lead+Estimate twin)', async () => {
  const source = await work.saveCustomer(NET, MEM_A, {
    name: 'Zimmerman',
    phone: '3605550777',
    address: '105 SE 137th Pl',
  });
  assert.equal(source.ok, true);
  const sourceJob = await work.saveJob(NET, MEM_A, {
    customerId: source.customer.id,
    title: 'Site visit',
    status: 'estimate',
  });
  assert.equal(sourceJob.ok, true);

  // Teammate already has the same contact + a Lead for Site visit.
  const theirs = await work.saveCustomer(NET, MEM_B, {
    name: 'Zimmerman',
    phone: '3605550777',
    address: '105 SE 137th Pl',
  });
  assert.equal(theirs.ok, true);
  const theirLead = await work.saveJob(NET, MEM_B, {
    customerId: theirs.customer.id,
    title: 'Site visit',
    status: 'lead',
  });
  assert.equal(theirLead.ok, true);

  const shared = await work.shareCustomerWithTeammate(NET, MEM_A, MEM_B, source.customer.id, {
    sharedByName: 'Greg Arakelyan',
  });
  assert.equal(shared.ok, true);
  assert.equal(shared.jobsCreated, 0);
  assert.equal(shared.jobs.length, 1);
  assert.equal(shared.jobs[0].id, theirLead.job.id);
  assert.equal(shared.jobs[0].status, 'lead');
  assert.equal(shared.jobs[0].sharedFromJobId, sourceJob.job.id);
  assert.match(shared.jobs[0].notes || '', /Shared by Greg Arakelyan/);

  const theirJobs = await work.listJobs(NET, MEM_B);
  const zimmermanJobs = theirJobs.filter((j) => j.customerId === theirs.customer.id);
  assert.equal(zimmermanJobs.length, 1, 'must not create a second Site visit card');
});

test('syncSharedCustomerPhotos backfills photos dropped on an older share', async () => {
  const cust = await work.saveCustomer(NET, MEM_A, {
    name: 'Zimmerman',
    phone: '3605550666',
    address: '105 SE 137th Pl',
  });
  assert.equal(cust.ok, true);
  const job = await work.saveJob(NET, MEM_A, {
    customerId: cust.customer.id,
    title: 'Site visit',
    status: 'estimate',
  });
  assert.equal(job.ok, true);
  const jpeg = Buffer.from(
    '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a'
    + 'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIy'
    + 'MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIA'
    + 'AhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEB'
    + 'AQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGfAP/E'
    + 'ABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAQUCf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAI'
    + 'AQMBAT8Bf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIBAT8Bf//EABQQAQAAAAAAAAAAAAAAAA'
    + 'AAAAD/2gAIAQEABj8Cf//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAT8hf//Z',
    'base64',
  );
  const photo = await work.addJobPhoto(NET, MEM_A, job.job.id, {
    contentType: 'image/jpeg',
    buffer: jpeg,
  }, { caption: 'Entry' });
  assert.equal(photo.ok, true);

  // Simulate the old share bug: contact + job copy with photos stripped.
  const created = await work.saveCustomer(NET, MEM_B, {
    name: cust.customer.name,
    phone: cust.customer.phone,
    address: cust.customer.address,
    notes: 'Shared by a teammate.',
  }, { source: 'manual' });
  assert.equal(created.ok, true);
  const theirCustomer = await work.writeCustomer(NET, MEM_B, {
    ...created.customer,
    sharedFromMemberId: MEM_A,
    sharedFromCustomerId: cust.customer.id,
  });
  const theirJobCreated = await work.saveJob(NET, MEM_B, {
    customerId: theirCustomer.id,
    title: 'Site visit',
    status: 'estimate',
    notes: 'Shared by a teammate.',
  });
  assert.equal(theirJobCreated.ok, true);
  await work.writeJob(NET, MEM_B, {
    ...theirJobCreated.job,
    sharedFromMemberId: MEM_A,
    sharedFromJobId: job.job.id,
    photos: [],
  });

  const sync = await work.syncSharedCustomerPhotos(NET, MEM_B, theirCustomer);
  assert.equal(sync.ok, true);
  assert.equal(sync.synced, 1);
  const theirJob = await work.getJob(NET, MEM_B, theirJobCreated.job.id);
  assert.equal(theirJob.photos.length, 1);
  assert.equal(theirJob.photos[0].caption, 'Entry');
  const jobMedia = require('../services/memberJobMedia');
  const blob = await jobMedia.getJobPhoto(NET, MEM_B, theirJob.id, theirJob.photos[0].id);
  assert.ok(blob && blob.buffer && blob.buffer.length > 20);

  // Second sync is a no-op.
  const again = await work.syncSharedCustomerPhotos(NET, MEM_B, theirCustomer);
  assert.equal(again.synced, 0);
  assert.equal((await work.getJob(NET, MEM_B, theirJob.id)).photos.length, 1);
});

function startApp() {
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));
  app.use('/', memberApp);
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` }));
  });
}

function post(url, body) {
  return fetch(url, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  });
}

test('customers tab routes: top-bar add customer, CRUD, calendar, pending and referral conversion', async () => {
  const network = await store.getOrCreateNetworkForWorkspace('ws_member_work', { name: 'Work network' });
  const a = await store.saveMember(network.id, {
    companyName: 'Camas Flooring', contactName: 'Pat', status: 'active', trades: ['flooring'], phone: '3605550101',
  });
  const b = await store.saveMember(network.id, {
    companyName: 'Camas Electric', contactName: 'Sam', status: 'active', trades: ['electrical'], phone: '3605550102',
  });
  const tokenA = createMemberPortalToken({ networkId: network.id, memberId: a.id });
  const tokenB = createMemberPortalToken({ networkId: network.id, memberId: b.id });
  const ref = await store.saveReferral(network.id, {
    id: 'refroute1abc',
    tradeSlug: 'flooring',
    fromMemberId: b.id,
    toMemberId: a.id,
    status: 'sent',
    homeowner: { name: 'Riley Park', phone: '3605550123' },
    events: [],
    createdAt: new Date().toISOString(),
  });
  const { server, base } = await startApp();
  const A = `${base}/m/${tokenA}`;
  try {
    const home = await (await fetch(A)).text();
    assert.match(home, /class="ma-iconbtn[^"]*" href="\/m\/[^"]+\/customers\/new" aria-label="Add a customer"/);
    assert.doesNotMatch(home, /href="\/m\/[^"]+\/enroll" aria-label="Invite a business/);
    assert.match(home, /href="\/m\/[^"]+\/customers"[^>]*>[\s\S]*?<span class="ma-tab__label">Customers<\/span>/);
    assert.doesNotMatch(home, /ma-tab__label">Enroll</);

    const empty = await fetch(`${A}/customers`);
    assert.equal(empty.status, 200);
    const emptyHtml = await empty.text();
    assert.match(emptyHtml, /No customers yet/);
    assert.match(emptyHtml, /Sync from CRM/);
    assert.match(emptyHtml, /customers\/sync-ghl/);
    assert.match(emptyHtml, /customers\/import/);
    assert.match(emptyHtml, /Upload a customer list/);
    assert.match(emptyHtml, /import-template\.csv/);
    assert.match(emptyHtml, /ma-settings-row/);
    assert.doesNotMatch(emptyHtml, /is-locked/);
    assert.doesNotMatch(emptyHtml, /ma-btn--ghost[^>]*>[\s\S]*Add<\/a>/);

    const newPage = await fetch(`${A}/customers/new`);
    assert.equal(newPage.status, 200);
    const newHtml = await newPage.text();
    assert.match(newHtml, /Bulk upload/);
    assert.match(newHtml, /customers\/new\?tab=bulk/);
    assert.match(newHtml, /One customer/);

    const bulkPage = await fetch(`${A}/customers/new?tab=bulk`);
    assert.equal(bulkPage.status, 200);
    const bulkHtml = await bulkPage.text();
    assert.match(bulkHtml, /Download CSV template/);
    assert.match(bulkHtml, /import-template\.csv/);
    assert.match(bulkHtml, /name="file"/);
    assert.doesNotMatch(bulkHtml, /id="cuName"/);

    const template = await fetch(`${A}/customers/import-template.csv`);
    assert.equal(template.status, 200);
    assert.match(String(template.headers.get('content-type') || ''), /text\/csv/);
    const templateText = await template.text();
    assert.match(templateText, /^Name,Phone,Email,Address,Notes\n/);

    const bad = await post(`${A}/customers/new`, { name: '' });
    assert.equal(bad.status, 400);

    const created = await post(`${A}/customers/new`, { name: 'Morgan Diaz', phone: '3605550199', address: '12 Oak Ave' });
    assert.equal(created.status, 303);
    const customerId = created.headers.get('location').match(/\/customers\/c\/([a-z0-9]+)/)[1];

    const newJob = await post(`${A}/customers/jobs/new`, {
      customerId,
      title: 'Kitchen LVP',
      status: 'scheduled',
      date: '2026-10-14',
      time: '09:00',
      durationMins: '120',
      value: '4800',
      remindOwnerBeforeMins: '1440',
      remindCustomerBeforeMins: '60',
    });
    assert.equal(newJob.status, 303);
    assert.match(newJob.headers.get('location'), /\/customers\/jobs\/[a-z0-9]+\?ok=job/);
    const jobs = await work.listJobs(network.id, a.id);
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].remindOwnerBeforeMins, 1440);

    const jobPage = await (await fetch(`${A}/customers/jobs/${jobs[0].id}`)).text();
    assert.match(jobPage, /Remind me/);
    assert.match(jobPage, /Remind customer/);
    assert.match(jobPage, /Share contact &amp; projects|Share contact & projects|Share with a teammate/);
    assert.match(jobPage, /all their projects/);
    assert.match(jobPage, /Invite outside network/);
    assert.match(jobPage, /name="invitePhone"/);
    assert.match(jobPage, /data-ma-share-mate-pick/);
    assert.match(jobPage, /Search teammates/);
    assert.match(jobPage, /id="maJobShareInvite"/);
    assert.doesNotMatch(jobPage, /id="maJobShareInvite"[^>]*\sopen|id="maJobShareInvite" open/);
    assert.match(jobPage, /<summary>\s*Invite someone new\s*<\/summary>/);
    assert.match(jobPage, /action="[^"]*\/customers\/jobs\/[^"]+\/share"/);
    assert.match(jobPage, /Camas Electric/);
    assert.match(jobPage, /Job photos/);
    assert.match(jobPage, /name="photo"/);
    assert.match(jobPage, /data-ma-status-steps/);
    assert.match(jobPage, /data-ma-job-status-pill/);
    assert.match(jobPage, /https:\/\/www\.google\.com\/maps\/search\/\?api=1&amp;query=/);
    assert.doesNotMatch(jobPage, /maps\.apple\.com/);

    const shared = await post(`${A}/customers/jobs/${jobs[0].id}/share`, { memberId: b.id });
    assert.equal(shared.status, 303);
    assert.match(shared.headers.get('location') || '', /ok=job_shared/);
    const bJobs = await work.listJobs(network.id, b.id);
    assert.ok(bJobs.some((j) => j.sharedFromJobId === jobs[0].id && j.sharedFromMemberId === a.id));
    const bJob = bJobs.find((j) => j.sharedFromJobId === jobs[0].id);
    const bJobPage = await (await fetch(`${base}/m/${tokenB}/customers/jobs/${bJob.id}`)).text();
    assert.match(bJobPage, /Shared onto your calendar/);
    assert.doesNotMatch(bJobPage, /Share contact &amp; projects|Share contact & projects|Invite outside network/);

    const ask = await require('../services/reviewAsk').createAsk({
      networkId: network.id,
      memberId: a.id,
      customerId,
      name: 'Morgan Diaz',
      phone: '3605550199',
      channel: 'sms',
      reviewSlug: 'camas-flooring',
    });
    await require('../services/reviewAsk').markOpened(ask.id);
    const legacyCustomer = await fetch(`${A}/customers/${customerId}`, { redirect: 'manual' });
    assert.equal(legacyCustomer.status, 302);
    assert.match(legacyCustomer.headers.get('location') || '', new RegExp(`/customers/c/${customerId}$`));

    const customerPage = await (await fetch(`${A}/customers/c/${customerId}`)).text();
    assert.match(customerPage, /ma-askstatus/);
    assert.match(customerPage, /Opened the review link/);
    // Review quick action opens ask form prefilled — does not send on tap.
    assert.match(customerPage, new RegExp(`/review\\?ask=1&amp;customer=${customerId}`));
    assert.doesNotMatch(customerPage, /customers\/c\/[^"]+\/request-review/);
    assert.match(customerPage, /https:\/\/www\.google\.com\/maps\/search\/\?api=1&amp;query=/);
    assert.match(customerPage, /Morgan%20Diaz|Morgan Diaz/);
    assert.match(customerPage, /ma-label-link[^>]*>Google Maps</);
    assert.doesNotMatch(customerPage, /maps\.apple\.com/);
    assert.match(customerPage, /ma-tags/);
    assert.match(customerPage, /ma-tags-section/);
    assert.match(customerPage, /data-ma-tag-pick/);
    assert.match(customerPage, /name="tagName"/);
    assert.match(customerPage, /ma-tags__chip|No tags on this customer yet/);
    assert.match(customerPage, />Tags</);
    assert.match(customerPage, /Search tags or create new/);
    assert.ok(customerPage.indexOf('ma-tags-section') < customerPage.indexOf('>Details<'));
    assert.match(customerPage, /Share contact &amp; projects|Share contact & projects/);
    assert.match(customerPage, /action="[^"]*\/customers\/c\/[^"]+\/share"/);
    // Share contact sits under Details (not above Jobs).
    assert.ok(customerPage.indexOf('>Details<') < customerPage.indexOf('maCustomerShare'));

    const inlineCustomer = await post(`${A}/customers/jobs/new`, {
      customerId: 'new', newCustomerName: 'Quinn', title: 'Estimate', status: 'estimate',
    });
    assert.equal(inlineCustomer.status, 303);
    assert.equal((await work.listCustomers(network.id, a.id)).length, 2);

    const cal = await (await fetch(`${A}/customers?view=calendar&m=2026-10&d=2026-10-14`)).text();
    assert.match(cal, /October 2026/);
    assert.match(cal, /Kitchen LVP/);

    const pending = await (await fetch(`${A}/customers?view=pending`)).text();
    assert.match(pending, /Riley Park/);
    assert.match(pending, /Accept \+ add/);
    assert.match(pending, /In progress/);

    const ics = await fetch(`${A}/customers/jobs/${jobs[0].id}/calendar.ics`);
    assert.equal(ics.headers.get('content-type'), 'text/calendar; charset=utf-8');
    assert.match(await ics.text(), /SUMMARY:Kitchen LVP · Morgan Diaz/);

    const statusJsonRes = await fetch(`${A}/customers/jobs/${jobs[0].id}/status`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
        'X-Requested-With': 'fetch',
      },
      body: 'status=estimate',
      redirect: 'manual',
    });
    assert.equal(statusJsonRes.status, 200);
    const statusJson = await statusJsonRes.json();
    assert.equal(statusJson.ok, true);
    assert.equal(statusJson.status, 'estimate');
    assert.equal(statusJson.statusLabel, 'Estimate');
    assert.equal((await work.getJob(network.id, a.id, jobs[0].id)).status, 'estimate');

    const moved = await post(`${A}/customers/jobs/${jobs[0].id}/status`, { status: 'in_progress', back: 'https://evil.example/' });
    assert.equal(moved.status, 303);
    assert.match(moved.headers.get('location'), new RegExp(`^/m/${tokenA}/customers/jobs/`));
    assert.equal((await work.getJob(network.id, a.id, jobs[0].id)).status, 'in_progress');

    // Member B cannot read or change member A's records.
    const B = `${base}/m/${tokenB}`;
    const peek = await fetch(`${B}/customers/c/${customerId}`, { redirect: 'manual' });
    assert.equal(peek.status, 303);
    const hijack = await post(`${B}/customers/jobs/${jobs[0].id}`, { customerId, title: 'Hijacked', status: 'lead' });
    assert.equal(hijack.status, 303);
    assert.equal((await work.getJob(network.id, a.id, jobs[0].id)).title, 'Kitchen LVP');
    await post(`${B}/customers/c/${customerId}/delete`, {});
    assert.ok(await work.getCustomer(network.id, a.id, customerId));
    const stealRef = await post(`${B}/customers/from-referral/${ref.id}`, {});
    assert.equal(stealRef.status, 400);

    const converted = await post(`${A}/customers/from-referral/${ref.id}`, {});
    assert.equal(converted.status, 303);
    assert.match(converted.headers.get('location'), /customers\/jobs\/[a-z0-9]+\?ok=converted/);
    assert.equal((await store.getReferral(network.id, ref.id)).status, 'accepted');
    const fromRef = (await work.listJobs(network.id, a.id)).find((j) => j.referralId === ref.id);
    assert.equal(fromRef.status, 'lead');
    const again = await post(`${A}/customers/from-referral/${ref.id}`, {});
    assert.match(again.headers.get('location'), /ok=already/);

    const enroll = await (await fetch(`${A}/enroll`)).text();
    assert.match(enroll, /Invite a business/);
    assert.match(enroll, /href="\/m\/[^"]+\/customers\/new" aria-label="Add a customer"/);
    assert.doesNotMatch(enroll, /href="\/m\/[^"]+\/enroll" aria-label="Invite a business/);
  } finally {
    server.close();
  }
});

test('a member id that prefixes another member id does not leak records', async () => {
  await dbService.putStorageKey(`netcust:${NET}:${MEM_A}x:abcdef123`, { id: 'abcdef123', name: 'Other scope' });
  const names = (await work.listCustomers(NET, MEM_A)).map((c) => c.name);
  assert.ok(!names.includes('Other scope'));
});

test('free app_free Home shows company name, yellow accent, and Your business hero', async () => {
  const network = await store.getOrCreateNetworkForWorkspace('ws_member_home_free', {
    name: 'Adhello Agency network',
  });
  await store.saveNetwork({
    ...network,
    brand: {
      ...(network.brand || {}),
      appName: 'Adhello Agency network',
      accent: '#F26B1D',
      heroUrl: '/m/brand/agency/hero?v=1',
    },
  });
  const member = await store.saveMember(network.id, {
    companyName: 'Sunrise HVAC',
    contactName: 'Alex',
    status: 'active',
    plan: 'app_free',
  });
  const token = createMemberPortalToken({ networkId: network.id, memberId: member.id });
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));
  app.locals.assetVersion = 'test';
  app.use('/', memberApp);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}/m/${token}`;
  try {
    const html = await (await fetch(base)).text();
    assert.match(html, /AdHello Reviews App/);
    assert.match(html, /Add <b>AdHello Reviews App<\/b> to your Home Screen/);
    assert.match(html, /Sunrise HVAC/);
    assert.doesNotMatch(html, /Adhello Agency network/i);
    assert.match(html, /--acc:\s*#FFDB3A/i);
    assert.match(html, /member-hero-your-business\.jpg/);
    assert.doesNotMatch(html, /\/m\/brand\/agency\/hero/);
    assert.match(html, /data-ma-install-workspace-only/);
    assert.match(html, /data-ma-install-browser-done/);

    const manifest = await (await fetch(`${base}/manifest.webmanifest`)).json();
    assert.equal(manifest.name, 'AdHello Reviews App');
    assert.doesNotMatch(manifest.name, /agency/i);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('free app_free members see Join tab, benefits page, and referrals upgrade gates', async () => {
  const network = await store.getOrCreateNetworkForWorkspace('ws_member_refs_free', { name: 'Free refs network' });
  const member = await store.saveMember(network.id, {
    companyName: 'Free Refs Co',
    contactName: 'Pat',
    status: 'active',
    plan: 'app_free',
    trades: ['plumbing'],
  });
  // Pool referral: free member should see project name, not phone/claim.
  await store.saveReferral(network.id, {
    id: 'ref_free_teaser',
    status: 'unrouted',
    tradeSlug: 'plumbing',
    fromMemberId: 'operator',
    homeowner: {
      name: 'River Remodel',
      phone: '503-555-9999',
      email: 'secret@example.com',
      note: 'Basement leak',
    },
    createdAt: new Date().toISOString(),
  });
  const token = createMemberPortalToken({ networkId: network.id, memberId: member.id });
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));
  app.locals.assetVersion = 'test';
  app.use('/', memberApp);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}/m/${token}`;
  try {
    const home = await (await fetch(base)).text();
    assert.match(home, /href="[^"]*\/join"[^>]*>[\s\S]*?<span class="ma-tab__label">Join<\/span>/);
    assert.doesNotMatch(home, /href="[^"]*\/send"[^>]*>[\s\S]*?<span class="ma-tab__label">Send<\/span>/);

    const join = await (await fetch(`${base}/join`)).text();
    assert.equal((await fetch(`${base}/join`)).status, 200);
    assert.match(join, /You’re on the free app|You.re on the free app/);
    assert.match(join, /Monthly workspace/);
    assert.match(join, /Send &amp; receive referrals|Send & receive referrals/);
    assert.match(join, /Start your plan/);
    assert.match(join, /href="\/signup"/);
    assert.match(join, /ma-join-card/);

    const refs = await (await fetch(`${base}/referrals?view=pool`)).text();
    assert.match(refs, /Unlock lead details/);
    assert.match(refs, /Upgrade to unlock/);
    assert.match(refs, /href="\/signup"/);
    assert.match(refs, /Leads &amp; Referrals|Leads & Referrals/);
    assert.match(refs, /River Remodel/);
    assert.doesNotMatch(refs, /503-555-9999/);
    assert.doesNotMatch(refs, /secret@example\.com/);
    assert.doesNotMatch(refs, /Basement leak/);
    assert.doesNotMatch(refs, /Claim this lead/);

    const sendRedirect = await fetch(`${base}/send`, { redirect: 'manual' });
    assert.equal(sendRedirect.status, 303);
    assert.match(sendRedirect.headers.get('location') || '', /\/join$/);

    const blockedSend = await fetch(`${base}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ tradeSlug: 'plumbing', name: 'Test', consent: 'on' }),
      redirect: 'manual',
    });
    assert.equal(blockedSend.status, 303);
    assert.match(blockedSend.headers.get('location') || '', /\/join$/);

    const blockedRef = await fetch(`${base}/referrals/fakeid`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ action: 'claim' }),
      redirect: 'manual',
    });
    assert.equal(blockedRef.status, 303);
    assert.match(blockedRef.headers.get('location') || '', /ok=referrals_upgrade/);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('free app_free members see Sync from CRM greyed with upgrade only', async () => {
  const network = await store.getOrCreateNetworkForWorkspace('ws_member_crm_free', { name: 'Free CRM network' });
  const member = await store.saveMember(network.id, {
    companyName: 'Free Reviews Co',
    contactName: 'Lee',
    status: 'active',
    plan: 'app_free',
  });
  const token = createMemberPortalToken({ networkId: network.id, memberId: member.id });
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));
  app.locals.assetVersion = 'test';
  app.use('/', memberApp);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}/m/${token}`;
  try {
    const html = await (await fetch(`${base}/customers`)).text();
    assert.match(html, /Sync from CRM/);
    assert.match(html, /is-locked/);
    assert.match(html, /Upgrade to activate/);
    assert.match(html, /href="\/signup"/);
    assert.doesNotMatch(html, /customers\/sync-ghl/);
    assert.match(html, /Upload a customer list/);

    const blocked = await fetch(`${base}/customers/sync-ghl`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: '',
      redirect: 'manual',
    });
    assert.equal(blocked.status, 303);
    assert.match(blocked.headers.get('location') || '', /ok=crm_sync_upgrade/);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('Review tab and home links open QR page not the ask form', async () => {
  const network = await store.getOrCreateNetworkForWorkspace('ws_member_review_qr', { name: 'QR first net' });
  const member = await store.saveMember(network.id, {
    companyName: 'QR Co',
    contactName: 'Pat',
    status: 'active',
  });
  const token = createMemberPortalToken({ networkId: network.id, memberId: member.id });
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));
  app.locals.assetVersion = 'test';
  app.use('/', memberApp);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}/m/${token}`;
  try {
    const home = await (await fetch(base)).text();
    assert.match(home, /href="[^"]*\/review"\s+class="ma-tab ma-tab--fab/);
    assert.match(home, /ma-tab__fab/);
    assert.match(home, /ma-tab__label/);
    assert.doesNotMatch(home, /\/review\?ask=1/);

    const review = await (await fetch(`${base}/review`)).text();
    assert.match(review, /Show your QR/);
    assert.match(review, /Request a review/);
    assert.match(review, /ma-qr/);
    assert.doesNotMatch(review, /id="maAskForm"\s+open/);
    assert.match(review, /Request a review/);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('free app_free members cannot send GHL review SMS/email', async () => {
  const network = await store.getOrCreateNetworkForWorkspace('ws_member_review_send_free', { name: 'Free review send' });
  const member = await store.saveMember(network.id, {
    companyName: 'Free Send Co',
    contactName: 'Sam',
    status: 'active',
    plan: 'app_free',
  });
  const token = createMemberPortalToken({ networkId: network.id, memberId: member.id });
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));
  app.locals.assetVersion = 'test';
  app.use('/', memberApp);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}/m/${token}`;
  try {
    const html = await (await fetch(`${base}/review`)).text();
    assert.match(html, /Request a review/);
    assert.match(html, /Send reviews by text or email/);
    assert.match(html, /Upgrade to activate/);
    assert.match(html, /href="\/signup"/);
    assert.doesNotMatch(html, /action="[^"]*\/review\/send"/);
    // Free members keep native Request a review; GHL form is gated.
    // Review tab + QR first — send fold stays closed for free members.
    assert.doesNotMatch(html, /id="maAskForm"\s+open/);
    assert.match(html, /href="[^"]*\/review"\s+class="ma-tab ma-tab--fab/);
    assert.match(html, /ma-tab__fab/);
    assert.match(html, /ma-tab__label/);
    assert.doesNotMatch(html, /href="[^"]*\/review\?ask=1"/);

    const home = await (await fetch(base)).text();
    assert.match(home, /\/review"/);
    assert.doesNotMatch(home, /\/review\?ask=1/);

    const blocked = await fetch(`${base}/review/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ phone: '5035550100', name: 'Pat', channel: 'sms' }),
      redirect: 'manual',
    });
    assert.equal(blocked.status, 303);
    assert.match(blocked.headers.get('location') || '', /ok=review_send_upgrade/);
    assert.doesNotMatch(blocked.headers.get('location') || '', /ask=1/);

    const settingsHtml = await (await fetch(`${base}/review/settings`)).text();
    assert.match(settingsHtml, /Referral SMS|Open SMS script/);
    assert.match(settingsHtml, /send\?view=request/);
    assert.doesNotMatch(settingsHtml, /action="[^"]*\/review\/reward"/);

    const rewardBlocked = await fetch(`${base}/review/reward`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        rewardEnabled: '1',
        rewardLabel: '$25 gift card',
        rewardMinStars: '4',
        rewardType: 'gift_card',
      }),
      redirect: 'manual',
    });
    assert.equal(rewardBlocked.status, 303);
    assert.match(rewardBlocked.headers.get('location') || '', /ok=reward_upgrade/);
  } finally {
    await new Promise((r) => server.close(r));
  }
});
