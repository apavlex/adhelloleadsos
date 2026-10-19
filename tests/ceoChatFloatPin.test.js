/**
 * Alex chat FAB must stay glued to the lower-right corner (esp. on iOS Safari).
 */
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');

test('chat float pins to the visual viewport like the Money-mode dock', () => {
  const js = fs.readFileSync(path.join(root, 'public/js/ceo-chat-float.js'), 'utf8');
  assert.match(js, /function pinChatFloat/);
  assert.match(js, /scheduleChatFloatPin/);
  assert.match(js, /visualViewport/);
  assert.match(js, /translate3d\(/);
  assert.match(js, /document\.body\.appendChild\(root\)/);
  assert.match(js, /pageshow/);
});

test('chat float CSS forces fixed lower-right and stable compositing', () => {
  const css = fs.readFileSync(path.join(root, 'public/css/custom.css'), 'utf8');
  assert.match(css, /#ceoChatFloat\.app-floating-layer\s*\{[^}]*position:\s*fixed\s*!important/s);
  assert.match(css, /#ceoChatFloat\.app-floating-layer\s*\{[^}]*top:\s*auto\s*!important/s);
  assert.match(css, /\.app-floating-layer\s*\{[^}]*backface-visibility:\s*hidden/s);
});

test('shell does not nest two fixed floating layers', () => {
  const shell = fs.readFileSync(path.join(root, 'views/partials/app_shell_close.ejs'), 'utf8');
  const float = fs.readFileSync(path.join(root, 'views/partials/ceo_chat_float.ejs'), 'utf8');
  assert.match(shell, /id="appFloatingWidgets"[^>]*app-body-portal/);
  assert.doesNotMatch(shell, /id="appFloatingWidgets"[^>]*app-floating-layer/);
  assert.match(float, /id="ceoChatFloat"[^>]*app-floating-layer/);
});
