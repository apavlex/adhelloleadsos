/**
 * Document HTML prefetch must stay off — empty or heavy warms both break nav.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const js = fs.readFileSync(path.join(__dirname, '../public/js/nav-prefetch.js'), 'utf8');
const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');

describe('nav-prefetch disabled (no document warm)', () => {
  it('does not idle-warm or hover-warm HTML documents', () => {
    assert.doesNotMatch(js, /rel\s*=\s*['"]prefetch['"]/);
    assert.doesNotMatch(js, /Purpose:\s*['"]prefetch['"]/);
    assert.doesNotMatch(js, /\/prospecting\?tab=pipeline/);
    assert.doesNotMatch(js, /idleWarmDefaults/);
    assert.doesNotMatch(js, /idleWarmWorkspaceSiblings/);
    assert.match(js, /intentionally empty/);
  });

  it('does not short-circuit Prefetch with 204 on the server', () => {
    assert.doesNotMatch(server, /skipDocumentPrefetch/);
  });
});
