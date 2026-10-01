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

  const second = await work.saveJob(NET, MEM_A, { ...base, title: 'Gutters', status: 'lead' });
  const removed = await work.deleteCustomer(NET, MEM_A, customer.id);
  assert.equal(removed.ok, true);
  assert.equal(removed.removedJobs, 2);
  assert.equal(await work.getJob(NET, MEM_A, second.job.id), null);
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
    assert.match(await empty.text(), /No customers yet/);

    const bad = await post(`${A}/customers/new`, { name: '' });
    assert.equal(bad.status, 400);

    const created = await post(`${A}/customers/new`, { name: 'Morgan Diaz', phone: '3605550199', address: '12 Oak Ave' });
    assert.equal(created.status, 303);
    const customerId = created.headers.get('location').match(/\/customers\/c\/([a-z0-9]+)/)[1];

    const newJob = await post(`${A}/customers/jobs/new`, {
      customerId, title: 'Kitchen LVP', status: 'scheduled', date: '2026-10-14', time: '09:00', durationMins: '120', value: '4800',
    });
    assert.equal(newJob.status, 303);
    const jobs = await work.listJobs(network.id, a.id);
    assert.equal(jobs.length, 1);

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
