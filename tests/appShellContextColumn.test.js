const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

describe('app shell context column', () => {
  it('keeps main content in column 3 even without has-context-sidebar', () => {
    const css = fs.readFileSync(path.join(root, 'public/css/custom.css'), 'utf8');
    const shell = fs.readFileSync(path.join(root, 'views/partials/app_shell_styles.ejs'), 'utf8');

    assert.match(css, /\.app-shell-content\s*\{[^}]*grid-column:\s*3/s);
    assert.doesNotMatch(
      css,
      /:not\(\.has-context-sidebar\)\s+\.app-shell-content\s*\{[^}]*grid-column:\s*2/s,
    );

    assert.match(shell, /\.app-shell-content\s*\{[^}]*grid-column:\s*3/s);
    assert.doesNotMatch(
      shell,
      /:not\(\.has-context-sidebar\)\s+\.app-shell-content\s*\{[^}]*grid-column:\s*2/s,
    );
  });
});
