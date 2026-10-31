/**
 * Columns popover must stay inside the viewport on mobile (button sits left).
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

describe('pipeline Columns popover mobile', () => {
  it('clamps with left positioning instead of right-anchoring off-screen', () => {
    const js = fs.readFileSync(path.join(root, 'public/js/app.js'), 'utf8');
    const start = js.indexOf('function positionColumnsPopover()');
    assert.ok(start > 0);
    const fn = js.slice(start, start + 1800);
    assert.match(fn, /left = pad/);
    assert.match(fn, /window\.innerWidth - width - pad/);
    assert.doesNotMatch(fn, /style\.right = `\$\{Math\.max\(12/);
    assert.match(fn, /maxHeight/);
  });

  it('popover body scrolls inside a flex column shell', () => {
    const css = fs.readFileSync(path.join(root, 'public/css/custom.css'), 'utf8');
    assert.match(css, /\.pipeline-columns-popover,\s*\n#pipelineColumnsPopover \{[^}]*display:\s*flex/s);
    assert.match(css, /\.pipeline-columns-popover__body \{[^}]*overflow-y:\s*auto/s);
  });
});
