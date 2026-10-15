/**
 * Dark-mode sidebar menu labels should be white on the dark background.
 */
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const css = fs.readFileSync(path.join(__dirname, '..', 'public/css/custom.css'), 'utf8');

test('dark sidebar menu text and icons are white / near-white', () => {
  assert.match(css, /\.dark\s+\.ghl-sidebar[\s\S]*?--ghl-sidebar-text:\s*#ffffff/i);
  assert.match(css, /--ghl-sidebar-text-strong:\s*#ffffff/i);
  assert.match(css, /--ghl-sidebar-icon:\s*#f1f5f9/i);
  // Hard override so menu ink wins over body text-brand-dark / cached CSS.
  assert.match(css, /html\.dark\s+\.ghl-sidebar\s+\.sidebar-nav-link[\s\S]*?color:\s*#ffffff\s*!important/i);
  assert.match(css, /html\.dark\s+#appSidebar\s+\.sidebar-nav-link[\s\S]*?color:\s*#ffffff\s*!important/i);
});
