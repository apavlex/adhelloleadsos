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

  await assert.rejects(work.listCustomers(NET, 'a_b'), /invalid scope/);
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
  assert.equal(first.job.title, 'Flooring referral');
  assert.equal(first.job.status, 'scheduled');
  assert.equal(first.job.date, '2026-10-01');

  const again = await work.convertReferral(NET, MEM_A, referral, { tradeLabel: 'Flooring', today: '2026-10-01' });
  assert.equal(again.existing, true);
  assert.equal(again.job.id, first.job.id);
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

test('customers tab routes: top-bar enroll, CRUD, calendar, pending and referral conversion', async () => {
  const network = await store.getOrCreateNetworkForWorkspace('ws_member_work', { name: 'Work network' });
  const a = await store.saveMember(network.id, { companyName: 'Camas Flooring', contactName: 'Pat', status: 'active', trades: ['flooring'] });
  const b = await store.saveMember(network.id, { companyName: 'Camas Electric', contactName: 'Sam', status: 'active', trades: ['electrical'] });
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
    assert.match(home, /class="ma-iconbtn[^"]*" href="\/m\/[^"]+\/enroll" aria-label="Invite a business/);
    assert.match(home, /href="\/m\/[^"]+\/customers"[^>]*>[\s\S]*?<span>Customers<\/span>/);
    assert.doesNotMatch(home, /<span>Enroll<\/span>/);

    const empty = await fetch(`${A}/customers`);
    assert.equal(empty.status, 200);
    const emptyHtml = await empty.text();
    assert.match(emptyHtml, /No customers yet/);
    assert.match(emptyHtml, /Sync from CRM/);
    assert.match(emptyHtml, /customers\/sync-ghl/);
    assert.match(emptyHtml, /customers\/import/);
    assert.match(emptyHtml, /Upload a customer list/);
    assert.match(emptyHtml, /ma-settings-row/);
    assert.doesNotMatch(emptyHtml, /is-locked/);
    assert.doesNotMatch(emptyHtml, /ma-btn--ghost[^>]*>[\s\S]*Add<\/a>/);

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
    assert.match(jobPage, /Job photos/);
    assert.match(jobPage, /name="photo"/);
    assert.match(jobPage, /data-ma-status-steps/);
    assert.match(jobPage, /data-ma-job-status-pill/);

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
    const customerPage = await (await fetch(`${A}/customers/c/${customerId}`)).text();
    assert.match(customerPage, /ma-askstatus/);
    assert.match(customerPage, /Opened the review link/);

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
    assert.match(enroll, /class="ma-iconbtn is-on"/);
  } finally {
    server.close();
  }
});

test('a member id that prefixes another member id does not leak records', async () => {
  await dbService.putStorageKey(`netcust:${NET}:${MEM_A}x:abcdef123`, { id: 'abcdef123', name: 'Other scope' });
  const names = (await work.listCustomers(NET, MEM_A)).map((c) => c.name);
  assert.ok(!names.includes('Other scope'));
});

test('free app_free members see referrals and send upgrade gates', async () => {
  const network = await store.getOrCreateNetworkForWorkspace('ws_member_refs_free', { name: 'Free refs network' });
  const member = await store.saveMember(network.id, {
    companyName: 'Free Refs Co',
    contactName: 'Pat',
    status: 'active',
    plan: 'app_free',
    trades: ['plumbing'],
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
    const refs = await (await fetch(`${base}/referrals`)).text();
    assert.match(refs, /Start getting referrals/);
    assert.match(refs, /Upgrade to activate/);
    assert.match(refs, /href="\/signup"/);
    assert.doesNotMatch(refs, /Claim this lead/);
    assert.doesNotMatch(refs, /Referral lists/);

    const send = await (await fetch(`${base}/send`)).text();
    assert.match(send, /Start getting referrals/);
    assert.match(send, /Upgrade to activate/);
    assert.doesNotMatch(send, /name="tradeSlug"/);
    assert.doesNotMatch(send, /Send referral<\/button>/);

    const blockedSend = await fetch(`${base}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ tradeSlug: 'plumbing', name: 'Test', consent: 'on' }),
      redirect: 'manual',
    });
    assert.equal(blockedSend.status, 303);
    assert.match(blockedSend.headers.get('location') || '', /ok=referrals_upgrade/);

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
    assert.match(home, /href="[^"]*\/review"\s+class="ma-tab ma-tab--send/);
    assert.doesNotMatch(home, /\/review\?ask=1/);

    const review = await (await fetch(`${base}/review`)).text();
    assert.match(review, /Show your QR/);
    assert.doesNotMatch(review, /id="maAskForm"\s+open/);
    assert.match(review, /Share from this phone/);
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
    assert.match(html, /Share from this phone/);
    assert.match(html, /Send reviews by text or email/);
    assert.match(html, /Upgrade to activate/);
    assert.match(html, /href="\/signup"/);
    assert.doesNotMatch(html, /action="[^"]*\/review\/send"/);
    // Review tab + QR first — send fold stays closed for free members.
    assert.doesNotMatch(html, /id="maAskForm"\s+open/);
    assert.match(html, /href="[^"]*\/review"\s+class="ma-tab ma-tab--send/);
    assert.doesNotMatch(html, /href="[^"]*\/review\?ask=1"\s+class="ma-tab ma-tab--send/);

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
  } finally {
    await new Promise((r) => server.close(r));
  }
});
