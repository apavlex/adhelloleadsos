const test = require('node:test');
const assert = require('node:assert/strict');
const referral = require('../services/referralNetwork');

const leads = [
  {
    key: 'a',
    title: 'Lone Star Realty',
    categoryName: 'Real estate agent',
    city: 'Austin',
    state: 'TX',
    totalScore: 4.9,
    reviewsCount: 212,
    website: 'https://example.com',
  },
  {
    key: 'b',
    title: 'Hill Country Insurance',
    categoryName: 'Insurance broker',
    city: 'Austin',
    state: 'TX',
    totalScore: 4.8,
    reviewsCount: 96,
    website: 'https://example.com',
    referralPartner: { highlighted: true, status: 'intro_sent', sent: 1, received: 0 },
  },
  {
    key: 'c',
    title: 'Quiet Plumber',
    categoryName: 'Plumber',
    city: 'Dallas',
    state: 'TX',
    totalScore: 3,
    reviewsCount: 2,
  },
];

test('search matches any comma-separated trade and ranks reviews, rating, and website', () => {
  const rows = referral.listPartners(leads, 'real estate, insurance');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].title, 'Lone Star Realty');
  assert.equal(rows[0].website, true);
  assert.equal(rows[1].status, 'intro_sent');
});

test('an empty search shows only the highlighted network', () => {
  const rows = referral.listPartners(leads, '');
  assert.deepEqual(rows.map((row) => row.key), ['b']);
});

test('connect, intro, and referral tallies stay on the partner record', () => {
  const connected = referral.applyPartnerAction(leads[0], 'connect', '2026-09-22T00:00:00.000Z');
  assert.equal(connected.ok, true);
  assert.equal(connected.referralPartner.status, 'connected');
  assert.equal(connected.referralPartner.highlighted, true);
  const intro = referral.applyPartnerAction({ referralPartner: connected.referralPartner }, 'intro');
  assert.equal(intro.referralPartner.status, 'intro_sent');
  const sent = referral.applyPartnerAction({ referralPartner: intro.referralPartner }, 'sent');
  const received = referral.applyPartnerAction({ referralPartner: sent.referralPartner }, 'received');
  assert.equal(received.referralPartner.sent, 1);
  assert.equal(received.referralPartner.received, 1);
  const cleared = referral.applyPartnerAction({ referralPartner: received.referralPartner }, 'clear');
  assert.equal(cleared.referralPartner.highlighted, false);
  assert.equal(cleared.referralPartner.status, '');
});

test('removing a partner keeps them off the board after referrals were tracked', () => {
  const cleared = referral.applyPartnerAction({
    referralPartner: { highlighted: true, status: 'connected', sent: 2, received: 1 },
  }, 'clear');
  assert.equal(cleared.referralPartner.highlighted, false);
  assert.equal(cleared.referralPartner.status, '');
  const rows = referral.listPartners([
    { key: 'a', title: 'Lone Star Realty', referralPartner: cleared.referralPartner },
  ], '');
  assert.equal(rows.length, 0);
});

test('network totals count highlighted partners and tracked referrals', () => {
  const totals = referral.networkTotals(leads);
  assert.equal(totals.partners, 1);
  assert.equal(totals.intros, 1);
  assert.equal(totals.sent, 1);
});
