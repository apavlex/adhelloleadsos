const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');

test('mobile app shell hides the marketing footer band', () => {
  const footer = fs.readFileSync(path.join(root, 'views/partials/footer.ejs'), 'utf8');
  assert.match(footer, /app-shell-footer/);
  assert.match(footer, /py-3 md:py-6/);
  assert.doesNotMatch(footer, /py-8/);

  const shell = fs.readFileSync(path.join(root, 'views/partials/app_shell_styles.ejs'), 'utf8');
  assert.match(shell, /footer\.app-shell-footer/);
  assert.match(shell, /display:\s*none/);

  const css = fs.readFileSync(path.join(root, 'public/css/custom.css'), 'utf8');
  assert.match(css, /footer\.app-shell-footer/);
});
