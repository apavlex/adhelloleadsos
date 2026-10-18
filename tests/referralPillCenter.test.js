/**
 * Referral status pills keep label text centered (Won $ · Needs a member · Sent).
 */
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const html = fs.readFileSync(path.join(__dirname, '../views/network.ejs'), 'utf8');

test('net-pill centers label text like Sent', () => {
  const start = html.indexOf('.net-pill {');
  assert.ok(start >= 0);
  const block = html.slice(start, html.indexOf('}', start) + 1);
  assert.match(block, /justify-content:\s*center/);
  assert.match(block, /text-align:\s*center/);
  assert.match(block, /white-space:\s*nowrap/);
  assert.match(block, /align-items:\s*center/);
});
