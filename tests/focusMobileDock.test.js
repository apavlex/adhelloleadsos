const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

test('Money mode Call/SMS dock pins to the visual viewport on iOS', () => {
  const focus = fs.readFileSync(path.join(__dirname, '../views/focus.ejs'), 'utf8');
  assert.match(focus, /function pinFocusMobileDock/);
  assert.match(focus, /visualViewport\.addEventListener\('resize'/);
  assert.match(focus, /visualViewport\.addEventListener\('scroll'/);
  assert.match(focus, /translate3d\(/);
  assert.match(focus, /scheduleFocusDockPin/);
  assert.match(focus, /\.focus-mobile-dock\s*\{[^}]*top:\s*auto/s);
  assert.match(focus, /id="focus-mobile-fab-wrap"[^>]*focus-mobile-dock/);
});
