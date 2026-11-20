const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.join(__dirname, '../public/css/custom.css'), 'utf8');

describe('pipeline table white + brand row colors', () => {
  it('drops cream/yellow zebra wash for white + workspace accent', () => {
    assert.doesNotMatch(css, /prospect-leads-table tbody tr:nth-child\(odd\) td \{\s*background-color:\s*rgba\(250,\s*247,\s*237/);
    assert.match(css, /prospect-leads-table tbody tr:nth-child\(odd\) td \{\s*background-color:\s*#ffffff/);
    assert.match(css, /--workspace-accent,\s*var\(--brand-yellow\)\)\s*4%/);
  });

  it('uses brand accent for bulk selection instead of hard-coded yellow', () => {
    assert.doesNotMatch(css, /\.result-row\.bulk-selected \{\s*background-color:\s*rgba\(253,\s*224,\s*71/);
    assert.match(css, /\.result-row\.bulk-selected \{[\s\S]*?--workspace-accent/);
  });
});
