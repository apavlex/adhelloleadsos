/**
 * Partner cards keep Sent/Received count metrics only — Connected/Intro are pills.
 */
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const html = fs.readFileSync(path.join(__dirname, '../views/referrals.ejs'), 'utf8');

test('referrals partner metrics only include sent and received count cards', () => {
  const start = html.indexOf('<div class="ref-metrics">');
  assert.ok(start >= 0);
  const block = html.slice(start, start + 900);
  assert.match(block, /data-ref-metric="sent"/);
  assert.match(block, /data-ref-metric="received"/);
  assert.doesNotMatch(block, /data-ref-metric="connected"/);
  assert.doesNotMatch(block, /data-ref-metric="intro"/);
});

test('connected and intro status remain as pills', () => {
  assert.match(html, /ref-pill-connected/);
  assert.match(html, /ref-pill-intro/);
  assert.match(html, /data-ref-pill/);
});

test('top summary drops Free and Paid cards', () => {
  const start = html.indexOf('grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6');
  assert.ok(start >= 0);
  const block = html.slice(start, html.indexOf('</div>', html.indexOf('data-ref-total="received"', start)) + 6);
  assert.match(block, /Partners/);
  assert.match(block, /Connected/);
  assert.match(block, /Leads sent/);
  assert.match(block, /Leads received/);
  assert.doesNotMatch(block, />Free</);
  assert.doesNotMatch(block, />Paid</);
  assert.doesNotMatch(block, /data-ref-total="free"/);
  assert.doesNotMatch(block, /data-ref-total="paid"/);
});
