/**
 * Member app install modal + tab bar flush helpers (static checks).
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

describe('member app install modal and tab bar', () => {
  it('home hero card uses Apple-style frosted glass over the banner photo', () => {
    const css = fs.readFileSync(path.join(root, 'public/css/member-app.css'), 'utf8');
    assert.match(css, /\.ma-hero__card\s*\{[^}]*backdrop-filter:\s*saturate\(120%\)\s*blur\(6px\)/s);
    assert.match(css, /\.ma-hero__card\s*\{[^}]*-webkit-backdrop-filter:\s*saturate\(120%\)\s*blur\(6px\)/s);
    assert.match(css, /\.ma-hero__card\s*\{[^}]*rgba\(15,\s*23,\s*42,\s*0\.12\)/s);
    assert.match(css, /\.ma-hero__card\s*\{[^}]*border:\s*1px\s+solid\s+rgba\(255,\s*255,\s*255,\s*0\.5\)/s);
    assert.doesNotMatch(css, /\.ma-hero__card\s*\{[^}]*rgba\(19,\s*33,\s*58,\s*0\.94\)/s);
    assert.doesNotMatch(css, /\.ma-hero__card\s*\{[^}]*blur\(40px\)/s);
  });

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
    assert.match(css, /--tabbar-content-gap:\s*20px/);
    assert.match(
      css,
      /\.ma-shell\s*\{[^}]*padding:[^;]*tabbar-h[^;]*tabbar-fab-overhang[^;]*tabbar-content-gap/s,
    );
    assert.match(css, /\.ma-shell\s*\{[^}]*scroll-padding-bottom:/s);
    const head = fs.readFileSync(path.join(root, 'views/member_app/_head.ejs'), 'utf8');
    assert.match(head, /\.ma-shell\{padding-bottom:calc\(50px \+ 26px \+ 20px/);
    assert.match(head, /scroll-padding-bottom:calc\(50px \+ 26px \+ 20px/);
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
    assert.match(html, /data-ma-install-panel="workspace-ios"/);
    assert.match(html, /data-ma-install-panel="workspace-android"/);
    assert.match(html, /data-ma-install-panel="browser-ios"/);
    assert.match(html, /data-ma-install-panel="browser-android"/);
    assert.match(html, /data-ma-install-open-browser/);
    assert.match(html, /Share to Safari/);
    assert.match(html, /Open in Chrome/);
    assert.match(html, /data-ma-install-app-name/);
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
    assert.match(profile, /canEditWorkspaceBrand/);
    assert.match(profile, /profile\/branding/);
    assert.match(profile, /App branding/);
  });

  it('appearance light/dark/system and quick-action labels follow --ink', () => {
    const profile = fs.readFileSync(path.join(root, 'views/member_app/profile.ejs'), 'utf8');
    assert.match(profile, /aria-label="Appearance"/);
    assert.match(profile, /data-ma-theme-seg/);
    assert.match(profile, /data-ma-theme-set="light"/);
    assert.match(profile, /data-ma-theme-set="dark"/);
    assert.match(profile, /data-ma-theme-set="system"/);

    const head = fs.readFileSync(path.join(root, 'views/member_app/_head.ejs'), 'utf8');
    assert.match(head, /localStorage\.getItem\('ma-theme'\)/);
    assert.match(head, /data-ma-theme/);
    assert.match(head, /id="maThemeColor"/);
    assert.match(head, /\.ma-quick__btn span\{color:var\(--ink\)/);

    const css = fs.readFileSync(path.join(root, 'public/css/member-app.css'), 'utf8');
    assert.match(css, /html\[data-ma-theme="dark"\]\s*\{[^}]*--ink:\s*#ffffff/s);
    assert.match(css, /:root\s*\{[^}]*--ink:\s*#000000/s);
    assert.match(css, /\.ma-quick__btn span\s*\{[^}]*color:\s*var\(--ink\)/s);
    assert.match(css, /\.ma-quick__btn svg\s*\{[^}]*color:\s*var\(--acc\)/s);
    assert.doesNotMatch(css, /@media\s*\(\s*prefers-color-scheme:\s*dark\s*\)/);

    const js = fs.readFileSync(path.join(root, 'public/js/member-app.js'), 'utf8');
    assert.match(js, /function initMaTheme\b/);
    assert.match(js, /function applyMaTheme\b/);
    assert.match(js, /THEME_KEY\s*=\s*'ma-theme'/);
    assert.match(js, /data-ma-theme-set/);
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
    // Tags section sits above Details; Share contact sits under Details.
    assert.ok(customer.indexOf('ma-tags-section') < customer.indexOf('<h2>Details</h2>'));
    if (customer.includes('maCustomerShare')) {
      assert.ok(customer.indexOf('<h2>Details</h2>') < customer.indexOf('maCustomerShare'));
    }
    assert.match(head, /\.ma-tags__chip\{/);
    assert.match(head, /border-radius:999px/);
    assert.match(head, /ma-tags__suggest-btn\{[^}]*background:var\(--card/s);
    assert.match(head, /html\[data-ma-theme="dark"\] \.ma-tags__suggest-btn/);
    assert.match(head, /html\[data-ma-theme="dark"\] \.ma-tags__chip\{/);
    assert.doesNotMatch(css, /\.ma-tags__suggest-btn\s*\{[^}]*background:\s*#fff/s);
    assert.match(css, /\.ma-tags__suggest-btn\s*\{[^}]*background:\s*var\(--card\)/s);
    assert.match(css, /html\[data-ma-theme="dark"\] \.ma-tags__suggest-btn\s*\{/);
    assert.match(css, /html\[data-ma-theme="dark"\] \.ma-tags__chip\s*\{/);
    assert.match(css, /\.ma-input::placeholder/);
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
    const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
    assert.match(sw, new RegExp(`adhello-pwa-v${version.replace(/\./g, '\\.')}`));
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

  it('Customers view tabs include icons for List, Calendar, and Projects', () => {
    const html = fs.readFileSync(path.join(root, 'views/member_app/customers.ejs'), 'utf8');
    assert.match(html, /icons\.list/);
    assert.match(html, /icons\.calendar/);
    assert.match(html, /icons\.pending/);
    assert.match(html, /<span>Projects<\/span>/);
    const icons = fs.readFileSync(path.join(root, 'services/memberAppIcons.js'), 'utf8');
    assert.match(icons, /list:\s*icon\(/);
    assert.match(icons, /pending:\s*icon\(/);
  });

  it('Customers Bring in fold is closed by default and sits above the view pills', () => {
    const html = fs.readFileSync(path.join(root, 'views/member_app/customers.ejs'), 'utf8');
    const css = fs.readFileSync(path.join(root, 'public/css/member-app.css'), 'utf8');
    assert.match(html, /<details class="ma-fold ma-cust-tools"/);
    assert.doesNotMatch(html, /<details class="ma-fold ma-cust-tools"[^>]*\sopen/);
    assert.match(html, /<summary>\s*Bring in customers\s*<\/summary>/);
    const toolsAt = html.indexOf('id="maCustTools"');
    const pillsAt = html.indexOf('aria-label="Customer views"');
    assert.ok(toolsAt > -1 && pillsAt > toolsAt, 'Bring in customers should render before List/Calendar/Projects');
    // Closed strip: ~36px, not the default tall fold padding.
    assert.match(css, /\.ma-cust-tools\.ma-fold\s*>\s*summary\s*\{[^}]*height:\s*36px/);
    assert.match(css, /\.ma-cust-tools\.ma-fold\s*>\s*summary\s*\{[^}]*max-height:\s*36px/);
    assert.match(css, /\.ma-cust-tools\.ma-fold\s*>\s*summary\s*\{[^}]*padding:\s*0 12px/);
    const head = fs.readFileSync(path.join(root, 'views/member_app/_head.ejs'), 'utf8');
    assert.match(head, /\.ma-cust-tools\.ma-fold>summary\{[^}]*height:36px!important/);
  });

  it('request-a-review uses live script text; never force-adds URL or share url/files', () => {
    const js = fs.readFileSync(path.join(root, 'public/js/member-app.js'), 'utf8');
    const review = fs.readFileSync(path.join(root, 'views/member_app/review.ejs'), 'utf8');
    const route = fs.readFileSync(path.join(root, 'routes/memberApp.js'), 'utf8');
    const reviewPublicRoute = fs.readFileSync(path.join(root, 'routes/reviewPublic.js'), 'utf8');
    const css = fs.readFileSync(path.join(root, 'public/css/member-app.css'), 'utf8');
    const pkg = fs.readFileSync(path.join(root, 'package.json'), 'utf8');
    assert.match(js, /function requestReviewFromPhone/);
    assert.match(js, /function fillLiveReviewScript/);
    assert.match(js, /function buildLiveKeywordHint/);
    assert.match(js, /function stripReviewUrlsFromText/);
    assert.match(js, /function placeReviewLinkAtEnd/);
    assert.match(js, /getElementById\('rvSmsScript'\)/);
    assert.match(js, /navigator\.share\(data\)/);
    assert.match(js, /Hard rule: no \{\{review_link\}\}/);
    // Request-a-review must substitute {{keywords}} (never leave the raw tag in Messages).
    assert.match(js, /\\{\\{\\s\*keywords\\s\*\\}\\}/);
    assert.match(js, /readLiveKeywordFields/);
    assert.match(js, /the work we did/);
    assert.match(js, /Review link last → iMessage can unfurl the OG image/);
    assert.match(js, /syncShareKeywordPayload/);
    assert.match(js, /scriptNeedsKeywords/);
    assert.match(js, /promptForKeywordDefaults/);
    assert.match(js, /the\\s\+your project/);
    assert.doesNotMatch(js, /data\.url\s*=\s*payload\.url/);
    assert.doesNotMatch(js, /navigator\.share\(\{ title: title, text: text, url:/);
    assert.doesNotMatch(js, /shareWithFile/);
    // vCard may be shared as a File (contact card); never the old OG image file path.
    assert.doesNotMatch(js, /data\.files\s*=\s*\[file\]/);
    assert.match(js, /text\/vcard/);
    assert.match(js, /makeVcardFile/);
    assert.match(js, /data\.files\s*=\s*\[vcardFile\]/);
    assert.match(reviewPublicRoute, /noindex kills unfurls/);
    assert.match(reviewPublicRoute, /removeHeader\('X-Robots-Tag'\)/);
    assert.match(js, /review_link is ONLY substituted when the placeholder/);
    assert.doesNotMatch(review, /image:\s*_shareImage/);
    assert.match(review, /only inserted when the script includes/);
    assert.match(review, /even before Save/);
    assert.match(review, /ma-script-link__url/);
    assert.match(review, /ma-script-save/);
    assert.match(review, /id="rvAttachVcard"/);
    assert.match(review, /Attach contact card/);
    assert.match(review, /name="attachVcard"/);
    assert.match(js, /function maybeAttachVcardUrl/);
    assert.match(js, /rvAttachVcard/);
    assert.match(css, /\.ma-script-link\s*\{/);
    assert.match(css, /\.ma-script-save\s*\{[^}]*margin-bottom:\s*28px/s);
    assert.match(route, /do not force-append the review URL/);
    assert.match(route, /scriptWantsReviewLink\(smsScript\) \? reviewUrl : ''/);
    assert.match(route, /reviewAttachVcard/);
    assert.match(route, /maybeAttachVcardUrl/);
    assert.doesNotMatch(route, /shareSmsText = reviewRequestScript\.ensureReviewLink/);
    assert.match(review, /ma-qr__ask/);
    assert.match(review, /icons\.sms/);
    const version = JSON.parse(pkg).version;
    assert.match(pkg, new RegExp(`"version":\\s*"${version.replace(/\./g, '\\.')}"`));
    assert.equal(typeof version, 'string');
    assert.match(version, /^\d+\.\d+\.\d+$/);
    assert.match(js, /Opening…/);
    assert.match(js, /aria-busy',\s*'true'/);
    assert.match(review, /data-ma-loading="Saving…"/);
    assert.match(review, /class="ma-btn ma-btn--block ma-script-save"/);
    assert.doesNotMatch(review, /ma-btn--soft ma-btn--block ma-script-save/);
    const icons = fs.readFileSync(path.join(root, 'services/memberAppIcons.js'), 'utf8');
    assert.match(icons, /sms:\s*icon\(/);
    const sw = fs.readFileSync(path.join(root, 'public/sw.js'), 'utf8');
    assert.match(sw, new RegExp(`adhello-pwa-v${version.replace(/\./g, '\\.')}`));
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
    assert.match(css, /--tabbar-content-gap:\s*20px/);
  });

  it('referrals tab is labeled Leads; page title is Leads & Referrals', () => {
    const tabbar = fs.readFileSync(path.join(root, 'views/member_app/_tabbar.ejs'), 'utf8');
    const page = fs.readFileSync(path.join(root, 'views/member_app/referrals.ejs'), 'utf8');
    const route = fs.readFileSync(path.join(root, 'routes/memberApp.js'), 'utf8');
    assert.match(tabbar, /id:\s*'referrals',\s*label:\s*'Leads'/);
    assert.doesNotMatch(tabbar, /id:\s*'referrals',\s*label:\s*'Referrals'/);
    // One Leads tab — website/agency leads render on /referrals (legacy /leads redirects).
    assert.doesNotMatch(tabbar, /id:\s*'leads'/);
    assert.match(page, /pageTitle:\s*'Leads & Referrals'/);
    assert.match(page, /topTitle:\s*'Leads & Referrals'/);
    assert.match(page, /ma-page-title">Leads &amp; Referrals</);
    assert.match(page, /Website &amp; agency/);
    assert.match(page, /_lead_request_callout/);
    assert.match(route, /portalLeadsPath:\s*`\$\{ctx\.base\}\/referrals`/);
    assert.match(route, /redirect\(303,\s*`\$\{ctx\.base\}\/referrals/);
  });

  it('Home stays responsive: defer GHL sync, skip icon decode, idle install modal', () => {
    const route = fs.readFileSync(path.join(root, 'routes/memberApp.js'), 'utf8');
    const js = fs.readFileSync(path.join(root, 'public/js/member-app.js'), 'utf8');
    const head = fs.readFileSync(path.join(root, 'views/member_app/_head.ejs'), 'utf8');
    assert.match(route, /function scheduleOwnerCustomerSync/);
    assert.match(route, /function appIconVersionHint/);
    assert.match(route, /scheduleOwnerCustomerSync\(ctx\)/);
    assert.doesNotMatch(route, /await maybeSyncOwnerCustomers\(ctx\)/);
    assert.match(route, /maybeEnsureDemoOwnerReviewApp/);
    assert.match(route, /ws\.isDemo/);
    assert.match(route, /draft\.appIconVersion = appIconVersionHint\(draft\)/);
    assert.doesNotMatch(route, /const icon = await resolveAppIconSource\(draft\);\s*draft\.appIconVersion = icon\.version/s);
    assert.match(route, /leadRequestState\(ctx\)/);
    // Home Screen icon prefers business logo over profile photo.
    const iconFn = route.slice(route.indexOf('async function resolveAppIconSource'));
    const wsLogoAt = iconFn.indexOf('workspaceLogoForBrand');
    const brandLogoAt = iconFn.indexOf('getBrandImage');
    const photoAt = iconFn.indexOf('getProfilePhoto');
    assert.ok(wsLogoAt >= 0 && brandLogoAt > wsLogoAt && photoAt > brandLogoAt);
    assert.match(js, /requestIdleCallback\(showInstall/);
    assert.match(js, /setTimeout\(showInstall,\s*1200\)/);
    assert.match(js, /forceInstall/);
    assert.match(js, /isHomeRoot/);
    assert.match(js, /params\.get\('install'\) === '1'/);
    assert.match(js, /ma-install-snoozed/);
    assert.match(js, /localStorage\.removeItem\(LEGACY_KEY\)/);
    assert.match(js, /modal\.hidden = false/);
    assert.match(head, /media="print" onload="this\.media='all'"/);
    assert.match(head, /blur\(10px\)/);
    const getApp = fs.readFileSync(path.join(root, 'views/get_app.ejs'), 'utf8');
    assert.match(getApp, /install=1/);
    assert.match(getApp, /Open Review app/);
    const tabbar = fs.readFileSync(path.join(root, 'views/member_app/_tabbar.ejs'), 'utf8');
    assert.match(tabbar, /Save this app to your phone/);
  });

  it('member-app.js shows install guidance inside workspace standalone shells', () => {
    const js = fs.readFileSync(path.join(root, 'public/js/member-app.js'), 'utf8');
    assert.match(js, /fromWorkspaceShell/);
    assert.match(js, /memberPwa/);
    assert.match(js, /source'\) === 'pwa'/);
    assert.match(js, /data-ma-install-open/);
    assert.match(js, /showPanel\(isIOS \? 'workspace-ios' : 'workspace-android'\)/);
    assert.match(js, /function openInSystemBrowser/);
    assert.match(js, /data-ma-install-open-browser/);
    assert.match(js, /Share to Safari/);
    assert.match(js, /Open in Chrome/);
    assert.match(js, /navigator\.share/);
    assert.match(js, /package=com\.android\.chrome/);
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

  it('job photos open in a Lightroom-style viewer instead of a raw image tab', () => {
    const job = fs.readFileSync(path.join(root, 'views/member_app/job.ejs'), 'utf8');
    const viewer = fs.readFileSync(path.join(root, 'views/member_app/_photo_viewer.ejs'), 'utf8');
    const js = fs.readFileSync(path.join(root, 'public/js/member-app.js'), 'utf8');
    const css = fs.readFileSync(path.join(root, 'public/css/member-app.css'), 'utf8');
    assert.match(job, /data-ma-lr-open/);
    assert.match(job, /_photo_viewer/);
    assert.doesNotMatch(job, /target="_blank"[^>]*>\s*<img/);
    assert.match(viewer, /data-ma-lr/);
    assert.match(viewer, /ma-lr__film/);
    assert.match(js, /function initPhotoLightroomViewer/);
    assert.match(js, /onLrTouchMove/);
    assert.match(css, /\.ma-lr\s*\{/);
    assert.match(css, /background:#0a0a0a/);
    assert.match(css, /100dvh/);
    assert.match(css, /overscroll-behavior:\s*none/);
    assert.match(css, /touch-action:\s*pan-x/);
  });

  it('Agency OS photo spotlight stays pinned to the viewport (no vertical drag under status bar)', () => {
    const viewer = fs.readFileSync(path.join(root, 'views/partials/photo_lightroom.ejs'), 'utf8');
    assert.match(viewer, /data-os-lr/);
    assert.match(viewer, /100dvh/);
    assert.match(viewer, /overscroll-behavior:\s*none/);
    assert.match(viewer, /onDocTouchMove/);
    assert.match(viewer, /lockViewport/);
    assert.doesNotMatch(viewer, /body\.app-with-sidebar>\.os-lr\.app-body-portal\{[^}]*height:\s*auto/);
  });
});
