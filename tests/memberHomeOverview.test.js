/**
 * Member-app Home lead-source overview + ?source= filter.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  formLeadChannel,
  buildOverview,
  filterBySource,
} = require('../services/memberHomeOverview');

describe('memberHomeOverview', () => {
  it('classifies form leads as website vs agency', () => {
    assert.equal(formLeadChannel({ source: 'agency' }), 'agency');
    assert.equal(formLeadChannel({ source: 'Agency' }), 'agency');
    assert.equal(formLeadChannel({ source: 'website' }), 'website');
    assert.equal(formLeadChannel({ source: '' }), 'website');
    assert.equal(formLeadChannel(null), 'website');
  });

  it('aggregates need-you counts and source rows', () => {
    const overview = buildOverview({
      base: '/m/tok',
      memberId: 'm1',
      appointment: {
        formLeads: [
          { id: 'w1', name: 'Web Lead', source: 'website', status: 'open', at: '2026-10-12T10:00:00.000Z', formName: 'Contact' },
          { id: 'a1', name: 'Agency Lead', source: 'agency', status: 'open', at: '2026-10-12T11:00:00.000Z', formName: 'Assigned' },
          { id: 'c1', name: 'Closed', source: 'website', status: 'closed', at: '2026-10-11T10:00:00.000Z' },
        ],
        tracker: { counts: { remaining: 7 } },
        leadCredits: { remaining: 3 },
        portalPath: '/c/portal',
      },
      referrals: [
        { id: 'r1', toMemberId: 'm1', status: 'sent', createdAt: '2026-10-12T12:00:00.000Z', tradeSlug: 'roofing', homeowner: { name: 'Pat' } },
        { id: 'r2', toMemberId: 'm1', status: 'accepted', createdAt: '2026-10-10T12:00:00.000Z' },
        { id: 'r3', status: 'unrouted', createdAt: '2026-10-12T09:00:00.000Z' },
      ],
      presentReferral: (r) => ({
        customer: r.homeowner || {},
        trade: 'Roofing',
        from: 'Partner Co',
      }),
    });

    assert.equal(overview.needYou, 3);
    assert.equal(overview.websiteCount, 1);
    assert.equal(overview.agencyCount, 1);
    assert.equal(overview.referralCount, 1);
    assert.equal(overview.purchasedLeft, 7);
    assert.equal(overview.creditsLeft, 3);
    assert.equal(overview.poolOpen, 1);
    assert.equal(overview.sources.length, 4);
    assert.equal(overview.sources[0].href, '/m/tok/referrals?source=website');
    assert.equal(overview.sources[1].href, '/m/tok/referrals?source=agency');
    assert.equal(overview.sources[2].href, '/m/tok/referrals?source=referral');
    assert.equal(overview.sources[2].hint, '1 in pool');
    assert.equal(overview.sources[3].href, '/c/portal');
    assert.equal(overview.attention.length, 3);
    assert.equal(overview.attention[0].kind, 'referral');
    assert.match(overview.attention[0].href, /source=referral#ref-r1/);
  });

  it('filters Leads lists by source', () => {
    const formLeads = [
      { id: 'w1', source: 'website' },
      { id: 'a1', source: 'agency' },
    ];
    const received = [{ id: 'r1' }];

    assert.deepEqual(filterBySource('website', { formLeads, received }), {
      formLeads: [{ id: 'w1', source: 'website' }],
      received: [],
      sourceFilter: 'website',
    });
    assert.deepEqual(filterBySource('agency', { formLeads, received }), {
      formLeads: [{ id: 'a1', source: 'agency' }],
      received: [],
      sourceFilter: 'agency',
    });
    assert.deepEqual(filterBySource('referral', { formLeads, received }), {
      formLeads: [],
      received,
      sourceFilter: 'referral',
    });
    assert.equal(filterBySource('', { formLeads, received }).sourceFilter, '');
    assert.equal(filterBySource('website', { formLeads, received }).formLeads.length, 1);
  });

  it('wires Home overview + referrals source filter into the app', () => {
    const root = path.join(__dirname, '..');
    const home = fs.readFileSync(path.join(root, 'views/member_app/home.ejs'), 'utf8');
    const referrals = fs.readFileSync(path.join(root, 'views/member_app/referrals.ejs'), 'utf8');
    const route = fs.readFileSync(path.join(root, 'routes/memberApp.js'), 'utf8');
    const css = fs.readFileSync(path.join(root, 'public/css/member-app.css'), 'utf8');

    assert.match(route, /memberHomeOverview/);
    assert.match(route, /buildOverview\(/);
    assert.match(route, /filterBySource\(/);
    assert.match(route, /sourceFilter/);
    assert.match(home, /ma-sources/);
    assert.match(home, /_overview\.needYou/);
    assert.match(home, /Needs attention/);
    assert.match(home, /_attention\.forEach/);
    assert.match(referrals, /ma-source-filter/);
    assert.match(referrals, /source=website/);
    assert.match(referrals, /source=agency/);
    assert.match(referrals, /source=referral/);
    assert.match(css, /\.ma-sources\b/);
    assert.match(css, /\.ma-source-filter\b/);
  });
});
