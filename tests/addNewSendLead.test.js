/**
 * Add New dropdown includes Send Lead → teammate lead form.
 */
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const nav = fs.readFileSync(path.join(__dirname, '../views/partials/app_nav_items.ejs'), 'utf8');

test('Add New menu includes Send Lead opener for network users', () => {
  const start = nav.indexOf('sidebar-new-menu');
  assert.ok(start >= 0);
  const block = nav.slice(start, nav.indexOf('</div>', nav.indexOf('data-open-send-referral', start)) + 6);
  assert.match(block, /<span>Opportunity<\/span>/);
  assert.match(block, /data-open-send-lead/);
  assert.match(block, /<span>Send Lead<\/span>/);
  assert.match(block, /data-open-send-referral/);
  assert.match(block, /<span>Referral<\/span>/);
  assert.ok(block.indexOf('Send Lead') < block.indexOf('Referral'), 'Send Lead before Referral');
});
