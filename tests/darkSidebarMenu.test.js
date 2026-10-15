/**
 * Dark-mode sidebar menu labels should be white on the dark background.
 */
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const css = fs.readFileSync(path.join(__dirname, '..', 'public/css/custom.css'), 'utf8');

test('dark sidebar menu text and icons are white / near-white', () => {
  const block = css.match(/\.dark\s+\.ghl-sidebar\s*\{[^}]+\}/);
  assert.ok(block, 'expected .dark .ghl-sidebar variable block');
  assert.match(block[0], /--ghl-sidebar-text:\s*#fff(?:fff)?/i);
  assert.match(block[0], /--ghl-sidebar-text-strong:\s*#fff(?:fff)?/i);
  assert.match(block[0], /--ghl-sidebar-icon:\s*#f1f5f9/i);
});
