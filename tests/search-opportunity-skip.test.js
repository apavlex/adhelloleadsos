const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

describe('search results Opportunity skip', () => {
  const js = fs.readFileSync(path.join(ROOT, 'public/js/app.js'), 'utf8');
  const ejs = fs.readFileSync(path.join(ROOT, 'views/results.ejs'), 'utf8');

  it('does not auto-paint Opportunity badges on the search results table', () => {
    assert.match(
      js,
      /const isSearchResultsTablePage = \(\) => !!document\.getElementById\('searchResultsLeadsTable'\)/,
    );
    assert.match(js, /if \(isSearchResultsTablePage\(\)\) return;/);
    assert.match(js, /if \(searchPage && row\.dataset\.opportunityReady !== '1'\) return;/);
    assert.match(js, /const revealOpportunityForRow = \(row\) =>/);
    assert.match(js, /if \(!isSearchResultsTablePage\(\)\) sortLeadsByOpportunity\(false\)/);
  });

  it('search Opportunity cell shows a placeholder instead of auto-vetting', () => {
    assert.match(ejs, /id="searchResultsLeadsTable"/);
    assert.match(ejs, /opportunity-badge[\s\S]*?—/);
    assert.equal(ejs.includes('Vetting...'), false);
  });
});
