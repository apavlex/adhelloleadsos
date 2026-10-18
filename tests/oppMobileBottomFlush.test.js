/**
 * Opportunities on iPhone must not leave a cream shelf under the board that
 * only disappears after a rubber-band settle (stale 100dvh + cream html/body).
 */
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');
const board = fs.readFileSync(path.join(root, 'views/partials/opportunity_board.ejs'), 'utf8');
const page = fs.readFileSync(path.join(root, 'views/opportunities.ejs'), 'utf8');

test('opportunities page does not paint cream body behind the board', () => {
  assert.doesNotMatch(page, /class="[^"]*\bbg-brand-bg\b/);
  assert.match(board, /html:has\(body\.opp-page\)/);
  assert.match(board, /html:has\(body\.opp-page\)\s+body\.opp-page/);
});

test('phone opp-page locks to the visual viewport (no cream shelf under board)', () => {
  const phone = board.slice(board.indexOf('/* Phones: board fills the screen'));
  assert.match(phone, /body\.opp-page\s*\{[^}]*position:\s*fixed/s);
  assert.match(phone, /body\.opp-page\s*\{[^}]*inset:\s*0/s);
  assert.match(phone, /-webkit-fill-available/);
  assert.match(phone, /overscroll-behavior:\s*none/);
  assert.match(
    phone,
    /main\.opp-page-main[\s\S]*?padding-bottom:\s*0\s*!important/,
  );
});
