/**
 * Job / project view drops Call / Directions / Add to calendar —
 * those live on the customer profile instead.
 */
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const html = fs.readFileSync(path.join(__dirname, '../views/member_app/job.ejs'), 'utf8');

test('job view does not show Add to calendar, Call, or Directions', () => {
  assert.doesNotMatch(html, /Add to calendar/);
  assert.doesNotMatch(html, /calendar\.ics/);
  assert.doesNotMatch(html, /> Call</);
  assert.doesNotMatch(html, /Directions/);
  assert.doesNotMatch(html, /jobMapsHref/);
});

test('job view still has status steps and the edit form', () => {
  assert.match(html, /data-ma-status-steps/);
  assert.match(html, /jbValue/);
  assert.match(html, /jbCustomer/);
});

test('new job / schedule work uses searchable customer pick with add-new', () => {
  assert.match(html, /data-ma-customer-pick/);
  assert.match(html, /data-ma-new-value="new"/);
  assert.match(html, /data-ma-add-customer-href/);
  assert.match(html, /Search or type a new name/);
  assert.match(html, /Add new customer/);
  assert.match(html, /customers\/new/);
  assert.match(html, /newCustomerName/);
});
