/**
 * Field-work teammate owner label is a quiet stacked text mark — not a filled pill.
 */
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');

function chipBlock(file) {
  const css = fs.readFileSync(path.join(root, file), 'utf8');
  const start = css.indexOf('.fw-owner-chip');
  assert.ok(start >= 0, file + ' should define .fw-owner-chip');
  return css.slice(start, start + 700);
}

test('job detail teammate label is stacked text, not a filled pill', () => {
  const chip = chipBlock('views/network_field_work_job.ejs');
  assert.match(chip, /flex-direction:\s*column/);
  assert.match(chip, /background:\s*transparent/);
  assert.doesNotMatch(chip, /border-radius:\s*999px/);
  assert.doesNotMatch(chip, /brand-yellow/);
});

test('customer detail teammate label matches job detail', () => {
  const chip = chipBlock('views/network_field_work_customer.ejs');
  assert.match(chip, /flex-direction:\s*column/);
  assert.match(chip, /background:\s*transparent/);
  assert.doesNotMatch(chip, /border-radius:\s*999px/);
});

test('field-work list teammate mark drops the filled box', () => {
  const css = fs.readFileSync(path.join(root, 'views/network.ejs'), 'utf8');
  const start = css.indexOf('.fw-job__team {');
  const block = css.slice(start, start + 450);
  assert.match(block, /background:\s*transparent/);
  assert.doesNotMatch(block, /border-radius:\s*0\.65rem/);
});
