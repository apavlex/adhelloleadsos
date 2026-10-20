/**
 * Inverse chips (white fill in dark mode) must not use --brand-dark for ink —
 * that token flips to light body copy and washes out labels (Today tabs, etc.).
 */
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');
const css = fs.readFileSync(path.join(root, 'public/css/custom.css'), 'utf8');
const today = fs.readFileSync(path.join(root, 'views/today.ejs'), 'utf8');

test('dark mode forces dark ink on dark:bg-white + dark:text-brand-dark chips', () => {
  assert.match(
    css,
    /html\.dark\s+\[class~="dark:bg-white"\]\[class~="dark:text-brand-dark"\][\s\S]*?color:\s*#0f172a\s*!important/i,
  );
});

test('Today main tabs use slate-900 ink on the dark-mode white active pill', () => {
  assert.match(today, /dark:bg-white dark:text-slate-900/);
  assert.match(today, /toggle\('dark:text-slate-900',\s*active\)/);
  assert.doesNotMatch(today, /toggle\('dark:text-brand-dark',\s*active\)/);
});
