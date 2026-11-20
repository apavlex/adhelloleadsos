const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const ejs = require('ejs');
const fs = require('fs');
const path = require('path');

const views = path.join(__dirname, '..', 'views');

describe('contextSidebar EJS locals', () => {
  it('parent var alone does not reach includes (documents the trap)', () => {
    const tpl = `<% var contextSidebar = { title: 'FromVar', links: [] }; %><%- include('partials/app_context_sidebar') %>`;
    const html = ejs.render(tpl, {}, { filename: path.join(views, 'prospecting.ejs'), root: views, views: [views] });
    assert.equal(html.includes('appContextSidebar'), false);
  });

  it('locals.contextSidebar reaches app_context_sidebar include', () => {
    const tpl = `<% locals.contextSidebar = { title: 'Pipeline Test', eyebrow: 'Pipeline', links: [{ href: '/sequences', label: 'Cadences' }], refine: false }; %><%- include('partials/app_context_sidebar') %>`;
    const html = ejs.render(tpl, {}, { filename: path.join(views, 'prospecting.ejs'), root: views, views: [views] });
    assert.match(html, /id="appContextSidebar"/);
    assert.match(html, /Pipeline Test/);
    assert.match(html, /Cadences/);
  });

  it('prospecting / leads / outreach set locals.contextSidebar not bare var', () => {
    for (const rel of ['prospecting.ejs', 'leads.ejs', 'outreach.ejs', 'sales-hub.ejs', 'sales-workflow.ejs', 'sales-tracker.ejs', 'sales-personas.ejs']) {
      const src = fs.readFileSync(path.join(views, rel), 'utf8');
      assert.match(src, /locals\.contextSidebar\s*=/, `${rel} should assign locals.contextSidebar`);
      assert.doesNotMatch(src, /\bvar\s+contextSidebar\b/, `${rel} should not use var contextSidebar`);
    }
  });

  it('pipeline second menu keeps refine without Cadences / Working queue jump links', () => {
    const src = fs.readFileSync(path.join(views, 'prospecting.ejs'), 'utf8');
    const pipelineBlock = src.match(/if \(activeTab === 'pipeline'\) \{[\s\S]*?else if \(activeTab === 'queue'\)/);
    assert.ok(pipelineBlock, 'expected pipeline contextSidebar block');
    assert.match(pipelineBlock[0], /links:\s*\[\]/);
    assert.match(pipelineBlock[0], /refine:\s*'pipeline'/);
    assert.doesNotMatch(pipelineBlock[0], /label:\s*'Cadences'/);
    assert.doesNotMatch(pipelineBlock[0], /label:\s*'Working queue'/);
    assert.doesNotMatch(pipelineBlock[0], /label:\s*'Folders'/);
    assert.doesNotMatch(pipelineBlock[0], /label:\s*'Find more leads'/);
    assert.doesNotMatch(pipelineBlock[0], /label:\s*'Team & assign'/);
  });
});
