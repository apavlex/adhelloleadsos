/**
 * Columns popover must stay inside the viewport on mobile (button sits left),
 * actually hide when closed, and scroll its body when the list is long.
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
    const fn = js.slice(start, start + 2200);
    assert.match(fn, /left = pad/);
    assert.match(fn, /window\.innerWidth - width - pad/);
    assert.doesNotMatch(fn, /style\.right = `\$\{Math\.max\(12/);
    assert.match(fn, /spaceBelow/);
    assert.match(fn, /preferBelow/);
    assert.match(fn, /maxH/);
  });

  it('popover body scrolls inside a flex column shell', () => {
    const css = fs.readFileSync(path.join(root, 'public/css/custom.css'), 'utf8');
    assert.match(css, /#pipelineColumnsPopover:not\(\.hidden\) \{[^}]*display:\s*flex !important/s);
    assert.match(css, /\.pipeline-columns-popover__body \{[^}]*overflow-y:\s*auto/s);
    assert.match(css, /#pipelineColumnsPopover\.hidden[\s\S]*?display:\s*none !important/);
  });

  it('hidden class actually hides despite ID display rules', () => {
    const css = fs.readFileSync(path.join(root, 'public/css/custom.css'), 'utf8');
    const head = fs.readFileSync(path.join(root, 'views/partials/head.ejs'), 'utf8');
    const core = fs.readFileSync(path.join(root, 'views/partials/leads_pipeline_core.ejs'), 'utf8');
    const js = fs.readFileSync(path.join(root, 'public/js/app.js'), 'utf8');
    assert.match(css, /#pipelineColumnsPopover\.hidden[\s\S]*?display:\s*none !important/);
    assert.match(head, /#pipelineColumnsPopover\.hidden/);
    assert.match(core, /id="pipelineColumnsPopover"[\s\S]*?\bhidden\b/);
    assert.match(core, /pipeline-columns-popover__footer/);
    assert.doesNotMatch(core, /pipelineColumnsCheckboxes"[^>]*max-h-/);
    assert.match(js, /pop\.setAttribute\('hidden'/);
    assert.match(js, /pop\.removeAttribute\('hidden'\)/);
    assert.match(js, /columnsPopoverIsOpen/);
  });
});
