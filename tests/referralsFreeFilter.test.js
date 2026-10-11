const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');

test('Referral Partners marks free accounts and supports hide-free filter', () => {
  const route = fs.readFileSync(path.join(root, 'routes/referrals.js'), 'utf8');
  const view = fs.readFileSync(path.join(root, 'views/referrals.ejs'), 'utf8');

  assert.match(route, /isAppFree/);
  assert.match(route, /app_free/);
  assert.match(route, /hideFree/);
  assert.match(route, /freePartnerCount/);
  assert.match(route, /partners\.filter\(\(p\) => !p\.isAppFree\)/);

  assert.match(view, /ref-pill-free/);
  assert.match(view, /Free account/);
  assert.match(view, /ref-pill-active/);
  assert.match(view, />Active</);
  assert.match(view, /Hide free accounts/);
  assert.match(view, /name="hideFree"/);
  assert.match(view, /data-ref-free/);
  // Notes stay on the dashboard cards.
  assert.match(view, /Add a note on this lead/);
  assert.match(view, /data-ref-note-form/);
});
