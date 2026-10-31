/**
 * Idle prefetch must not pile onto lead-heavy HTML routes after every hop.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const js = fs.readFileSync(path.join(__dirname, '../public/js/nav-prefetch.js'), 'utf8');

describe('nav-prefetch idle warm', () => {
  it('no longer idle-warms the heavy common destination pile', () => {
    assert.doesNotMatch(js, /\/prospecting\?tab=pipeline/);
    assert.doesNotMatch(js, /['"]\/today['"]/);
    assert.doesNotMatch(js, /['"]\/focus['"]/);
    assert.doesNotMatch(js, /['"]\/opportunities['"]/);
    assert.doesNotMatch(js, /['"]\/engagement['"]/);
    assert.doesNotMatch(js, /idleWarmDefaults/);
  });

  it('still idle-warms workspace settings siblings only', () => {
    assert.match(js, /idleWarmWorkspaceSiblings/);
    assert.match(js, /wsSettingsNav/);
    assert.match(js, /\/workspace\/team/);
  });

  it('aborts in-flight prefetch when leaving the page', () => {
    assert.match(js, /AbortController/);
    assert.match(js, /pagehide/);
    assert.match(js, /abortPendingWarms/);
  });
});
