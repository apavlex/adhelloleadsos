const test = require('node:test');
const assert = require('node:assert/strict');
const ex = require('../services/referralExchange');

const NOW = '2026-09-26T12:00:00.000Z';

function zones() {
  return [
    ex.normalizeZone({ id: 'z1', name: 'Austin North', cities: 'Austin, TX\nRound Rock, TX', zips: '78701, 78702' }),
    ex.normalizeZone({ id: 'z2', name: 'Dallas', cities: ['Dallas, TX'], zips: '75201' }),
  ];
}

test('zone resolution prefers ZIP, then city, else null', () => {
  const list = zones();
  assert.equal(ex.resolveZone(list, { zip: '75201', city: 'Austin' }).id, 'z2');
  assert.equal(ex.resolveZone(list, { city: 'round rock' }).id, 'z1');
  assert.equal(ex.resolveZone(list, { city: 'Austin, TX', zip: '99999' }).id, 'z1');
  assert.equal(ex.resolveZone(list, { zip: '78702-1234' }).id, 'z1');
  assert.equal(ex.resolveZone(list, { city: 'Houston' }), null);
});

test('city list keeps "City, ST" per line and dedupes', () => {
  assert.deepEqual(ex.parseCityList('Austin, TX\naustin\nRound Rock, TX'), ['Austin, TX', 'Round Rock, TX']);
  assert.deepEqual(ex.parseZipList('78701 78702,78701 abc'), ['78701', '78702']);
});

test('seat exclusivity: one member per trade per zone', () => {
  let zone = zones()[0];
  const first = ex.assignSeat(zone, 'hvac', 'm1', NOW);
  assert.equal(first.ok, true);
  zone = first.zone;
  assert.equal(ex.seatHolder(zone, 'hvac'), 'm1');
  const taken = ex.assignSeat(zone, 'hvac', 'm2', NOW);
  assert.equal(taken.ok, false);
  assert.equal(taken.holder, 'm1');
  assert.equal(ex.assignSeat(zone, 'hvac', 'm1', NOW).ok, true);
  const released = ex.assignSeat(zone, 'hvac', null);
  assert.equal(ex.seatHolder(released.zone, 'hvac'), null);
});

test('a trade can hold several partners up to the network limit', () => {
  let zone = zones()[0];
  zone = ex.assignSeat(zone, 'interior_design', 'm1', NOW, 2).zone;
  zone = ex.assignSeat(zone, 'interior_design', 'm2', NOW, 2).zone;
  assert.deepEqual(ex.seatHolders(zone, 'interior_design'), ['m1', 'm2']);
  const full = ex.assignSeat(zone, 'interior_design', 'm3', NOW, 2);
  assert.equal(full.ok, false);
  assert.match(full.error, /already has 2 partners/);
  assert.equal(ex.assignSeat(zone, 'interior_design', 'm3', NOW, 0).ok, true);

  const plan = ex.planMemberSeats([zone], 'm1', { trades: [], zoneIds: [] }, NOW, 2);
  assert.deepEqual(ex.seatHolders(plan.changed[0], 'interior_design'), ['m2']);
});

test('legacy single-holder seats still read as one holder', () => {
  const zone = ex.normalizeZone({ id: 'z', name: 'Z', seats: { hvac: { memberId: 'm1', since: NOW } } });
  assert.deepEqual(ex.seatHolders(zone, 'hvac'), ['m1']);
  assert.equal(ex.seatsForMember([zone], 'm1').length, 1);
  assert.equal(ex.normalizeSeatLimit(undefined), 1);
  assert.equal(ex.normalizeSeatLimit('0'), 0);
});

test('referrals rotate to the partner sent one least recently, skipping sender and paused', () => {
  let zone = zones()[0];
  for (const id of ['m1', 'm2', 'm3']) zone = ex.assignSeat(zone, 'tile', id, NOW, 0).zone;
  const members = [{ id: 'm1', status: 'active' }, { id: 'm2', status: 'active' }, { id: 'm3', status: 'paused' }];
  const referrals = [
    { toMemberId: 'm1', createdAt: '2026-09-25T10:00:00.000Z' },
    { toMemberId: 'm2', createdAt: '2026-09-20T10:00:00.000Z' },
  ];
  assert.equal(ex.routeReferral(zone, 'tile', { members, referrals }).toMemberId, 'm2');
  assert.equal(ex.routeReferral(zone, 'tile', { members, referrals: [] }).toMemberId, 'm1');
  assert.equal(ex.routeReferral(zone, 'tile', { members, referrals, fromMemberId: 'm2' }).toMemberId, 'm1');
  const onlyPaused = ex.routeReferral(zone, 'tile', { members, fromMemberId: 'm1', referrals: [{ toMemberId: 'm2', createdAt: NOW }] });
  assert.equal(onlyPaused.toMemberId, 'm2');
});

test('planMemberSeats assigns wanted seats, releases dropped ones, reports conflicts', () => {
  const list = zones();
  list[1] = ex.assignSeat(list[1], 'plumbing', 'other', NOW).zone;
  list[0] = ex.assignSeat(list[0], 'roofing', 'm1', NOW).zone;
  const plan = ex.planMemberSeats(list, 'm1', { trades: ['plumbing'], zoneIds: ['z1', 'z2'] }, NOW);
  assert.equal(plan.conflicts.length, 1);
  assert.equal(plan.conflicts[0].zoneId, 'z2');
  const z1 = plan.changed.find((z) => z.id === 'z1');
  assert.equal(ex.seatHolder(z1, 'plumbing'), 'm1');
  assert.equal(ex.seatHolder(z1, 'roofing'), null);
  assert.equal(ex.seatsForMember(plan.changed, 'm1').length, 1);
});

test('routing goes to the active seat holder, otherwise unrouted with a reason', () => {
  const zone = ex.assignSeat(zones()[0], 'hvac', 'm1', NOW).zone;
  const members = [{ id: 'm1', status: 'active' }, { id: 'm2', status: 'active' }];
  assert.deepEqual(ex.routeReferral(zone, 'hvac', { members }), { toMemberId: 'm1', status: 'sent', reason: '' });
  assert.equal(ex.routeReferral(zone, 'plumbing', { members }).reason, 'open_seat');
  assert.equal(ex.routeReferral(null, 'hvac', { members }).reason, 'no_zone');
  assert.equal(ex.routeReferral(zone, 'hvac', { members, fromMemberId: 'm1' }).reason, 'sender_holds_seat');
  assert.equal(ex.routeReferral(zone, 'hvac', { members: [{ id: 'm1', status: 'paused' }] }).reason, 'member_paused');
});

test('buildReferral requires trade, homeowner contact and consent', () => {
  assert.equal(ex.buildReferral({ name: 'Jane', phone: '5125550100', consent: 'on' }).ok, false);
  assert.equal(ex.buildReferral({ tradeSlug: 'hvac', phone: '5125550100', consent: 'on' }).ok, false);
  assert.equal(ex.buildReferral({ tradeSlug: 'hvac', name: 'Jane', consent: 'on' }).ok, false);
  const noConsent = ex.buildReferral({ tradeSlug: 'hvac', name: 'Jane', phone: '5125550100' });
  assert.equal(noConsent.ok, false);
  assert.match(noConsent.error, /agreed/);
  const ok = ex.buildReferral({ tradeSlug: 'hvac', name: 'Jane', phone: '5125550100', zip: '78701', consent: 'on' }, NOW);
  assert.equal(ok.ok, true);
  assert.equal(ok.referral.status, 'unrouted');
  assert.equal(ok.referral.homeowner.consentAt, NOW);
  assert.equal(ok.referral.fromMemberId, 'operator');
});

test('status transitions: legal path and rejected jumps', () => {
  const built = ex.buildReferral({ tradeSlug: 'hvac', name: 'Jane', phone: '1', consent: true }, NOW).referral;
  const routed = ex.applyRouting(built, { status: 'sent', toMemberId: 'm1' }, NOW);
  assert.equal(routed.status, 'sent');
  assert.equal(ex.applyReferralAction(routed, 'book').ok, false);
  assert.equal(ex.applyReferralAction(routed, 'win', { value: 500 }).ok, false);
  const accepted = ex.applyReferralAction(routed, 'accept', { now: NOW }).referral;
  assert.equal(accepted.status, 'accepted');
  assert.deepEqual(ex.allowedActions(accepted).sort(), ['book', 'decline', 'lose', 'win']);
  const booked = ex.applyReferralAction(accepted, 'book').referral;
  const noValue = ex.applyReferralAction(booked, 'win', { value: '' });
  assert.equal(noValue.ok, false);
  assert.match(noValue.error, /job value/);
  const won = ex.applyReferralAction(booked, 'win', { value: '$4,250.50' }).referral;
  assert.equal(won.status, 'won');
  assert.equal(won.value, 4250.5);
  assert.equal(ex.applyReferralAction(won, 'decline').ok, false);
  assert.equal(ex.applyReferralAction(won, 'note', { text: 'Paid in full' }).referral.events.at(-1).type, 'note');
});

test('assign moves unrouted or declined referrals to a member, not back to the sender', () => {
  const built = ex.buildReferral({ tradeSlug: 'hvac', name: 'Jane', phone: '1', consent: true, fromMemberId: 'm9' }, NOW).referral;
  const unrouted = ex.applyRouting(built, { status: 'unrouted', reason: 'open_seat' }, NOW);
  assert.equal(unrouted.unroutedReason, 'open_seat');
  assert.equal(ex.applyReferralAction(unrouted, 'assign', {}).ok, false);
  assert.equal(ex.applyReferralAction(unrouted, 'assign', { toMemberId: 'm9' }).ok, false);
  const assigned = ex.applyReferralAction(unrouted, 'assign', { toMemberId: 'm2' }).referral;
  assert.equal(assigned.status, 'sent');
  assert.equal(assigned.toMemberId, 'm2');
  const declined = ex.applyReferralAction(assigned, 'decline').referral;
  assert.equal(ex.applyReferralAction(declined, 'assign', { toMemberId: 'm3' }).referral.toMemberId, 'm3');
});

test('member stats and network totals', () => {
  const refs = [
    { fromMemberId: 'm1', toMemberId: 'm2', status: 'won', value: 1000 },
    { fromMemberId: 'm2', toMemberId: 'm1', status: 'sent' },
    { fromMemberId: 'operator', toMemberId: 'm2', status: 'booked' },
    { fromMemberId: 'm1', toMemberId: null, status: 'unrouted' },
    { fromMemberId: 'operator', toMemberId: 'm2', status: 'declined' },
  ];
  assert.deepEqual(ex.memberStats(refs, 'm2'), { given: 1, received: 3, open: 1, accepted: 2, won: 1, wonValue: 1000 });
  assert.equal(ex.memberStats(refs, 'm1').given, 2);
  const totals = ex.networkTotals(refs);
  assert.equal(totals.total, 5);
  assert.equal(totals.open, 3);
  assert.equal(totals.unrouted, 1);
  assert.equal(totals.wonValue, 1000);
});
