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

  it('Send page exposes Send / Request / Analytics and SMS script fold on Request', () => {
    const send = fs.readFileSync(path.join(__dirname, '../views/member_app/send.ejs'), 'utf8');
    const css = fs.readFileSync(path.join(__dirname, '../public/css/member-app.css'), 'utf8');
    const route = fs.readFileSync(path.join(__dirname, '../routes/memberApp.js'), 'utf8');
    const publicRoute = fs.readFileSync(path.join(__dirname, '../routes/customerReferralPublic.js'), 'utf8');
    const setup = fs.readFileSync(path.join(__dirname, '../views/member_app/_referral_setup.ejs'), 'utf8');
    assert.match(send, />Send</);
    assert.match(send, /view=request/);
    assert.match(send, /view=analytics/);
    assert.match(send, />Request</);
    assert.match(send, />Analytics/);
    assert.doesNotMatch(send, />Script</);
    assert.doesNotMatch(send, /ma-seg--4/);
    assert.match(send, /ma-seg--3/);
    assert.match(send, /ma-fold/);
    assert.match(send, /id="maRefScript"/);
    assert.match(send, /SMS script/);
    assert.match(send, /_referral_setup/);
    assert.match(send, /Request a referral/);
    assert.match(send, /Send a referral/);
    assert.match(send, /unique tracked referral URL|earn a giveaway or your reward/);
    assert.match(send, /Type a name or phone|Search any customer/);
    assert.match(send, /results update as you type/);
    assert.match(send, /data-ma-customer-pick/);
    assert.match(send, /data-ma-pick-mode="saved"/);
    assert.match(send, /Top referrers/);
    assert.match(send, /Reward customers/);
    assert.match(send, /Mark rewarded/);
    assert.match(send, /Their unique referral link/);
    assert.match(send, /ma-refdash__stats/);
    assert.match(send, /See analytics/);
    // Rows are divs (not one giant underlined <a>) so layout can’t collapse.
    assert.match(send, /class="ma-refdash__row"/);
    assert.match(send, /class="ma-refdash__who"/);
    assert.doesNotMatch(send, /<a class="ma-refdash__row"/);
    assert.match(send, /aria-label="Send referral options"/);
    assert.match(send, />Send</);
    assert.doesNotMatch(send, />Send link</);
    assert.match(send, />Request</);
    assert.match(send, />Analytics/);
    assert.doesNotMatch(send, />Board</);
    assert.match(setup, /SMS request script|unique referral link/);
    assert.match(setup, /referralShareScript/);
    assert.match(setup, /Referral reward/);
    assert.match(setup, /name="rewardLabel"/);
    assert.match(css, /\.ma-fold/);
    assert.match(css, /\.ma-refdash__board/);
    assert.match(css, /\.ma-refdash__reward-row/);
    assert.match(css, /\.ma-refdash__row\s*\{[^}]*display:\s*grid\s*!important/);
    const head = fs.readFileSync(path.join(__dirname, '../views/member_app/_head.ejs'), 'utf8');
    assert.match(head, /\.ma-refdash__row\{display:grid!important/);
    assert.match(head, /a\.ma-refdash__who\{display:flex!important/);
    assert.match(route, /SEND_VIEWS/);
    assert.match(route, /normalizeSendView/);
    assert.match(route, /send\/setup/);
    assert.match(route, /share_script_saved/);
    assert.match(route, /view=request/);
    assert.match(route, /referralSetupOpen/);
    assert.match(route, /customerReferralLinks/);
    assert.match(route, /send\/referral\/:code\/:conversionId/);
    assert.match(route, /cust_ref_rewarded/);
    assert.match(route, /All customers \(not just review-givers\)/);
    assert.match(publicRoute, /\/rf\/:code/);
    assert.match(publicRoute, /source: 'customer_referral'/);
    const svc = fs.readFileSync(path.join(__dirname, '../services/customerReferralLinks.js'), 'utf8');
    assert.match(svc, /DEFAULT_SHARE_SCRIPT/);
    assert.match(svc, /fillShareScript/);
    assert.match(svc, /\{\{\s*referral_link\s*\}\}/);
    const js = fs.readFileSync(path.join(__dirname, '../public/js/member-app.js'), 'utf8');
    assert.match(js, /data-ma-pick-mode/);
    assert.match(js, /name="customer"/);
    assert.match(js, /savedOnly/);
    assert.match(js, /limit:\s*80/);
    const tabbar = fs.readFileSync(path.join(__dirname, '../views/member_app/_tabbar.ejs'), 'utf8');
    assert.match(tabbar, /label: 'Referrals'/);
    assert.doesNotMatch(tabbar, /id: 'send', label: 'Send'/);
  });

  it('fills custom SMS share scripts with placeholders', () => {
    const text = links.fillShareScript(
      'Hey {{name}} from {{company}} — {{reward}} → {{referral_link}}',
      {
        name: 'John Cody',
        company: 'TPR Flooring',
        reward: '$25 gift card',
        url: 'https://reviews.adhello.io/rf/abc123',
      },
    );
    // Greeting uses first name only (not "John Cody").
    assert.match(text, /Hey John from TPR Flooring/);
    assert.doesNotMatch(text, /John Cody/);
    assert.match(text, /\$25 gift card/);
    assert.match(text, /\/rf\/abc123/);
    const def = links.shareSmsText({
      name: 'Sam',
      company: 'Acme',
      url: 'https://reviews.adhello.io/rf/x',
      reward: '',
    });
    assert.match(def, /Hi Sam/);
    assert.match(def, /giveaway or your reward/);
    assert.equal(links.firstNameForSms('john cody'), 'john');
    assert.equal(links.firstNameForSms('  Pat  '), 'Pat');
    assert.equal(links.firstNameForSms(''), 'there');
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
