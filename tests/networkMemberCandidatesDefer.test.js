/**
 * Network Members SSR must not full-scan leads; candidates hydrate after paint.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

describe('Network member candidates deferred', () => {
  it('SSR skips getAllLeads for members and exposes a JSON hydrate route', () => {
    const route = fs.readFileSync(path.join(root, 'routes/network.js'), 'utf8');
    assert.match(route, /deferMemberCandidates/);
    assert.match(route, /router\.get\('\/member-candidates'/);
    // Page render sets empty candidates + defer flag; scan lives only on the JSON route.
    const pageGet = route.slice(route.indexOf("router.get('/',"), route.indexOf('let fieldWork = null'));
    assert.match(pageGet, /const candidates = \[\]/);
    assert.match(pageGet, /deferMemberCandidates/);
    assert.doesNotMatch(pageGet, /getAllLeads/);
    const jsonRoute = route.slice(route.indexOf("router.get('/member-candidates'"));
    assert.match(jsonRoute, /getAllLeads/);
  });

  it('Members tab hydrates partners after paint', () => {
    const view = fs.readFileSync(path.join(root, 'views/network.ejs'), 'utf8');
    assert.match(view, /deferMemberCandidates/);
    assert.match(view, /\/network\/member-candidates/);
    assert.match(view, /netAddMemberMount/);
    assert.match(view, /Loading referral partners/);
  });
});
