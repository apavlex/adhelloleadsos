const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');

test('Referral Partners marks free accounts and supports hide-free filter', () => {
  const route = fs.readFileSync(path.join(root, 'routes/referrals.js'), 'utf8');
  const view = fs.readFileSync(path.join(root, 'views/referrals.ejs'), 'utf8');

  assert.match(route, /isAppFree/);
  assert.match(route, /app_free/);
  assert.match(route, /hideFree/);
  assert.match(route, /freePartnerCount/);
  assert.match(route, /paidPartnerCount/);
  assert.match(route, /hasSeat/);
  assert.match(route, /partners\.filter\(\(p\) => !p\.isAppFree\)/);

  assert.match(view, /ref-pill-free/);
  assert.match(view, /Free account/);
  assert.match(view, /ref-pill-active/);
  assert.match(view, />Active</);
  assert.match(view, /Hide free accounts/);
  assert.match(view, /name="hideFree"/);
  assert.match(view, /data-ref-free/);
  assert.match(view, /data-ref-total="free"/);
  assert.match(view, /data-ref-total="paid"/);
  assert.match(view, /Joined/);
  assert.match(view, /joinedWhen|data-ref-joined/);
  assert.match(view, /data-ref-place|partner\.zip/);
  assert.match(route, /joinedWhen/);
  assert.match(route, /formatWhen/);
  // Joined date sits under the phone on the left (before pills wrap).
  const joinedIdx = view.indexOf('data-ref-joined');
  const pillsIdx = view.indexOf('data-ref-pill-wrap');
  assert.ok(joinedIdx > 0 && pillsIdx > joinedIdx);
  // Notes stay on the dashboard cards.
  assert.match(view, /Add a note on this lead/);
  assert.match(view, /data-ref-note-form/);
});

test('formatWhen renders a short joined date', () => {
  const referralNetwork = require('../services/referralNetwork');
  assert.match(referralNetwork.formatWhen('2026-10-11T15:39:00.000Z'), /Oct 11/);
  assert.equal(referralNetwork.formatWhen(''), '');
});

test('partner cards include city, state, and zip', () => {
  const referralNetwork = require('../services/referralNetwork');
  const card = referralNetwork.presentPartner({
    key: 'rk',
    title: 'RK Homes',
    city: 'Camas',
    state: 'WA',
    zip: '98607',
    phone: '3606089487',
    referralPartner: { highlighted: true, status: 'connected' },
  });
  assert.equal(card.city, 'Camas');
  assert.equal(card.state, 'WA');
  assert.equal(card.zip, '98607');
  const fromPostal = referralNetwork.presentPartner({
    key: 'p',
    title: 'Postal',
    postalCode: '97201',
  });
  assert.equal(fromPostal.zip, '97201');
});
