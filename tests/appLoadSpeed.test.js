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
  /* Reviews / Q&A / SEO defer bell JS until idle so first paint is not blocked. */
  assert.match(navScripts, /_deferNavExtras/);
  assert.match(navScripts, /business-reviews/);
  assert.match(navScripts, /requestIdleCallback/);
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
  const act = fs.readFileSync(path.join(root, 'routes/activity.js'), 'utf8');
  const ceo = fs.readFileSync(path.join(root, 'routes/ceo.js'), 'utf8');
  const db = fs.readFileSync(path.join(root, 'services/database.js'), 'utf8');
  assert.match(db, /listLeadsForEngagementInbox/);
  assert.match(db, /listLeadsWithActivityTail/);
  assert.match(eng, /listLeadsForEngagementInbox/);
  assert.doesNotMatch(eng, /getAllLeads/);
  assert.match(act, /listLeadsWithActivityTail/);
  assert.doesNotMatch(act, /getAllLeads/);
  assert.match(ceo, /light:\s*true/);
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
