const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const today = fs.readFileSync(path.join(__dirname, '../views/today.ejs'), 'utf8');
const head = fs.readFileSync(path.join(__dirname, '../views/partials/head.ejs'), 'utf8');
const js = fs.readFileSync(path.join(__dirname, '../public/js/today-dashboard-layout.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../public/css/today-dashboard-layout.css'), 'utf8');
const hub = fs.readFileSync(path.join(__dirname, '../views/partials/today_touches_hub.ejs'), 'utf8');

describe('Today dashboard customize', () => {
  it('wires customize control and section markers', () => {
    assert.match(today, /id="todayDashCustomizeBtn"/);
    assert.match(today, /data-today-section="hero"/);
    assert.match(today, /data-today-section="sources"/);
    assert.match(today, /data-today-section="resume"/);
    assert.match(today, /data-today-section="actions"/);
    assert.match(today, /data-today-section="pipeline"/);
    assert.match(today, /data-today-section="dueTasks"/);
    assert.match(today, /data-today-section="weekReview"/);
    assert.match(hub, /data-today-section="touches"/);
  });

  it('loads layout script on Today and persists hide/order', () => {
    assert.match(head, /today-dashboard-layout\.js/);
    assert.match(head, /today-dashboard-layout\.css/);
    assert.match(js, /adhello-today-dash-layout/);
    assert.match(js, /function applyLayout/);
    assert.match(js, /data-today-dash-save/);
    assert.match(css, /\.today-dash-section--hidden/);
  });

  it('syncs layout to the account so mobile matches desktop', () => {
    assert.match(head, /__SERVER_TODAY_DASH_LAYOUT/);
    assert.match(js, /\/today\/dashboard-layout/);
    assert.match(js, /__SERVER_TODAY_DASH_LAYOUT/);
    assert.match(js, /works on phone and desktop/);
    const todayRoute = require('fs').readFileSync(
      require('path').join(__dirname, '../routes/today.js'),
      'utf8',
    );
    assert.match(todayRoute, /dashboard-layout\.json/);
    assert.match(todayRoute, /saveTodayDashboardPrefs/);
  });
});
