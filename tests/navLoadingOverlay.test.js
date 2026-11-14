/**
 * Nav frost + service worker guards for iOS blank / false-offline / slow hops.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

describe('adhelloNavLoading stuck-spinner guard', () => {
  it('captures pointer events when on and keeps frost during leave nav', () => {
    const css = fs.readFileSync(path.join(root, 'public/css/custom.css'), 'utf8');
    assert.match(css, /#adhelloNavLoading\.is-on[\s\S]*pointer-events:\s*auto\s*!important/);
    assert.match(css, /body\.app-with-sidebar\s*>\s*#adhelloNavLoading\.is-on/);

    const js = fs.readFileSync(path.join(root, 'public/js/navbar-shell.js'), 'utf8');
    assert.match(js, /untilPageShow/);
    assert.match(js, /untilPageShow:\s*true/);
    assert.match(js, /_pendingHref/);
    assert.match(js, /location\.assign\(pending\)/);
    assert.match(js, /isLikelyDesktopNav/);
    // Light SEO hops skip untilPageShow frost — auto-assign was aborting in-flight HTML.
    assert.match(js, /function clearNavOverlaysForLeave/);
    assert.match(js, /lightHop/);
    assert.match(js, /if \(lightHop\) \{\s*hideNavLoading\(\);\s*return;/);
    assert.match(js, /adhelloNavLoadingRetry/);
    assert.match(js, /is-stalled/);
    assert.match(js, /showNavLoading\._leaving/);
    // Stall shows Retry, then force the hop/reload — never peel frost into an iOS white void.
    assert.match(js, /pure white void/);
    assert.match(js, /desktopLeave \? 5000 : 10000/);
    assert.match(js, /location\.assign\(pending\)/);
    assert.match(js, /location\.reload\(\)/);
    assert.doesNotMatch(
      js,
      /if \(isLikelyDesktopNav\(\)\) \{\s*hideNavLoading\(\);\s*return;/
    );
  });

  it('service worker never intercepts HTML and cache-firsts shell assets', () => {
    const sw = fs.readFileSync(path.join(root, 'public/sw.js'), 'utf8');
    // Trailing comma after CACHE_VERSION made the SW a SyntaxError since 1.0.742.
    assert.match(sw, /const CACHE_VERSION = 'adhello-pwa-v1\.0\.\d+';/);
    assert.doesNotMatch(sw, /const CACHE_VERSION = '[^']+',\s*\nconst SHELL/);
    assert.match(sw, /adhello-pwa-v1\.0\.\d+/);
    assert.doesNotMatch(sw, /AbortController/);
    assert.match(sw, /req\.mode === 'navigate'\) return/);
    assert.match(sw, /accept\.includes\('text\/html'\)\) return/);
    assert.doesNotMatch(sw, /mode === 'navigate'[\s\S]{0,200}respondWith/);
    // Versioned assets must not network-first (that re-downloaded CSS/JS every hop).
    assert.doesNotMatch(sw, /versioned\s*\?\s*fetch\(req\)/);
    assert.match(sw, /caches\.match\(req\)/);
    assert.match(sw, /cached \|\| fetching/);
  });

  it('pwa-register throttles SW update checks', () => {
    const js = fs.readFileSync(path.join(root, 'public/js/pwa-register.js'), 'utf8');
    assert.match(js, /adhello-sw-checked/);
    assert.match(js, /5 \* 60 \* 1000/);
    assert.doesNotMatch(js, /CLEAR_CACHES/);
  });
});
