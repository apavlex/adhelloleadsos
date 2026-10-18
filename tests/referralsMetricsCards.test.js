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
