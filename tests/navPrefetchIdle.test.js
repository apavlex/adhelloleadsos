/**
 * Document HTML prefetch must stay off until a cheap warm path exists.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const js = fs.readFileSync(path.join(__dirname, '../public/js/nav-prefetch.js'), 'utf8');
const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
const head = fs.readFileSync(path.join(__dirname, '../views/partials/head.ejs'), 'utf8');

describe('nav-prefetch disabled (hotfix)', () => {
  it('does not fetch or idle-warm HTML documents', () => {
    assert.match(js, /intentionally empty/);
    assert.doesNotMatch(js, /window\.fetch/);
    assert.doesNotMatch(js, /Purpose:\s*['"]prefetch['"]/);
    assert.doesNotMatch(js, /rel\s*=\s*['"]prefetch['"]/);
    assert.doesNotMatch(js, /idleWarmDefaults/);
    assert.doesNotMatch(js, /\/prospecting\?tab=pipeline/);
  });

  it('does not short-circuit Prefetch with 204', () => {
    assert.doesNotMatch(server, /skipDocumentPrefetch/);
  });

  it('still gates map scripts off non-map pages', () => {
    assert.match(head, /_needMaps/);
    assert.match(head, /if \(_needMaps\)/);
  });
});
