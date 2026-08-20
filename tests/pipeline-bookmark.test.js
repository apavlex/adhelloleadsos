const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

describe('pipeline row bookmark wiring', () => {
  const js = fs.readFileSync(path.join(ROOT, 'public/js/pipeline-bookmark.js'), 'utf8');
  const appJs = fs.readFileSync(path.join(ROOT, 'public/js/app.js'), 'utf8');
  const ejs = fs.readFileSync(path.join(ROOT, 'views/partials/leads_pipeline_core.ejs'), 'utf8');
  const css = fs.readFileSync(path.join(ROOT, 'public/css/custom.css'), 'utf8');
  const leadsEjs = fs.readFileSync(path.join(ROOT, 'views/leads.ejs'), 'utf8');
  const prospectingEjs = fs.readFileSync(path.join(ROOT, 'views/prospecting.ejs'), 'utf8');

  it('binds a capture click handler and posts bookmarked to lead update', () => {
    assert.match(js, /addEventListener\(\s*'click',\s*onPipelineBookmarkClick,\s*true\s*\)/);
    assert.match(js, /\/leads\/' \+ encodeURIComponent\(leadKey\) \+ '\/update'/);
    assert.match(js, /JSON\.stringify\(\{\s*bookmarked:\s*want\s*\}\)/);
    assert.match(js, /window\.__togglePipelineLeadBookmark/);
    assert.match(js, /window\.__setPipelineLeadBookmark/);
    assert.match(js, /bookmark-btn--saved/);
    assert.match(js, /applyRowBookmarked\(row, bookmarkBtn, want\)/);
  });

  it('row bookmark button sits beside the checkbox and does not toggle twice', () => {
    assert.match(ejs, /pipeline-bookmark\.js/);
    assert.match(ejs, /class="lead-checkbox[\s\S]*pipeline-bookmark-btn/);
    assert.match(ejs, /data-saved="<%= lead\.bookmarked \? '1' : '0' %>"/);
    assert.match(ejs, /onclick="event\.preventDefault\(\); event\.stopPropagation\(\);"/);
    assert.equal(ejs.includes('__togglePipelineLeadBookmark(this.closest'), false);
  });

  it('header bookmark-to-top control sits beside select-all, not in Company', () => {
    const checkTh = ejs.match(/<th data-plc="check"[\s\S]*?<\/th>/);
    const companyTh = ejs.match(/<th data-plc="company"[\s\S]*?<\/th>/);
    assert.ok(checkTh, 'check column header exists');
    assert.ok(companyTh, 'company column header exists');
    assert.match(checkTh[0], /data-select-all-leads[\s\S]*id="sortBookmarkedTopBtn"/);
    assert.match(checkTh[0], /prospect-bookmark-top-btn/);
    assert.equal(companyTh[0].includes('sortBookmarkedTopBtn'), false);
    assert.equal(companyTh[0].includes('prospect-bookmark-top-btn'), false);
  });

  it('loads the dedicated bookmark script before app.js on pipeline pages', () => {
    assert.match(leadsEjs, /pipeline-bookmark\.js[\s\S]*pipeline-bulk-select\.js[\s\S]*app\.js/);
    assert.match(prospectingEjs, /pipeline-bookmark\.js[\s\S]*pipeline-bulk-select\.js[\s\S]*app\.js/);
  });

  it('does not let app.js swallow pipeline clicks when the dedicated script is bound', () => {
    assert.match(
      appJs,
      /if \(isPipelineBtn && window\.__PIPELINE_BOOKMARK_BOUND === '1'\) return;/,
    );
    assert.match(appJs, /window\.__markPipelineBookmarkSaved/);
  });

  it('keeps filled bookmark styles and click-through on the sticky check cell', () => {
    assert.match(css, /td\.lead-sticky-check \{\s*pointer-events:\s*none;/);
    assert.match(css, /\.pipeline-bookmark-btn[\s\S]*pointer-events:\s*auto/);
    assert.match(css, /\.bookmark-btn\.bookmark-btn--saved svg[\s\S]*fill:\s*currentColor !important/);
    assert.match(css, /\.pipeline-bookmark-btn\.bookmark-btn--saved:hover/);
  });

  it('exposes bulk Bookmark on the tools row; Export and Merge sit before Cancel', () => {
    const bar = fs.readFileSync(path.join(ROOT, 'views/partials/bulk_action_bar.ejs'), 'utf8');
    const bulkJs = fs.readFileSync(path.join(ROOT, 'public/js/pipeline-bulk-select.js'), 'utf8');
    const toolsRowIdx = bar.indexOf('bulk-bar-tools-row');
    const secondaryIdx = bar.indexOf('bulk-bar-secondary-actions');
    const mergeIdx = bar.indexOf('id="bulkMergeBtn"');
    const exportIdx = bar.indexOf('js-bulk-export-csv');
    const bookmarkIdx = bar.indexOf('id="bulkBookmarkBtn"');
    const subaccountIdx = bar.indexOf('id="bulkCreateSubaccountBtn"');
    const cancelIdx = bar.indexOf('id="cancelSelectionBtn"');
    assert.ok(toolsRowIdx > 0 && secondaryIdx > toolsRowIdx, 'secondary actions follow tools row');
    assert.ok(bookmarkIdx > toolsRowIdx && bookmarkIdx < secondaryIdx, 'bookmark stays on tools row');
    assert.ok(subaccountIdx > bookmarkIdx && subaccountIdx < secondaryIdx, 'create subaccount stays after bookmark on tools row');
    assert.ok(exportIdx > secondaryIdx, 'export sits in secondary actions');
    assert.ok(mergeIdx > exportIdx, 'merge sits after export');
    assert.ok(cancelIdx > mergeIdx, 'cancel sits after merge');
    assert.match(bar, /id="bulkBookmarkBtn"[\s\S]*Bookmark/);
    assert.match(bar, /M17\.593 3\.322c1\.1\.128 1\.907 1\.077 1\.907 2\.185V21L12 17\.25/);
    assert.match(bulkJs, /e\.target\.closest\('#bulkBookmarkBtn'\)/);
    assert.match(bulkJs, /function bulkBookmarkSelectedLeads/);
    assert.match(bulkJs, /Bookmarked ' \+ okCount/);
    assert.match(bulkJs, /__setPipelineLeadBookmark/);
    assert.ok(bar.includes('canManageWorkspace') && bookmarkIdx < bar.indexOf('canManageWorkspace', bookmarkIdx));
  });
});
