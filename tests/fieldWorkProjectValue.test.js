/**
 * Leads Network field-work cards surface Reviews-app project value.
 */
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const card = fs.readFileSync(path.join(__dirname, '../views/partials/network_fw_job_card.ejs'), 'utf8');
const detail = fs.readFileSync(path.join(__dirname, '../views/network_field_work_job.ejs'), 'utf8');

test('field work job card shows valueLabel beside status', () => {
  assert.match(card, /row\.valueLabel/);
  assert.match(card, /fw-job__value/);
  assert.match(card, /Project value/);
});

test('field work job detail shows valueLabel', () => {
  assert.match(detail, /d\.valueLabel/);
});
