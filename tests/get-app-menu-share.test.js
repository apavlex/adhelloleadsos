/**
 * Guards the Get the app menu label + Share control regressions:
 * - CTA label must use an explicit dark color (not inherit → white-on-white in the drawer)
 * - Share on /get-app must be a button wired for navigator.share, not an <a href="/today">
 * - Sidebar "Get the app" navigates to /get-app (no data-get-app-share intercept)
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

describe('Get the app menu + Share', () => {
  it('CTA styles use an explicit text color, not inherit', () => {
    const css = read('public/css/custom.css');
    const blocks = css.match(/\.sidebar-nav-link\.sidebar-nav-cta\s*\{[^}]+\}/g) || [];
    const colorBlock = blocks.find((b) => /color\s*:/.test(b));
    assert.ok(colorBlock, 'expected .sidebar-nav-link.sidebar-nav-cta color rule');
    assert.match(colorBlock, /color:\s*(var\(--ghl-sidebar-text-strong|#111827)/);
    assert.doesNotMatch(colorBlock, /color:\s*inherit/);

    const shell = read('views/partials/app_shell_styles.ejs');
    const shellBlocks = shell.match(/\.sidebar-nav-link\.sidebar-nav-cta\s*\{[^}]+\}/g) || [];
    const shellColor = shellBlocks.find((b) => /color\s*:/.test(b));
    assert.ok(shellColor, 'expected app_shell_styles CTA color rule');
    assert.match(shellColor, /color:\s*#111827/);
    assert.doesNotMatch(shellColor, /color:\s*inherit/);
  });

  it('Share control is a button that never links to /today', () => {
    const page = read('views/get_app.ejs');
    assert.match(page, /<button[\s\S]*?data-get-app-share/);
    assert.doesNotMatch(page, /<a\b[^>]*data-get-app-share/);
    assert.match(page, /Workspace → White-label/);
    assert.match(page, /businessName/);
    assert.match(page, /Get the Review app/);
    assert.match(page, /Open Review app/);
    assert.match(page, /Share Review app/);
    assert.doesNotMatch(page, /Referral app/);
    assert.match(page, /isDemo/);
    assert.match(page, /sample customers/);
  });

  it('Get the app page title and nav call it Review app', () => {
    const route = read('routes/getApp.js');
    assert.match(route, /Get Review app \| Agency OS/);
    assert.doesNotMatch(route, /Get Referral app/);
    const sidebar = read('views/partials/app_sidebar.ejs');
    const mobile = read('views/partials/navbar.ejs');
    assert.match(sidebar, /Install your personal Review app/);
    assert.match(mobile, /Install your personal Review app/);
    const js = read('public/js/navbar-shell.js');
    assert.match(js, /Here is a link to view and save your reviews app!/);
    assert.doesNotMatch(js, /AdHello Referral app/);
  });

  it('Get the app route uses short share URL and workspace business name', () => {
    const route = read('routes/getApp.js');
    assert.match(route, /ensureOwnerReferralApp/);
    assert.match(route, /ensureDemoOwnerReviewApp/);
    assert.match(route, /businessName/);
    assert.match(route, /brand\.customName/);
    assert.match(route, /isStaffApp/);
    assert.match(route, /staffName/);
    const owner = read('services/ownerReferralApp.js');
    assert.match(owner, /memberPortalShortLink/);
    assert.match(owner, /getReviewPublicBaseUrl/);
    assert.match(owner, /staffMemberIdForEmail/);
    assert.match(owner, /workspaceStaff:\s*true/);
  });

  it('Open Review app uses the absolute reviews.adhello.io URL', () => {
    const page = read('views/get_app.ejs');
    assert.match(page, /href="<%= _openUrl %>"/);
    assert.match(page, /reviews\.adhello\.io/);
    assert.doesNotMatch(page, /href="<%= _openPath %>"/);
    const branding = read('views/workspace/sections/branding.ejs');
    assert.match(branding, /href="<%= _wlOpenUrl %>"/);
    assert.doesNotMatch(branding, /href="<%= _wlOpenPath %>"/);
  });

  it('Get the app page copy is personalized to the logged-in teammate', () => {
    const page = read('views/get_app.ejs');
    assert.match(page, /staffName/);
    assert.match(page, /isStaffApp/);
    assert.match(page, /Tied to the account you’re logged in with/);
  });

  it('sidebar Get the app links navigate to /get-app without share intercept', () => {
    const sidebar = read('views/partials/app_sidebar.ejs');
    const mobile = read('views/partials/navbar.ejs');
    assert.match(sidebar, /href="\/get-app"/);
    assert.match(mobile, /href="\/get-app"/);
    assert.doesNotMatch(sidebar, /data-get-app-share/);
    const idx = mobile.indexOf('href="/get-app"');
    assert.ok(idx >= 0, 'expected mobile Get the app link');
    const mobileCta = mobile.slice(idx, idx + 500);
    assert.match(mobileCta, /Get the app/);
    assert.doesNotMatch(mobileCta, /data-get-app-share/);
  });

  it('share click handler always preventDefault and does not early-return before it', () => {
    const js = read('public/js/navbar-shell.js');
    const start = js.indexOf("closest('[data-get-app-share]')");
    assert.ok(start > 0, 'expected share click handler');
    const snippet = js.slice(start, start + 1600);
    assert.match(snippet, /e\.preventDefault\(\)/);
    const beforePrevent = snippet.slice(0, snippet.indexOf('e.preventDefault()'));
    assert.doesNotMatch(beforePrevent, /navigator\.share/);
  });

  it('Share copies invite text with the Review app URL', () => {
    const js = read('public/js/navbar-shell.js');
    assert.match(js, /data-get-app-share-text/);
    assert.match(js, /Here is a link to view and save your reviews app!/);
    assert.match(js, /shareBody/);
    assert.match(js, /writeText\(shareBody\)/);

    const page = read('views/get_app.ejs');
    assert.match(page, /data-get-app-share-text="Here is a link to view and save your reviews app!"/);

    const branding = read('views/workspace/sections/branding.ejs');
    assert.match(branding, /data-get-app-share-text="Here is a link to view and save your reviews app!"/);

    const route = read('routes/memberApp.js');
    assert.match(route, /REVIEW_APP_SHARE_INVITE/);
    assert.match(route, /\/a\/:code\/og\.jpg/);
    assert.match(route, /app_link_share/);
    assert.match(route, /og:image|ogImageUrl/);

    const landing = read('views/member_app/app_link_share.ejs');
    assert.match(landing, /property="og:image"/);
    assert.match(landing, /index, follow, max-image-preview:large/);
    assert.doesNotMatch(landing, /content="noindex/);
  });
});
