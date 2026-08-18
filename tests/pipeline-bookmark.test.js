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
    assert.match(js, /JSON\.stringify\(\{\s*bookmarked:\s*next\s*\}\)/);
    assert.match(js, /window\.__togglePipelineLeadBookmark/);
    assert.match(js, /bookmark-btn--saved/);
    assert.match(js, /applyRowBookmarked\(row, bookmarkBtn, next\)/);
  });

  it('row bookmark button sits beside the checkbox and does not toggle twice', () => {
    assert.match(ejs, /pipeline-bookmark\.js/);
    assert.match(ejs, /class="lead-checkbox[\s\S]*pipeline-bookmark-btn/);
    assert.match(ejs, /data-saved="<%= lead\.bookmarked \? '1' : '0' %>"/);
    assert.match(ejs, /onclick="event\.preventDefault\(\); event\.stopPropagation\(\);"/);
    assert.equal(ejs.includes('__togglePipelineLeadBookmark(this.closest'), false);
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
});
