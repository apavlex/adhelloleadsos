const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '../views/today.ejs'), 'utf8');

describe('Today Due & overdue sits under Marketing Pipeline', () => {
  it('places the due-tasks section immediately after the opportunity board slot', () => {
    const oppIdx = html.indexOf('id="todayOppBoardSlot"');
    const dueIdx = html.indexOf('id="todayDueTasks"');
    const weekIdx = html.indexOf('id="todayWeekReviewSlot"');
    const touchesIdx = html.indexOf("include('/partials/today_touches_hub')");
    assert.ok(oppIdx > 0);
    assert.ok(dueIdx > oppIdx, 'Due tasks should follow opportunity board');
    assert.ok(weekIdx > dueIdx, 'Week review should follow due tasks');
    assert.ok(touchesIdx > dueIdx, 'Touches hub should follow due tasks');
    assert.match(html, /Due &amp; overdue/);
  });
});
