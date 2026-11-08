const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');

test('Search History first paint stays light', () => {
  const route = fs.readFileSync(path.join(root, 'routes/history.js'), 'utf8');
  const page = fs.readFileSync(path.join(root, 'views/history.ejs'), 'utf8');
  assert.match(route, /HISTORY_PAGE_LIMIT/);
  assert.doesNotMatch(route, /resolveSearchRecordFolderContext/);
  assert.doesNotMatch(route, /getAllSearches/);
  assert.doesNotMatch(page, /<script[^>]+\/js\/app\.js/);
  assert.match(page, /historyTruncated/);
});
