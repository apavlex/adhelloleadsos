const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  buildKitchenRemodelTimeline,
  presentTimeline,
  sanitizeTimeline,
  toggleStepDone,
} = require('../services/projectTimeline');

describe('projectTimeline', () => {
  it('builds a kitchen remodel with parallel MEP trades', () => {
    const steps = buildKitchenRemodelTimeline();
    assert.ok(steps.length >= 15);
    const plumbing = steps.find((s) => s.id === 'plumbing');
    const electrical = steps.find((s) => s.id === 'electrical');
    const hvac = steps.find((s) => s.id === 'hvac');
    assert.ok(plumbing && electrical && hvac);
    assert.equal(plumbing.startDay, electrical.startDay);
    assert.equal(plumbing.startDay, hvac.startDay);
    assert.equal(plumbing.parallelGroup, 'mep');
  });

  it('presents total duration and bar geometry', () => {
    const presented = presentTimeline({
      template: 'kitchen_remodel',
      steps: buildKitchenRemodelTimeline(),
    });
    assert.ok(presented);
    assert.match(presented.totalLabel, /days/);
    assert.ok(presented.spanDays >= 20);
    assert.ok(presented.steps[0].barWidthPct > 0);
    assert.match(presented.hint, /parallel/i);
  });

  it('toggles step completion', () => {
    const base = sanitizeTimeline({ steps: buildKitchenRemodelTimeline() });
    const next = toggleStepDone(base, 'demo', true);
    assert.equal(next.steps.find((s) => s.id === 'demo').done, true);
    const back = toggleStepDone(next, 'demo', false);
    assert.equal(back.steps.find((s) => s.id === 'demo').done, false);
  });

  it('wires Reviews job page + Projects plan tools', () => {
    const job = fs.readFileSync(path.join(__dirname, '../views/member_app/job.ejs'), 'utf8');
    const customers = fs.readFileSync(path.join(__dirname, '../views/member_app/customers.ejs'), 'utf8');
    const partial = fs.readFileSync(path.join(__dirname, '../views/member_app/_job_timeline.ejs'), 'utf8');
    const css = fs.readFileSync(path.join(__dirname, '../public/css/member-app.css'), 'utf8');
    const routes = fs.readFileSync(path.join(__dirname, '../routes/memberApp.js'), 'utf8');
    assert.match(job, /_job_timeline/);
    assert.match(customers, /Plan projects/);
    assert.match(partial, /Estimated Gantt Timeline/);
    assert.match(css, /\.ma-gantt__bar/);
    assert.match(routes, /timeline\/seed/);
    assert.match(routes, /seedJobTimeline/);
  });
});
