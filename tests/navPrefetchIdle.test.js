/**
 * Intent-only warm: heat the destination before click, without idle pile-ups.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const js = fs.readFileSync(path.join(__dirname, '../public/js/nav-prefetch.js'), 'utf8');
const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
const head = fs.readFileSync(path.join(__dirname, '../views/partials/head.ejs'), 'utf8');

describe('nav-prefetch intent-only warm', () => {
  it('warms on hover/pointerdown with abort, not an idle route pile', () => {
    assert.match(js, /pointerdown/);
    assert.match(js, /mouseover/);
    assert.match(js, /AbortController/);
    assert.match(js, /pagehide/);
    assert.match(js, /MAX_INFLIGHT/);
    assert.doesNotMatch(js, /idleWarmDefaults/);
    assert.doesNotMatch(js, /\/prospecting\?tab=pipeline/);
    assert.doesNotMatch(js, /rel\s*=\s*['"]prefetch['"]/);
  });

  it('does not short-circuit Prefetch with 204 (that blanked navigations)', () => {
    assert.doesNotMatch(server, /skipDocumentPrefetch/);
  });

  it('gates map scripts off non-map pages', () => {
    assert.match(head, /_needMaps/);
    assert.match(head, /if \(_needMaps\)/);
    assert.match(head, /googleMapsLoader\.js/);
  });
});
