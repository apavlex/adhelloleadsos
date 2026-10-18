/**
 * Referral Network opens on Referrals (not Seats).
 */
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const route = fs.readFileSync(path.join(__dirname, '../routes/network.js'), 'utf8');
const nav = fs.readFileSync(path.join(__dirname, '../views/partials/app_nav_items.ejs'), 'utf8');

test('network GET defaults to referrals tab', () => {
  assert.match(route, /TABS\.has\(String\(req\.query\.tab \|\| ''\)\) \? String\(req\.query\.tab\) : 'referrals'/);
  assert.doesNotMatch(route, /\? String\(req\.query\.tab\) : 'seats'/);
});

test('sidebar Referral Network link opens referrals tab', () => {
  assert.match(nav, /href="\/network\?tab=referrals"/);
  assert.match(nav, /<span>Referral Network<\/span>/);
});
