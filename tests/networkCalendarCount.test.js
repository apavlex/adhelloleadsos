/**
 * Team calendar day chips show a bare count — not "1 job" / "2 jobs".
 */
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const network = fs.readFileSync(path.join(__dirname, '../views/network.ejs'), 'utf8');

test('team calendar day badge is number-only', () => {
  assert.match(network, /class="fw-cal-count"><%= d\.count %><\/span>/);
  assert.doesNotMatch(
    network,
    /class="fw-cal-count"><%= d\.count %> job/,
  );
});
