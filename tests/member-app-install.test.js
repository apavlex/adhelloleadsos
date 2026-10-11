/**
 * Member app install modal + tab bar flush helpers (static checks).
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

describe('member app install modal and tab bar', () => {
  it('CSS pins a frosted tab bar flush to the bottom with a soft top fade', () => {
    const css = fs.readFileSync(path.join(root, 'public/css/member-app.css'), 'utf8');
    assert.match(css, /html\s*\{[^}]*background:\s*var\(--card\)/s);
    assert.match(css, /\.ma-tabbar\s*\{[^}]*bottom:\s*0/s);
    assert.match(css, /\.ma-tabbar\s*\{[^}]*backdrop-filter:\s*saturate\(180%\)\s*blur\(22px\)/s);
    assert.match(css, /\.ma-tabbar\s*\{[^}]*rgba\(255,\s*255,\s*255,\s*0\.58\)/s);
    assert.match(css, /\.ma-tabbar::before\s*\{[^}]*linear-gradient\(\s*to top/s);
    assert.match(css, /\.ma-tabbar::before\s*\{[^}]*height:\s*28px/s);
    assert.match(css, /\.ma-tabbar::before\s*\{[^}]*bottom:\s*100%/s);
    assert.match(css, /\.ma-tab--send \.ma-tab__fab\s*\{[^}]*margin-top:\s*-26px/s);
    assert.match(css, /\.ma-tabbar::after\s*\{[^}]*height:\s*200px/s);
    // Safe-area must be padding only — min-height + padding double-counted into a tall white shelf.
    assert.match(css, /\.ma-tabbar\s*\{[^}]*min-height:\s*0/s);
    assert.doesNotMatch(
      css,
      /\.ma-tabbar\s*\{[^}]*min-height:\s*calc\(\s*var\(--tabbar-h\)\s*\+\s*env\(safe-area-inset-bottom/s,
    );
  });

  it('shell bottom padding clears the tab bar and Review FAB', () => {
    const css = fs.readFileSync(path.join(root, 'public/css/member-app.css'), 'utf8');
    assert.match(css, /--tabbar-fab-overhang:\s*36px/);
    assert.match(css, /--tabbar-content-gap:\s*72px/);
    assert.match(
      css,
      /\.ma-shell\s*\{[^}]*padding:[^;]*tabbar-h[^;]*tabbar-fab-overhang[^;]*tabbar-content-gap/s,
    );
    const head = fs.readFileSync(path.join(root, 'views/member_app/_head.ejs'), 'utf8');
    assert.match(head, /\.ma-shell\{padding-bottom:calc\(50px \+ 36px \+ 72px/);
    assert.match(head, /\.ma-tabbar::before\{/);
    assert.match(head, /rgba\(255,255,255,\.58\)/);
  });

  it('tabbar partial includes install modal with workspace + browser panels', () => {
    const html = fs.readFileSync(path.join(root, 'views/member_app/_tabbar.ejs'), 'utf8');
    assert.match(html, /ma-install-modal/);
    assert.match(html, /data-ma-install-panel="workspace"/);
    assert.match(html, /data-ma-install-panel="browser-ios"/);
    assert.match(html, /data-ma-install-panel="browser-android"/);
    assert.match(html, /data-ma-install-copy/);
    assert.match(html, /data-ma-install-share/);
    assert.doesNotMatch(html, /class="ma-install"/);
  });

  it('settings profile exposes Install open control (not the top bar)', () => {
    const top = fs.readFileSync(path.join(root, 'views/member_app/_top.ejs'), 'utf8');
    assert.doesNotMatch(top, /data-ma-install-open/);
    const profile = fs.readFileSync(path.join(root, 'views/member_app/profile.ejs'), 'utf8');
    assert.match(profile, /data-ma-install-open/);
    assert.match(profile, /Save as a phone app/);
  });

  it('settings row icons stay compact', () => {
    const css = fs.readFileSync(path.join(root, 'public/css/member-app.css'), 'utf8');
    assert.match(css, /\.ma-settings-row__icon\s*\{[^}]*width:\s*28px/s);
    assert.match(css, /\.ma-settings-row__icon svg\s*\{[^}]*width:\s*14px/s);
    assert.match(css, /summary\.ma-settings-row/);
    assert.match(css, /\.ma-empty--tap\s*\{[^}]*flex-direction:\s*row/s);
    const head = fs.readFileSync(path.join(root, 'views/member_app/_head.ejs'), 'utf8');
    assert.match(head, /id="ma-critical"/);
    assert.match(head, /ma-settings-row__icon svg\{width:14px/);
    assert.match(head, /summary\.ma-settings-row/);
    assert.match(head, /\.ma-empty--tap\{/);
    assert.match(head, /\.ma-tabbar\{[^}]*bottom:0/s);
    const icons = fs.readFileSync(path.join(root, 'services/memberAppIcons.js'), 'utf8');
    assert.match(icons, /width="24" height="24"/);
    assert.match(icons, /photo:\s*icon\(/);
    const customers = fs.readFileSync(path.join(root, 'views/member_app/customers.ejs'), 'utf8');
    assert.match(customers, /summary class="ma-settings-row"/);
    const customer = fs.readFileSync(path.join(root, 'views/member_app/customer.ejs'), 'utf8');
    assert.match(customer, /Photos &amp; notes|Photos & notes/);
    assert.match(customer, /_photo_capture/);
    assert.match(customer, /customers\/c\/.*\/photos/);
    assert.match(customer, /icons\.completed.*Save changes|Save changes/);
    const capture = fs.readFileSync(path.join(root, 'views/member_app/_photo_capture.ejs'), 'utf8');
    assert.match(capture, /data-ma-photo-pick="camera"/);
    assert.match(capture, /data-ma-photo-pick="library"/);
    assert.match(capture, /<textarea[\s\S]*name="caption"/);
    assert.match(capture, /maxlength="500"/);
    assert.match(capture, /ma-photo-note__input/);
    const photoCss = fs.readFileSync(path.join(root, 'public/css/member-app.css'), 'utf8');
    assert.match(photoCss, /\.ma-photo-note__input/);
    assert.match(photoCss, /\.ma-photo-note__grip/);
    assert.match(photoCss, /tabbar-fab-overhang/);
    assert.match(photoCss, /body\.ma-photo-open\s+\.ma-tabbar/);
    assert.match(capture, /data-ma-photo-note-grip/);
    const job = fs.readFileSync(path.join(root, 'views/member_app/job.ejs'), 'utf8');
    assert.match(job, /_photo_capture/);
    const photoJs = fs.readFileSync(path.join(root, 'public/js/member-app.js'), 'utf8');
    assert.match(photoJs, /function initPhotoCapture/);
    assert.match(photoJs, /setAttribute\('capture'/);
    assert.match(photoJs, /appendChild\(sheet\)/);
    assert.match(photoJs, /ma-photo-open/);
    assert.match(photoJs, /bindNoteResize|data-ma-photo-note-grip/);
  });

  it('service worker network-firsts versioned CSS so deploys are not stuck', () => {
    const sw = fs.readFileSync(path.join(root, 'public/sw.js'), 'utf8');
    assert.match(sw, /adhello-pwa-v1\.0\.464/);
    assert.match(sw, /searchParams\.has\('v'\)/);
    assert.match(sw, /versioned/);
  });

  it('multipart forms show a Saving loading state on submit', () => {
    const js = fs.readFileSync(path.join(root, 'public/js/member-app.js'), 'utf8');
    assert.match(js, /data-ma-loading/);
    assert.match(js, /multipart\/form-data/);
    assert.match(js, /aria-busy/);
    const profile = fs.readFileSync(path.join(root, 'views/member_app/profile.ejs'), 'utf8');
    assert.match(profile, /data-ma-loading="Saving photo/);
    const css = fs.readFileSync(path.join(root, 'public/css/member-app.css'), 'utf8');
    assert.match(css, /\.ma-btn\[aria-busy='true'\]/);
  });

  it('Customers view tabs include icons for List, Calendar, and Pending', () => {
    const html = fs.readFileSync(path.join(root, 'views/member_app/customers.ejs'), 'utf8');
    assert.match(html, /icons\.list/);
    assert.match(html, /icons\.calendar/);
    assert.match(html, /icons\.pending/);
    const icons = fs.readFileSync(path.join(root, 'services/memberAppIcons.js'), 'utf8');
    assert.match(icons, /list:\s*icon\(/);
    assert.match(icons, /pending:\s*icon\(/);
  });

  it('member-app.js shows install guidance inside workspace standalone shells', () => {
    const js = fs.readFileSync(path.join(root, 'public/js/member-app.js'), 'utf8');
    assert.match(js, /fromWorkspaceShell/);
    assert.match(js, /memberPwa/);
    assert.match(js, /source'\) === 'pwa'/);
    assert.match(js, /data-ma-install-open/);
    assert.match(js, /showPanel\('workspace'\)/);
    // Must not skip the modal solely because display-mode is standalone.
    assert.doesNotMatch(js, /isIOS && !standalone && !dismissed/);
  });

  it('job status chips update optimistically in the background', () => {
    const js = fs.readFileSync(path.join(root, 'public/js/member-app.js'), 'utf8');
    assert.match(js, /function initStatusSteps/);
    assert.match(js, /function postStatus/);
    assert.match(js, /X-Requested-With['"]:\s*['"]fetch['"]/);
    assert.match(js, /data-ma-status-steps/);
    assert.match(js, /jbDate/);
    const job = fs.readFileSync(path.join(root, 'views/member_app/job.ejs'), 'utf8');
    assert.match(job, /data-ma-status-steps/);
    assert.match(job, /data-ma-job-status-pill/);
    const customers = fs.readFileSync(path.join(root, 'views/member_app/customers.ejs'), 'utf8');
    assert.match(customers, /data-ma-status-advance/);
    const css = fs.readFileSync(path.join(root, 'public/css/member-app.css'), 'utf8');
    assert.match(css, /\.ma-steps\.is-saving/);
    const workSrc = fs.readFileSync(path.join(root, 'services/memberWork.js'), 'utf8');
    assert.match(workSrc, /Scheduling without a date defaults to today/);
  });

  it('photo gallery exposes a note shortcut that edits caption only', () => {
    const customer = fs.readFileSync(path.join(root, 'views/member_app/customer.ejs'), 'utf8');
    const job = fs.readFileSync(path.join(root, 'views/member_app/job.ejs'), 'utf8');
    const sheet = fs.readFileSync(path.join(root, 'views/member_app/_photo_note_sheet.ejs'), 'utf8');
    const js = fs.readFileSync(path.join(root, 'public/js/member-app.js'), 'utf8');
    const css = fs.readFileSync(path.join(root, 'public/css/member-app.css'), 'utf8');
    const icons = fs.readFileSync(path.join(root, 'services/memberAppIcons.js'), 'utf8');
    assert.match(customer, /data-ma-photo-note-open/);
    assert.match(customer, /\/photos\/.*\/caption/);
    assert.match(job, /data-ma-photo-note-open/);
    assert.match(sheet, /data-ma-photo-note-sheet/);
    assert.match(sheet, /Save note/);
    assert.match(js, /function initPhotoNoteSheet/);
    assert.match(css, /\.ma-photos__note/);
    assert.match(icons, /note:\s*icon\(/);
  });
});
