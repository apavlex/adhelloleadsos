const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.join(__dirname, '..', 'public/css/custom.css'), 'utf8');
const js = fs.readFileSync(path.join(__dirname, '..', 'public/js/sidebarShell.js'), 'utf8');

describe('collapsed sidebar instant hover labels', () => {
  it('uses a body-level tip so sidebar overflow cannot clip the name', () => {
    assert.match(css, /#sidebarInstantHoverTip/);
    assert.match(css, /#sidebarInstantHoverTip\.is-visible/);
    assert.match(css, /transition:\s*none/);
    assert.match(css, /height:\s*auto\s*!important/);
    assert.match(css, /z-index:\s*10050/);
    assert.match(css, /padding:\s*0\.8rem\s+1\.4rem/);
    assert.match(css, /--brand-yellow/);
    assert.match(css, /--brand-on-accent/);
  });

  it('seeds data-label, shows tip immediately, and suppresses native title while collapsed', () => {
    assert.match(js, /function ensureSidebarHoverLabels/);
    assert.match(js, /function showInstantHoverTip/);
    assert.match(js, /function bindInstantHoverLabels/);
    assert.match(js, /function syncNativeTitlesForCollapsed/);
    assert.match(js, /data-title-native/);
    assert.match(js, /ensureSidebarHoverLabels\(\)/);
    assert.match(js, /bindInstantHoverLabels\(\)/);
    assert.match(js, /syncNativeTitlesForCollapsed\(state === 'collapsed'\)/);
    assert.match(js, /app-body-portal/);
    assert.match(js, /pointerover/);
    assert.match(js, /relatedTarget/);
  });
});
