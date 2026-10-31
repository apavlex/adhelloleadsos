/**
 * Guards Workspace settings responsiveness: light locals for most tabs,
 * sticky/optimistic nav, and sibling prefetch.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

describe('Workspace settings responsiveness', () => {
  it('skips heavy integration locals except for integrations/ai-apps/setup', () => {
    const route = read('routes/workspace.js');
    assert.match(route, /HEAVY_WORKSPACE_SECTIONS/);
    assert.match(route, /loadWorkspacePageLocals\(req, \{ section \}\)/);
    assert.match(route, /loadWorkspacePageLocals\(req, \{ heavy: true \}\)/);
    assert.match(route, /Skip heavy locals/);
    assert.match(route, /defaultWorkspaceHomePath\(req, req\.workspace\)/);
  });

  it('settings nav is sticky with optimistic active state and scroll-into-view', () => {
    const sidebar = read('views/partials/workspace_sidebar.ejs');
    assert.match(sidebar, /ws-settings-navigating/);
    assert.match(sidebar, /scrollIntoView/);
    assert.match(sidebar, /setActive/);
    const css = read('public/css/custom.css');
    assert.match(css, /\.ws-settings-nav\s*\{[^}]*position:\s*sticky/s);
    assert.match(css, /-webkit-overflow-scrolling:\s*touch/);
    assert.match(css, /html\.ws-settings-navigating/);
  });

  it('does not idle-warm a pile of workspace tabs (intent-only prefetch)', () => {
    const js = read('public/js/nav-prefetch.js');
    assert.doesNotMatch(js, /idleWarmWorkspaceSiblings/);
    assert.doesNotMatch(js, /wsSettingsNav/);
    assert.match(js, /pointerdown/);
    assert.match(js, /MAX_INFLIGHT/);
  });

  it('defers section settings scripts', () => {
    assert.match(read('views/workspace/sections/info-packs.ejs'), /info-pack-settings\.js[^"]*" defer/);
    assert.match(read('views/workspace/sections/audit-page.ejs'), /audit-page-settings\.js\?v=/);
    assert.match(read('views/workspace/sections/audit-page.ejs'), /defer/);
  });
});
