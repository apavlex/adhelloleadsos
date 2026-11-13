const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');

test('mobile menu does not use full-screen backdrop-blur (kills mid-range phones)', () => {
  const html = fs.readFileSync(path.join(root, 'views/partials/navbar.ejs'), 'utf8');
  const menuAt = html.indexOf('id="mobileMenu"');
  assert.ok(menuAt > -1);
  const chunk = html.slice(menuAt, menuAt + 280);
  assert.match(chunk, /bg-black\/45|bg-black\/50/);
  assert.doesNotMatch(chunk, /backdrop-blur/);
});

test('nav shell closes menu instantly and shows progress on leave', () => {
  const js = fs.readFileSync(path.join(root, 'public/js/navbar-shell.js'), 'utf8');
  assert.match(js, /function clearNavOverlaysForLeave/);
  assert.match(js, /closeMobileMenu\(\{\s*instant:\s*true\s*\}\)/);
  assert.match(js, /showNavLoading/);
  assert.match(js, /window\.showNavLoading\s*=\s*showNavLoading/);
  assert.match(js, /window\.hideNavLoading\s*=\s*hideNavLoading/);
  assert.match(js, /failSafeMs/);
  assert.match(js, /adhelloNavLoading/);
  assert.match(js, /adhello-nav-loader/);
  assert.match(js, /app-body-portal/);
  assert.match(js, /NAV_LOADING_ICON_SRC\s*=\s*'data:image\/png;base64,/);
  // Data-URI icon — no network fetch mid-nav (remote <img> was aborted on iOS).
  assert.doesNotMatch(js, /function navLoadingLogoSrc/);
  assert.doesNotMatch(js, /NAV_LOADING_ICON_SVG/);
  assert.match(js, /backdrop-filter',\s*'none'/);
  // Never hijack link clicks or opaque-blank the page — that stuck iOS.
  // location.assign is OK only on the stalled Retry button (finish the pending hop).
  assert.doesNotMatch(js, /adhello-navigating/);
  assert.doesNotMatch(js, /function leaveToUrl/);
  assert.match(js, /location\.assign\(pending\)/);
  assert.doesNotMatch(js, /adhello-nav-radiant/);
  assert.doesNotMatch(js, /adhello-nav-bottom-bar/);
  const css = fs.readFileSync(path.join(root, 'public/css/custom.css'), 'utf8');
  assert.doesNotMatch(css, /adhello-navigating/);
  assert.doesNotMatch(css, /adhello-nav-radiant/);
  assert.doesNotMatch(css, /adhello-nav-bottom-bar/);
  assert.match(css, /#adhelloNavLoading/);
  assert.match(css, /backdrop-filter:\s*blur/);
  assert.match(css, /adhello-nav-loader/);
  assert.match(css, /adhello-nav-loader-spin/);
  assert.match(css, /adhello-nav-loader-icon/);
  // Desktop sidebar crush must not pin the spinner to the top of the page.
  assert.match(css, /body\.app-with-sidebar\s*>\s*#adhelloNavLoading/);
  assert.match(css, /height:\s*100dvh\s*!important/);
  assert.match(css, /translate\(-50%,\s*-50%\)/);
});

test('prospecting folders tab skips unused lead JSON and Drive OAuth', () => {
  const route = fs.readFileSync(path.join(root, 'routes/prospecting.js'), 'utf8');
  assert.match(route, /safeTab === 'queue'/);
  assert.match(route, /light:\s*true/);
  assert.match(route, /safeTab === 'folders'/);
  assert.match(route, /folders_manager_lite/);
  assert.match(route, /listFoldersLite/);
  assert.match(route, /countLeadsByFolderKey/);
  assert.match(route, /sortFolderTreeByLeadCount/);
  assert.match(route, /listLeadsByFolderKeys/);
  assert.match(route, /openFolderScoped/);
  {
    const start = route.indexOf("safeTab === 'folders'");
    const end = route.indexOf("const [all, foldersInitial, tags, wsRaw]", start);
    const foldersBlock = route.slice(start, end > start ? end : start + 2000);
    assert.doesNotMatch(foldersBlock, /await maybeMigrateLegacyFolders|await ensurePipelineFolders/);
    assert.doesNotMatch(foldersBlock, /getAllLeads/);
    assert.match(foldersBlock, /listFoldersLite/);
    assert.match(foldersBlock, /countLeadsByFolderKey/);
    assert.match(foldersBlock, /folderAggregateCounts/);
  }
  assert.ok(fs.existsSync(path.join(root, 'views/folders_manager_lite.ejs')));
  const lite = fs.readFileSync(path.join(root, 'views/folders_manager_lite.ejs'), 'utf8');
  assert.match(lite, /folderAggregateCounts/);
  assert.match(lite, /_counts\[/);
  assert.match(lite, /lead<%= /);
  assert.match(
    fs.readFileSync(path.join(root, 'services/database.js'), 'utf8'),
    /async listFoldersLite/,
  );
  assert.match(
    fs.readFileSync(path.join(root, 'services/database.js'), 'utf8'),
    /async countLeadsByFolderKey/,
  );
  assert.match(
    fs.readFileSync(path.join(root, 'views/partials/head.ejs'), 'utf8'),
    /_foldersLite/,
  );
  assert.match(route, /needPipelineDecorate = safeTab === 'pipeline'/);
  assert.match(route, /folderListLeads = \[\]/);
  assert.match(route, /queueListLeads = \[\]/);
  assert.match(route, /needPipelineDecorate \? buildDriveImportBundle/);
});

test('light pages skip softphone helper scripts in head (lazy on dialer open)', () => {
  const head = fs.readFileSync(path.join(root, 'views/partials/head.ejs'), 'utf8');
  const js = fs.readFileSync(path.join(root, 'public/js/navbar-shell.js'), 'utf8');
  const navScripts = fs.readFileSync(path.join(root, 'views/partials/navbar_scripts.ejs'), 'utf8');
  assert.match(head, /_lightChrome/);
  assert.match(head, /_needGcal = !_lightChrome/);
  assert.match(head, /_needDmQueue = !_lightChrome/);
  assert.match(head, /_needReviews = !_lightChrome/);
  /* Sales items after Opportunities must stay light — those hops felt starved. */
  assert.match(head, /_np === 'engagement'/);
  assert.match(head, /_np === 'opportunities'/);
  assert.match(head, /_rp\.startsWith\('\/engagement'\)/);
  assert.match(js, /function ensureSoftphoneHelperScripts/);
  assert.match(js, /ensureSoftphoneHelperScripts\(\)/);
  /* Reviews / Q&A / SEO defer bell until inbox hydrate (or long fallback). */
  assert.match(navScripts, /_deferNavExtras/);
  assert.match(navScripts, /business-reviews/);
  assert.match(navScripts, /adhello:inbox-hydrated/);
  assert.match(navScripts, /requestIdleCallback/);
  assert.match(navScripts, /12000/);
});

test('opportunities board does not load maps scripts', () => {
  const head = fs.readFileSync(path.join(root, 'views/partials/head.ejs'), 'utf8');
  const needMapsAt = head.indexOf('const _needMaps');
  assert.ok(needMapsAt > -1);
  const chunk = head.slice(needMapsAt, needMapsAt + 450);
  assert.doesNotMatch(chunk, /\/opportunities/);
  assert.match(chunk, /\/pipeline/);
});

test('tasks page does not SSR every lead into the picker', () => {
  const route = fs.readFileSync(path.join(root, 'routes/tasks.js'), 'utf8');
  const page = fs.readFileSync(path.join(root, 'views/tasks.ejs'), 'utf8');
  assert.match(route, /getLeadTitlesByKeys/);
  assert.match(route, /leadChoices:\s*\[\]/);
  assert.doesNotMatch(route, /getAllLeads/);
  assert.match(page, /\/leads\/search\.json/);
  assert.doesNotMatch(page, /leadChoices\.forEach/);
});

test('engagement and activity skip full-workspace lead scans on first paint', () => {
  const eng = fs.readFileSync(path.join(root, 'routes/engagement.js'), 'utf8');
  const engView = fs.readFileSync(path.join(root, 'views/engagement.ejs'), 'utf8');
  const act = fs.readFileSync(path.join(root, 'routes/activity.js'), 'utf8');
  const ceo = fs.readFileSync(path.join(root, 'routes/ceo.js'), 'utf8');
  const db = fs.readFileSync(path.join(root, 'services/database.js'), 'utf8');
  const shellJs = fs.readFileSync(path.join(root, 'public/js/navbar-shell.js'), 'utf8');
  assert.match(db, /listLeadsForEngagementInbox/);
  assert.match(db, /listLeadsWithActivityTail/);
  assert.match(eng, /listLeadsForEngagementInbox/);
  assert.doesNotMatch(eng, /getAllLeads/);
  assert.match(eng, /pending:\s*true/);
  assert.match(engView, /runHydrate/);
  assert.match(shellJs, /engagement/);
  assert.match(act, /listLeadsWithActivityTail/);
  assert.doesNotMatch(act, /getAllLeads/);
  assert.match(ceo, /light:\s*true/);
});

test('Reports HTML does not await cold getAllLeads (keeps Reviews/Q&A responsive)', () => {
  const analytics = fs.readFileSync(path.join(root, 'routes/analytics.js'), 'utf8');
  const tracker = fs.readFileSync(path.join(root, 'services/salesTrackerLocals.js'), 'utf8');
  const navScripts = fs.readFileSync(path.join(root, 'views/partials/navbar_scripts.ejs'), 'utf8');
  const head = fs.readFileSync(path.join(root, 'views/partials/head.ejs'), 'utf8');
  const reviews = fs.readFileSync(path.join(root, 'routes/businessReviews.js'), 'utf8');
  const shellJs = fs.readFileSync(path.join(root, 'public/js/navbar-shell.js'), 'utf8');
  assert.match(analytics, /allowColdScan:\s*false/);
  assert.match(analytics, /peekCachedLeads|peekWorkspaceLeads/);
  assert.doesNotMatch(analytics, /await dbService\.getAllLeads/);
  // Even fire-and-forget cold scans freeze the event loop — must not kick from Reports.
  assert.doesNotMatch(analytics, /void dbService\.getAllLeads/);
  assert.doesNotMatch(tracker, /void dbService\.getAllLeads/);
  assert.match(tracker, /allowColdScan/);
  assert.match(tracker, /peekCachedLeads/);
  assert.match(navScripts, /_npShell === 'reports'/);
  assert.match(head, /_np === 'reports'/);
  assert.match(shellJs, /lightDest/);
  // Reviews shell must not KV-read settings before paint.
  const shellIdx = reviews.indexOf('if (shell)');
  assert.ok(shellIdx > 0);
  const shellChunk = reviews.slice(shellIdx, shellIdx + 900);
  assert.doesNotMatch(shellChunk, /getSettings\(/);
  assert.doesNotMatch(shellChunk, /getStore\(/);
});

test('Today / unscoped lead scans do not frost Reviews/Q&A hydrate', () => {
  const today = fs.readFileSync(path.join(root, 'routes/today.js'), 'utf8');
  const db = fs.readFileSync(path.join(root, 'services/database.js'), 'utf8');
  const reviewsRoute = fs.readFileSync(path.join(root, 'routes/businessReviews.js'), 'utf8');
  const qaRoute = fs.readFileSync(path.join(root, 'routes/seoQa.js'), 'utf8');
  const reviewsView = fs.readFileSync(path.join(root, 'views/business_reviews.ejs'), 'utf8');
  const qaView = fs.readFileSync(path.join(root, 'views/seo_qa.ejs'), 'utf8');
  const sw = fs.readFileSync(path.join(root, 'public/sw.js'), 'utf8');
  assert.match(today, /peekCachedLeads/);
  assert.match(today, /leadsForTodayPaint/);
  assert.match(today, /1500/);
  const unscopedStart = db.indexOf('async getAllLeadsUnscoped');
  assert.ok(unscopedStart > 0);
  const unscopedChunk = db.slice(unscopedStart, unscopedStart + 1600);
  assert.match(unscopedChunk, /ORDER BY key DESC/);
  assert.match(unscopedChunk, /LIMIT \?/);
  assert.match(unscopedChunk, /setImmediate/);
  assert.doesNotMatch(
    unscopedChunk,
    /SELECT key, value FROM kv WHERE key LIKE 'lead:%' ORDER BY key"\)\.all\(\)/,
  );
  assert.match(reviewsRoute, /pending:\s*true/);
  assert.match(qaRoute, /pending:\s*true/);
  assert.match(reviewsView, /runHydrate/);
  assert.match(reviewsView, /applySettingsForm/);
  assert.match(reviewsView, /12000/);
  assert.match(qaView, /runHydrate/);
  assert.match(qaView, /applySettingsForm/);
  assert.match(qaView, /12000/);
  assert.match(sw, /adhello-pwa-v1\.0\.746/);
});

test('Backlinks HTML paints without awaiting agency DFS resolve', () => {
  const route = fs.readFileSync(path.join(root, 'routes/backlinks.js'), 'utf8');
  const view = fs.readFileSync(path.join(root, 'views/backlinks.ejs'), 'utf8');
  assert.match(route, /pageLocalsLight/);
  assert.match(route, /status\.json/);
  assert.match(route, /projectsFromWorkspace/);
  assert.doesNotMatch(route, /res\.render\('backlinks', await pageLocals/);
  assert.match(view, /blDfsOffline/);
  assert.match(view, /\/backlinks\/status\.json/);
  assert.match(view, /loadDfsStatus/);
});

test('Remembered fix: menu hops never await cold getAllLeads / peel frost early', () => {
  const notifications = fs.readFileSync(path.join(root, 'routes/notifications.js'), 'utf8');
  const prospecting = fs.readFileSync(path.join(root, 'routes/prospecting.js'), 'utf8');
  const shellJs = fs.readFileSync(path.join(root, 'public/js/navbar-shell.js'), 'utf8');
  const navScripts = fs.readFileSync(path.join(root, 'views/partials/navbar_scripts.ejs'), 'utf8');
  const sched = fs.readFileSync(path.join(root, 'services/scheduler.js'), 'utf8');
  const db = fs.readFileSync(path.join(root, 'services/database.js'), 'utf8');
  const reviewsRoute = fs.readFileSync(path.join(root, 'routes/businessReviews.js'), 'utf8');
  const qaRoute = fs.readFileSync(path.join(root, 'routes/seoQa.js'), 'utf8');
  assert.match(notifications, /peekCachedLeads/);
  // Bell polls: warm-only. Never start cold listLeadsWithInboundEvents (locks SQLite).
  assert.match(notifications, /allowColdScan/);
  assert.match(notifications, /allowColdScan:\s*false/);
  assert.doesNotMatch(notifications, /Promise\.race/);
  assert.match(prospecting, /leadsForPipelinePaint/);
  assert.match(prospecting, /peekCachedLeads/);
  assert.match(shellJs, /pure white void/);
  assert.match(navScripts, /_npShell === 'engagement'/);
  assert.match(sched, /90000/);
  assert.match(sched, /120000/);
  // Inbound cold path must keyset-page like getAllLeads (no one-shot .all()).
  const inboundChunk = db.slice(
    db.indexOf('async listLeadsWithInboundEvents'),
    db.indexOf('async listLeadsForEngagementInbox'),
  );
  assert.match(inboundChunk, /ORDER BY key DESC/);
  assert.match(inboundChunk, /LIMIT \?/);
  assert.match(inboundChunk, /cursorKey/);
  assert.match(reviewsRoute, /countLeadsListInflight/);
  assert.match(qaRoute, /countLeadsListInflight/);
});


test('reassignLeadsToFolder uses workspace-scoped getAllLeads', () => {
  const db = fs.readFileSync(path.join(root, 'services/database.js'), 'utf8');
  const start = db.indexOf('async reassignLeadsToFolder');
  assert.ok(start > 0);
  const chunk = db.slice(start, start + 900);
  assert.match(chunk, /getAllLeads\(/);
  assert.doesNotMatch(chunk, /const keys = kvList\('lead:'\)/);
});


test('folder_manager_section renders shell and tree', async () => {
  const express = require('express');
  const { buildFolderTree } = require('../services/folderTree');
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(root, 'views'));
  app.set('view options', { root: path.join(root, 'views') });
  const section = fs.readFileSync(
    path.join(root, 'views/partials/folder_manager_section.ejs'),
    'utf8',
  );
  // Nested partial includes are relative to partials/ — partials/help/... 404s the page.
  assert.match(section, /include\('help\/folder_manager_info'\)/);
  assert.doesNotMatch(section, /include\('partials\/help\/folder_manager_info'\)/);
  const render = (name, locals) =>
    new Promise((resolve, reject) => {
      app.render(name, { tradeFolderCount: 28, ...locals }, (err, html) =>
        err ? reject(err) : resolve(html),
      );
    });
  const shell = await render('partials/folder_manager_section', {
    foldersShell: true,
    folders: [],
    folderTree: { groups: [] },
    folderAggregateCounts: {},
    folderAggregateTags: {},
  });
  assert.match(shell, /Loading folders/);
  const folders = [
    { key: 'folder:ws:1', name: 'Businesses', jobType: 'maps_business', isPipelineDefault: true },
  ];
  const full = await render('partials/folder_manager_section', {
    foldersShell: false,
    folders,
    folderTree: buildFolderTree(folders),
    folderAggregateCounts: {},
    folderAggregateTags: {},
  });
  assert.match(full, /folderManagerSection/);
  assert.match(full, /Businesses/);
  assert.match(full, /folderManagerHydrateJson/);
});
