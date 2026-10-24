const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.APP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cust-ref-'));
process.env.SESSION_SECRET = 'cust-ref-test-secret';
process.env.REVIEW_PUBLIC_BASE_URL = 'https://reviews.adhello.io';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const links = require('../services/customerReferralLinks');

describe('customer referral unique links', () => {
  it('mints a stable unique URL per customer', async () => {
    const first = await links.ensureAdvocateLink({
      networkId: 'n1',
      memberId: 'm1',
      customerId: 'custabcd01',
      name: 'Pat Lee',
      phone: '+15551230001',
    });
    assert.equal(first.ok, true);
    assert.equal(first.created, true);
    assert.match(first.url, /^https:\/\/reviews\.adhello\.io\/rf\/[a-z0-9]+$/);
    assert.ok(links.isCode(first.advocate.code));

    const again = await links.ensureAdvocateLink({
      networkId: 'n1',
      memberId: 'm1',
      customerId: 'custabcd01',
      name: 'Pat Lee',
    });
    assert.equal(again.ok, true);
    assert.equal(again.created, false);
    assert.equal(again.advocate.code, first.advocate.code);
    assert.equal(again.url, first.url);
  });

  it('tracks clicks and conversions for the dashboard', async () => {
    const minted = await links.ensureAdvocateLink({
      networkId: 'n2',
      memberId: 'm2',
      customerId: 'custefgh02',
      name: 'Alex Kim',
      email: 'alex@example.com',
    });
    await links.recordClick(minted.advocate.code);
    await links.recordClick(minted.advocate.code);
    const conv = await links.recordConversion(minted.advocate.code, {
      name: 'Friend One',
      phone: '+15550001111',
      note: 'Needs a quote',
    });
    assert.equal(conv.ok, true);

    const second = await links.ensureAdvocateLink({
      networkId: 'n2',
      memberId: 'm2',
      customerId: 'custijkl03',
      name: 'Sam Woo',
    });
    await links.recordConversion(second.advocate.code, { name: 'A', phone: '1' });
    await links.recordConversion(second.advocate.code, { name: 'B', phone: '2' });
    await links.recordConversion(second.advocate.code, { name: 'C', phone: '3' });

    const list = await links.listForMember('n2', 'm2');
    const dash = links.buildDashboard(list);
    assert.equal(dash.totalAdvocates, 2);
    assert.equal(dash.totalReferrals, 4);
    assert.equal(dash.awaitingRewardCount, 4);
    assert.equal(dash.top[0].name, 'Sam Woo');
    assert.equal(dash.top[0].referrals, 3);
    assert.equal(dash.top[0].rank, 1);
    assert.equal(dash.top[0].initial, 'S');
    assert.equal(dash.top[1].name, 'Alex Kim');
    assert.equal(dash.top[1].clicks, 2);

    const phoneOnly = await links.ensureAdvocateLink({
      networkId: 'n2',
      memberId: 'm2',
      customerId: 'custphone04',
      name: '+19077956646',
      phone: '+19077956646',
    });
    assert.equal(phoneOnly.ok, true);
    const dashPhone = links.buildDashboard(await links.listForMember('n2', 'm2'));
    const phoneRow = dashPhone.all.find((r) => r.customerId === 'custphone04');
    assert.ok(phoneRow);
    assert.equal(phoneRow.initial, 'C');
    assert.equal(phoneRow.name, '+19077956646');

    const rewarded = await links.markConversionStatus(
      minted.advocate.code,
      conv.conversion.id,
      'rewarded',
    );
    assert.equal(rewarded.ok, true);
    const dash2 = links.buildDashboard(await links.listForMember('n2', 'm2'));
    assert.equal(dash2.awaitingRewardCount, 3);
    assert.ok(dash2.rewarded.some((r) => r.conversionId === conv.conversion.id));
  });

  it('Send page exposes Lead / Link / Board tabs and simple board UI', () => {
    const send = fs.readFileSync(path.join(__dirname, '../views/member_app/send.ejs'), 'utf8');
    const css = fs.readFileSync(path.join(__dirname, '../public/css/member-app.css'), 'utf8');
    const route = fs.readFileSync(path.join(__dirname, '../routes/memberApp.js'), 'utf8');
    const publicRoute = fs.readFileSync(path.join(__dirname, '../routes/customerReferralPublic.js'), 'utf8');
    assert.match(send, /view=link/);
    assert.match(send, /view=board/);
    assert.match(send, /Request a referral/);
    assert.match(send, /earn a giveaway or your reward/);
    assert.match(send, /Search by name or phone/);
    assert.match(send, /data-ma-customer-pick/);
    assert.match(send, /data-ma-pick-mode="saved"/);
    assert.match(send, /Top referrers/);
    assert.match(send, /Reward customers/);
    assert.match(send, /Mark rewarded/);
    assert.match(send, /Their unique referral link/);
    assert.match(send, /ma-refdash__stats/);
    // Rows are divs (not one giant underlined <a>) so layout can’t collapse.
    assert.match(send, /class="ma-refdash__row"/);
    assert.match(send, /class="ma-refdash__who"/);
    assert.doesNotMatch(send, /<a class="ma-refdash__row"/);
    assert.match(css, /\.ma-refdash__board/);
    assert.match(css, /\.ma-refdash__reward-row/);
    assert.match(css, /\.ma-refdash__row\s*\{[^}]*display:\s*grid\s*!important/);
    const head = fs.readFileSync(path.join(__dirname, '../views/member_app/_head.ejs'), 'utf8');
    assert.match(head, /\.ma-refdash__row\{display:grid!important/);
    assert.match(head, /a\.ma-refdash__who\{display:flex!important/);
    assert.match(route, /SEND_VIEWS/);
    assert.match(route, /customerReferralLinks/);
    assert.match(route, /send\/referral\/:code\/:conversionId/);
    assert.match(route, /cust_ref_rewarded/);
    assert.match(publicRoute, /\/rf\/:code/);
    assert.match(publicRoute, /source: 'customer_referral'/);
    const js = fs.readFileSync(path.join(__dirname, '../public/js/member-app.js'), 'utf8');
    assert.match(js, /data-ma-pick-mode/);
    assert.match(js, /name="customer"/);
    assert.match(js, /savedOnly/);
    const tabbar = fs.readFileSync(path.join(__dirname, '../views/member_app/_tabbar.ejs'), 'utf8');
    assert.match(tabbar, /label: 'Referrals'/);
    assert.doesNotMatch(tabbar, /id: 'send', label: 'Send'/);
  });
});

describe('reward script includes referral_link', () => {
  it('fills {{referral_link}} and appends when missing', () => {
    const reward = require('../services/reviewReferralReward');
    const withPh = reward.buildCustomerMessage(
      {
        enabled: true,
        rewardLabel: '$25',
        rewardScript: 'Hi {{name}} — share {{referral_link}} for {{reward}}',
      },
      { name: 'Pat', company: 'Acme', stars: 5, referralLink: 'https://reviews.adhello.io/rf/abc123def0' },
    );
    assert.match(withPh, /https:\/\/reviews\.adhello\.io\/rf\/abc123def0/);
    assert.match(withPh, /\$25/);

    const noPh = reward.buildCustomerMessage(
      {
        enabled: true,
        rewardLabel: '$10 off',
        rewardScript: 'Thanks {{name}}! Refer a friend to {{company}}.',
      },
      { name: 'Pat', company: 'Acme', stars: 5, referralLink: 'https://reviews.adhello.io/rf/abc123def0' },
    );
    assert.match(noPh, /https:\/\/reviews\.adhello\.io\/rf\/abc123def0/);
  });
});
