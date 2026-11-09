const fs = require('fs');
const path = require('path');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');

describe('customer profile Auto follow-up toggle', () => {
  it('exposes follow-up launch/stop route and toggle UI', () => {
    const route = fs.readFileSync(path.join(root, 'routes/memberApp.js'), 'utf8');
    const page = fs.readFileSync(path.join(root, 'views/member_app/customer.ejs'), 'utf8');
    const css = fs.readFileSync(path.join(root, 'public/css/member-app.css'), 'utf8');
    const ask = fs.readFileSync(path.join(root, 'services/reviewAsk.js'), 'utf8');

    assert.match(route, /customers\/c\/:id\/follow-up/);
    assert.match(route, /reviewRequestAutomation\.requestReview/);
    assert.match(route, /reviewAsk\.stopFollowUp/);
    assert.match(route, /presentFollowUpToggle/);
    assert.match(route, /follow_up_on/);
    assert.match(route, /followUpToggle/);

    assert.match(page, /Auto follow-up/);
    assert.match(page, /customers\/c\/<%= customer\.id %>\/follow-up/);
    assert.match(page, /ma-followup__switch/);
    assert.match(page, /role="switch"/);

    assert.match(css, /\.ma-followup__/);
    assert.match(ask, /function isFollowUpActive/);
    assert.match(ask, /async function stopFollowUp/);
    assert.match(ask, /followUpStoppedAt/);
  });
});
