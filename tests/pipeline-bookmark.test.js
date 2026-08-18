const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

describe('pipeline row bookmark wiring', () => {
  const js = fs.readFileSync(path.join(ROOT, 'public/js/pipeline-bookmark.js'), 'utf8');
  const ejs = fs.readFileSync(path.join(ROOT, 'views/partials/leads_pipeline_core.ejs'), 'utf8');
  const css = fs.readFileSync(path.join(ROOT, 'public/css/custom.css'), 'utf8');

  it('binds a capture click handler and posts bookmarked to lead update', () => {
    assert.match(js, /addEventListener\(\s*'click',\s*onPipelineBookmarkClick,\s*true\s*\)/);
    assert.match(js, /\/leads\/' \+ encodeURIComponent\(leadKey\) \+ '\/update'/);
    assert.match(js, /JSON\.stringify\(\{\s*bookmarked:\s*next\s*\}\)/);
    assert.match(js, /window\.__togglePipelineLeadBookmark/);
    assert.match(js, /bookmark-btn--saved/);
  });

  it('row bookmark button calls the toggle helper and sits beside the checkbox', () => {
    assert.match(ejs, /pipeline-bookmark\.js/);
    assert.match(ejs, /__togglePipelineLeadBookmark/);
    assert.match(ejs, /class="lead-checkbox[\s\S]*pipeline-bookmark-btn/);
    assert.match(ejs, /data-saved="<%= lead\.bookmarked \? '1' : '0' %>"/);
  });

  it('keeps filled bookmark styles and click-through on the sticky check cell', () => {
    assert.match(css, /td\.lead-sticky-check \{\s*pointer-events:\s*none;/);
    assert.match(css, /\.pipeline-bookmark-btn[\s\S]*pointer-events:\s*auto/);
    assert.match(css, /\.bookmark-btn\.bookmark-btn--saved svg \{\s*fill:\s*currentColor !important;/);
  });
});
