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
    assert.match(css, /\.ma-tabbar\s*\{[^}]*backdrop-filter:\s*saturate\(140%\)\s*blur\(10px\)/s);
    assert.match(css, /\.ma-tabbar\s*\{[^}]*rgba\(255,\s*255,\s*255,\s*0\.82\)/s);
    assert.match(css, /\.ma-tabbar::before\s*\{[^}]*linear-gradient\(\s*to top/s);
    assert.match(css, /\.ma-tabbar::before\s*\{[^}]*height:\s*28px/s);
    assert.match(css, /\.ma-tabbar::before\s*\{[^}]*bottom:\s*100%/s);
    assert.match(css, /\.ma-tab--fab \.ma-tab__fab\s*\{[^}]*margin-top:\s*-26px/s);
    assert.match(css, /\.ma-tabbar::after\s*\{[^}]*height:\s*200px/s);
    // Safe-area must be padding only — min-height + padding double-counted into a tall white shelf.
    assert.match(css, /\.ma-tabbar\s*\{[^}]*min-height:\s*0/s);
    assert.doesNotMatch(
      css,
      /\.ma-tabbar\s*\{[^}]*min-height:\s*calc\(\s*var\(--tabbar-h\)\s*\+\s*env\(safe-area-inset-bottom/s,
    );
  });

  it('shell bottom padding clears the tab bar', () => {
    const css = fs.readFileSync(path.join(root, 'public/css/member-app.css'), 'utf8');
    assert.match(css, /--tabbar-fab-overhang:\s*26px/);
    assert.match(css, /--tabbar-content-gap:\s*72px/);
    assert.match(
      css,
      /\.ma-shell\s*\{[^}]*padding:[^;]*tabbar-h[^;]*tabbar-fab-overhang[^;]*tabbar-content-gap/s,
    );
    assert.match(css, /\.ma-shell\s*\{[^}]*scroll-padding-bottom:/s);
    const head = fs.readFileSync(path.join(root, 'views/member_app/_head.ejs'), 'utf8');
    assert.match(head, /\.ma-shell\{padding-bottom:calc\(50px \+ 26px \+ 72px/);
    assert.match(head, /scroll-padding-bottom:calc\(50px \+ 26px \+ 72px/);
    assert.match(head, /ma-tab__fab/);
    assert.match(head, /margin-top:-26px/);
    assert.match(head, /\.ma-tab__label\{/);
    assert.match(head, /\.ma-tab\{[^}]*font-size:10px/s);
    assert.match(head, /\.ma-tabbar::before\{/);
    assert.match(head, /rgba\(255,255,255,\.82\)/);
    assert.match(head, /blur\(10px\)/);
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
    assert.match(top, /customers\/new/);
    assert.match(top, /Add a customer/);
    assert.doesNotMatch(top, /\/enroll/);
    assert.doesNotMatch(top, /Invite a business/);
    const profile = fs.readFileSync(path.join(root, 'views/member_app/profile.ejs'), 'utf8');
    assert.match(profile, /data-ma-install-open/);
    assert.match(profile, /Save as a phone app/);
    assert.match(profile, /Invite a business/);
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
    assert.match(customers, /ma-cust-partner-filter|Show partners/);
    assert.match(customers, /Referral partner/);
    const ghlCust = fs.readFileSync(path.join(root, 'services/memberCustomerGhl.js'), 'utf8');
    assert.match(ghlCust, /ghlTagNamesLookLikePartner/);
    assert.match(ghlCust, /skippedPartners/);
    const customer = fs.readFileSync(path.join(root, 'views/member_app/customer.ejs'), 'utf8');
    assert.match(customer, /Photos &amp; notes|Photos & notes/);
    assert.match(customer, /_photo_capture/);
    assert.match(customer, /customers\/c\/.*\/photos/);
    assert.match(customer, /icons\.completed.*Save changes|Save changes/);
    assert.match(customer, /googleMapsSearchUrl/);
    assert.match(customer, /ma-label-link/);
    assert.doesNotMatch(customer, /maps\.apple\.com/);
    assert.match(customer, /ma-tags/);
    assert.match(customer, /ma-tags-section/);
    assert.match(customer, /data-ma-tag-pick/);
    assert.match(customer, /name="tagName"/);
    assert.match(customer, /ma-tags__chip/);
    assert.match(customer, /ma-tags__suggest/);
    assert.match(customer, /data-ma-tag-suggest[^>]*>[\s\S]*?hidden|ma-tags__suggest"[^>]*\bhidden\b/);
    assert.match(customer, /tags\/add/);
    assert.match(customer, /tags\/remove/);
    assert.match(customer, /Search tags or create new/);
    // Tags section sits above Details.
    assert.ok(customer.indexOf('ma-tags-section') < customer.indexOf('<h2>Details</h2>'));
    assert.match(head, /\.ma-tags__chip\{/);
    assert.match(head, /border-radius:999px/);
    const memberJs = fs.readFileSync(path.join(root, 'public/js/member-app.js'), 'utf8');
    assert.match(memberJs, /function initTagPick/);
    assert.match(memberJs, /filterSuggest/);
    assert.match(memberJs, /setSearchActive/);
    assert.match(memberJs, /optimisticAdd/);
    assert.match(memberJs, /Create “/);
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
    assert.match(job, /googleMapsSearchUrl/);
    assert.doesNotMatch(job, /maps\.apple\.com/);
    const photoJs = fs.readFileSync(path.join(root, 'public/js/member-app.js'), 'utf8');
    assert.match(photoJs, /function initPhotoCapture/);
    assert.match(photoJs, /setAttribute\('capture'/);
    assert.match(photoJs, /appendChild\(sheet\)/);
    assert.match(photoJs, /ma-photo-open/);
    assert.match(photoJs, /bindNoteResize|data-ma-photo-note-grip/);
  });

  it('service worker network-firsts versioned CSS so deploys are not stuck', () => {
    const sw = fs.readFileSync(path.join(root, 'public/sw.js'), 'utf8');
    assert.match(sw, /adhello-pwa-v1\.0\.489/);
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

  it('request-a-review uses live script text; never force-adds URL or share url/files', () => {
    const js = fs.readFileSync(path.join(root, 'public/js/member-app.js'), 'utf8');
    const review = fs.readFileSync(path.join(root, 'views/member_app/review.ejs'), 'utf8');
    const route = fs.readFileSync(path.join(root, 'routes/memberApp.js'), 'utf8');
    const css = fs.readFileSync(path.join(root, 'public/css/member-app.css'), 'utf8');
    const pkg = fs.readFileSync(path.join(root, 'package.json'), 'utf8');
    assert.match(js, /function requestReviewFromPhone/);
    assert.match(js, /function fillLiveReviewScript/);
    assert.match(js, /function stripReviewUrlsFromText/);
    assert.match(js, /getElementById\('rvSmsScript'\)/);
    assert.match(js, /navigator\.share\(\{ title: title, text: text \}\)/);
    assert.match(js, /Hard rule: no \{\{review_link\}\}/);
    assert.doesNotMatch(js, /data\.url\s*=\s*payload\.url/);
    assert.doesNotMatch(js, /navigator\.share\(\{ title: title, text: text, url:/);
    assert.doesNotMatch(js, /shareWithFile/);
    assert.doesNotMatch(js, /data\.files\s*=\s*\[file\]/);
    assert.match(js, /ONLY substituted when the placeholder is present/);
    assert.doesNotMatch(review, /image:\s*_shareImage/);
    assert.match(review, /only inserted when the script includes/);
    assert.match(review, /even before Save/);
    assert.match(review, /ma-script-link__url/);
    assert.match(review, /ma-script-save/);
    assert.match(css, /\.ma-script-link\s*\{/);
    assert.match(css, /\.ma-script-save\s*\{[^}]*margin-bottom:\s*28px/s);
    assert.match(route, /do not force-append the review URL/);
    assert.match(route, /scriptWantsReviewLink\(smsScript\) \? reviewUrl : ''/);
    assert.doesNotMatch(route, /shareSmsText = reviewRequestScript\.ensureReviewLink/);
    assert.match(review, /ma-qr__ask/);
    assert.match(review, /icons\.sms/);
    assert.match(pkg, /"version":\s*"1\.0\.489"/);
    assert.match(js, /Opening…/);
    assert.match(js, /aria-busy',\s*'true'/);
    assert.match(review, /data-ma-loading="Saving…"/);
    assert.match(review, /class="ma-btn ma-btn--block ma-script-save"/);
    assert.doesNotMatch(review, /ma-btn--soft ma-btn--block ma-script-save/);
    const icons = fs.readFileSync(path.join(root, 'services/memberAppIcons.js'), 'utf8');
    assert.match(icons, /sms:\s*icon\(/);
    const sw = fs.readFileSync(path.join(root, 'public/sw.js'), 'utf8');
    assert.match(sw, /adhello-pwa-v1\.0\.489/);
  });

  it('Review keeps round FAB; label font matches other tabs (not too high)', () => {
    const html = fs.readFileSync(path.join(root, 'views/member_app/_tabbar.ejs'), 'utf8');
    const css = fs.readFileSync(path.join(root, 'public/css/member-app.css'), 'utf8');
    assert.match(html, /fab:\s*true/);
    assert.match(html, /ma-tab__fab/);
    assert.match(html, /ma-tab--fab/);
    assert.match(html, /ma-tab__label/);
    assert.match(css, /\.ma-tab__label\s*\{[^}]*font-family:\s*var\(--font-text\)/s);
    assert.match(css, /\.ma-tab__label\s*\{[^}]*font-size:\s*10px/s);
    assert.match(css, /\.ma-tab__label\s*\{[^}]*font-weight:\s*600/s);
    assert.match(css, /\.ma-tab--fab \.ma-tab__fab\s*\{[^}]*margin-top:\s*-26px/s);
    assert.doesNotMatch(css, /\.ma-tab--fab \.ma-tab__fab\s*\{[^}]*position:\s*absolute/s);
    assert.match(css, /--tabbar-fab-overhang:\s*26px/);
    assert.match(css, /--tabbar-content-gap:\s*72px/);
  });

  it('Home stays responsive: defer GHL sync, skip icon decode, idle install modal', () => {
    const route = fs.readFileSync(path.join(root, 'routes/memberApp.js'), 'utf8');
    const js = fs.readFileSync(path.join(root, 'public/js/member-app.js'), 'utf8');
    const head = fs.readFileSync(path.join(root, 'views/member_app/_head.ejs'), 'utf8');
    assert.match(route, /function scheduleOwnerCustomerSync/);
    assert.match(route, /function appIconVersionHint/);
    assert.match(route, /scheduleOwnerCustomerSync\(ctx\)/);
    assert.doesNotMatch(route, /await maybeSyncOwnerCustomers\(ctx\)/);
    assert.match(route, /draft\.appIconVersion = appIconVersionHint\(draft\)/);
    assert.doesNotMatch(route, /const icon = await resolveAppIconSource\(draft\);\s*draft\.appIconVersion = icon\.version/s);
    assert.match(route, /leadRequestState\(ctx\)/);
    assert.match(js, /requestIdleCallback\(showInstall/);
    assert.match(js, /setTimeout\(showInstall,\s*1200\)/);
    assert.match(head, /media="print" onload="this\.media='all'"/);
    assert.match(head, /blur\(10px\)/);
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
    assert.match(customers, /hideStatus:\s*!!j\.next/);
    assert.match(customers, /Mark <%= j\.nextLabel\.toLowerCase\(\)/);
    const jobRow = fs.readFileSync(path.join(root, 'views/member_app/_job_row.ejs'), 'utf8');
    assert.match(jobRow, /ma-row--readable/);
    assert.match(jobRow, /hideStatus/);
    const css = fs.readFileSync(path.join(root, 'public/css/member-app.css'), 'utf8');
    assert.match(css, /\.ma-steps\.is-saving/);
    assert.match(css, /\.ma-row--readable/);
    assert.match(css, /\.ma-row__quick\s*\{[^}]*padding:\s*0 14px 14px/s);
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
