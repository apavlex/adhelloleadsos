/**
 * Brand icon sits to the left of Leads Network and Referral Network titles.
 */
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const html = fs.readFileSync(path.join(__dirname, '../views/network.ejs'), 'utf8');

test('network header uses a title row with brand icon left of the title', () => {
  assert.match(html, /class="net-title-row/);
  assert.match(html, /class="net-title-icon"/);
  assert.match(html, /titleIconSrc/);
});

test('title icon appears once for both leads and referral headers', () => {
  const headerStart = html.indexOf('<header class="mb-6');
  const headerEnd = html.indexOf('</header>', headerStart);
  const header = html.slice(headerStart, headerEnd);
  assert.match(header, /net-title-icon/);
  assert.match(header, /onLeadsNetwork/);
  assert.match(header, /Leads Network/);
  assert.match(header, /Referral network/);
  assert.equal((header.match(/net-title-icon/g) || []).length, 1);
});
