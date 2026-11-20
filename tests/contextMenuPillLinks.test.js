const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.join(__dirname, '..', 'public/css/custom.css'), 'utf8');

describe('second-menu pill links', () => {
  it('styles context links as round pills with brand active fill', () => {
    assert.match(css, /\.app-context-link\s*\{[^}]*border-radius:\s*999px/s);
    assert.match(
      css,
      /\.app-context-link\.is-active\s*\{[^}]*background:\s*var\(--brand-yellow/s
    );
    assert.match(
      css,
      /\.app-context-link\.is-active\s*\{[^}]*color:\s*var\(--brand-on-accent/s
    );
  });

  it('styles refine chips active state with brand color', () => {
    assert.match(
      css,
      /\.app-context-chip\.is-active\s*\{[^}]*background:\s*var\(--brand-yellow/s
    );
    assert.doesNotMatch(
      css,
      /\.app-context-chip\.is-active\s*\{[^}]*background:\s*#111827/s
    );
  });
});
