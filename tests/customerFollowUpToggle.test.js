const fs = require('fs');
const path = require('path');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');

describe('customer profile Auto follow-up via Review button', () => {
  it('folds Auto follow-up into the Review action sheet', () => {
    const route = fs.readFileSync(path.join(root, 'routes/memberApp.js'), 'utf8');
    const page = fs.readFileSync(path.join(root, 'views/member_app/customer.ejs'), 'utf8');
    const css = fs.readFileSync(path.join(root, 'public/css/member-app.css'), 'utf8');
    const js = fs.readFileSync(path.join(root, 'public/js/member-app.js'), 'utf8');
    const ask = fs.readFileSync(path.join(root, 'services/reviewAsk.js'), 'utf8');

    assert.match(route, /customers\/c\/:id\/follow-up/);
    assert.match(route, /reviewRequestAutomation\.requestReview/);
    assert.match(route, /reviewAsk\.stopFollowUp/);
    assert.match(route, /presentFollowUpToggle/);

    assert.match(page, /data-ma-review-actions/);
    assert.match(page, /data-ma-review-open/);
    assert.match(page, /Confirm &amp; send/);
    assert.match(page, /Auto follow-up/);
    assert.match(page, /customers\/c\/<%= customer\.id %>\/follow-up/);
    assert.doesNotMatch(page, /class="ma-followup/);

    assert.match(css, /\.ma-review-sheet/);
    assert.match(css, /\.ma-quick__dot/);
    assert.doesNotMatch(css, /\.ma-followup__switch/);

    assert.match(js, /initReviewActions/);
    assert.match(js, /data-ma-review-actions/);

    assert.match(ask, /function isFollowUpActive/);
    assert.match(ask, /async function stopFollowUp/);
  });
});
