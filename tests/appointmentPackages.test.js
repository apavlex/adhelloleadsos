const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizePackage,
  countsFor,
  trackerFor,
  applyGhlEventToStore,
  statusFromGhlAppointment,
  buildTodayView,
  normalizeStore,
  findPackageForFormLead,
  normalizeLeadCredits,
  selectBulkTargets,
  listTrades,
  COMMON_TRADES,
} = require('../services/appointmentPackages');

describe('appointmentPackages', () => {
  it('counts remaining inventory from purchased minus booked/closed', () => {
    const pkg = normalizePackage({
      businessName: 'Handymen LLC',
      purchased: 10,
      appointments: [
        { status: 'booked', ghlEventId: 'e1' },
        { status: 'closed', ghlEventId: 'e2' },
        { status: 'cancelled', ghlEventId: 'e3' },
      ],
    });
    const c = countsFor(pkg);
    assert.equal(c.purchased, 10);
    assert.equal(c.booked, 1);
    assert.equal(c.closed, 1);
    assert.equal(c.remaining, 8);
    assert.ok(c.open >= 8);
  });

  it('builds Domino-style tracker steps with a current stage', () => {
    const pkg = normalizePackage({
      businessName: 'Acme',
      purchased: 5,
      appointments: [{ status: 'booked', ghlEventId: 'a1' }],
    });
    const t = trackerFor(pkg);
    assert.equal(t.current, 'booked');
    assert.equal(t.steps.find((s) => s.id === 'sold').state, 'done');
    assert.equal(t.steps.find((s) => s.id === 'booked').state, 'current');
    assert.equal(t.steps.find((s) => s.id === 'closed').state, 'todo');
  });

  it('maps GHL appointment statuses', () => {
    assert.equal(statusFromGhlAppointment({ appointmentStatus: 'confirmed' }), 'booked');
    assert.equal(statusFromGhlAppointment({ appointmentStatus: 'completed' }), 'closed');
    assert.equal(statusFromGhlAppointment({ appointmentStatus: 'cancelled' }), 'cancelled');
    assert.equal(statusFromGhlAppointment({ deleted: true }), 'cancelled');
  });

  it('applies new GHL events onto a matching calendar package', () => {
    const store = normalizeStore({
      packages: [
        {
          id: 'pkg_1',
          businessName: 'Roof Pros',
          purchased: 3,
          ghlCalendarId: 'cal_1',
          appointments: [],
        },
      ],
    });
    const first = applyGhlEventToStore(store, {
      id: 'evt_1',
      calendarId: 'cal_1',
      appointmentStatus: 'confirmed',
      title: 'Estimate visit',
      startTime: '2026-10-10T15:00:00.000Z',
      contact: { name: 'Sam Owner' },
    });
    assert.equal(first.matched, true);
    assert.equal(first.changed, true);
    assert.equal(store.packages[0].appointments.length, 1);
    assert.equal(store.packages[0].appointments[0].status, 'booked');
    assert.equal(countsFor(store.packages[0]).remaining, 2);

    const update = applyGhlEventToStore(store, {
      id: 'evt_1',
      calendarId: 'cal_1',
      appointmentStatus: 'completed',
    });
    assert.equal(update.changed, true);
    assert.equal(store.packages[0].appointments[0].status, 'closed');
    assert.equal(countsFor(store.packages[0]).remaining, 2);
    assert.equal(countsFor(store.packages[0]).closed, 1);
  });

  it('builds a today view with totals', () => {
    const store = normalizeStore({
      packages: [
        {
          businessName: 'A',
          purchased: 10,
          appointments: [{ status: 'booked' }, { status: 'closed' }],
        },
        {
          businessName: 'B',
          purchased: 5,
          appointments: [],
        },
      ],
    });
    const view = buildTodayView(store, { ghlConfigured: true });
    assert.equal(view.packages.length, 2);
    assert.equal(view.totals.purchased, 15);
    assert.equal(view.totals.booked, 1);
    assert.equal(view.totals.closed, 1);
    assert.equal(view.totals.remaining, 13);
    assert.equal(view.ghlConfigured, true);
    assert.ok(view.steps.length === 4);
  });

  it('matches form leads to packages by tag or email', () => {
    const store = normalizeStore({
      packages: [
        {
          id: 'pkg_handymen',
          businessName: 'Handymen LLC',
          contactEmail: 'owner@handymen.test',
          formMatchTag: 'handymen-website',
          purchased: 5,
          leadCredits: { purchased: 25, delivered: 0 },
        },
      ],
    });
    const byTag = findPackageForFormLead(store, {
      lead: { tags: ['handymen-website'] },
      formName: 'Contact',
    });
    assert.equal(byTag.id, 'pkg_handymen');
    const byEmail = findPackageForFormLead(store, {
      contactEmail: 'owner@handymen.test',
      lead: {},
    });
    assert.equal(byEmail.id, 'pkg_handymen');
  });

  it('tracks lead credit remaining', () => {
    const credits = normalizeLeadCredits({ purchased: 25, delivered: 7 });
    assert.equal(credits.remaining, 18);
  });

  it('stores trade on packages and lists trades for bulk send', () => {
    const pkg = normalizePackage({
      businessName: 'Spark Electric',
      trade: 'Electrician',
      purchased: 5,
    });
    assert.equal(pkg.trade, 'Electrician');
    const store = normalizeStore({
      packages: [
        pkg,
        { businessName: 'Floor Co', trade: 'Flooring', purchased: 3 },
        { businessName: 'No Trade', purchased: 2 },
      ],
    });
    const trades = listTrades(store);
    assert.ok(trades.includes('Electrician'));
    assert.ok(trades.includes('Flooring'));
    assert.ok(COMMON_TRADES.includes('Electrician'));
    const view = buildTodayView(store);
    assert.ok(view.trades.includes('Electrician'));
    assert.equal(view.packages.find((p) => p.businessName === 'Spark Electric').trade, 'Electrician');
  });

  it('selects bulk send targets by package id and/or trade', () => {
    const packages = [
      normalizePackage({ id: 'pkg_e1', businessName: 'Spark', trade: 'Electrician', purchased: 5 }),
      normalizePackage({ id: 'pkg_e2', businessName: 'Volt', trade: 'electrician', purchased: 5 }),
      normalizePackage({ id: 'pkg_f1', businessName: 'Floor Co', trade: 'Flooring', purchased: 5 }),
      normalizePackage({ id: 'pkg_h1', businessName: 'Handy', trade: 'Handyman', purchased: 5 }),
    ];
    const byTrade = selectBulkTargets(packages, { trade: 'Electrician' });
    assert.equal(byTrade.length, 2);
    assert.deepEqual(byTrade.map((p) => p.id).sort(), ['pkg_e1', 'pkg_e2']);

    const byIds = selectBulkTargets(packages, { packageIds: ['pkg_f1', 'pkg_h1'] });
    assert.equal(byIds.length, 2);

    const one = selectBulkTargets(packages, { packageIds: ['pkg_e1'] });
    assert.equal(one.length, 1);
    assert.equal(one[0].businessName, 'Spark');

    const empty = selectBulkTargets(packages, {});
    assert.equal(empty.length, 0);

    const mixed = selectBulkTargets(packages, { packageIds: ['pkg_h1'], trade: 'Flooring' });
    assert.equal(mixed.length, 2);
    assert.ok(mixed.some((p) => p.id === 'pkg_h1'));
    assert.ok(mixed.some((p) => p.id === 'pkg_f1'));
  });
});

const {
  createContractorPortalToken,
  verifyContractorPortalToken,
} = require('../services/contractorPortalSign');

describe('contractorPortalSign', () => {
  it('round-trips a portal token', () => {
    const token = createContractorPortalToken({ workspaceId: 'ws1', packageId: 'pkg_1' });
    const payload = verifyContractorPortalToken(token);
    assert.equal(payload.workspaceId, 'ws1');
    assert.equal(payload.packageId, 'pkg_1');
  });

  it('rejects tampered tokens', () => {
    const token = createContractorPortalToken({ workspaceId: 'ws1', packageId: 'pkg_1' });
    assert.equal(verifyContractorPortalToken(token + 'x'), null);
  });
});
