const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const appJs = fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf8');
const openLite = fs.readFileSync(path.join(__dirname, '../public/js/open-lead-detail.js'), 'utf8');
const rowActions = fs.readFileSync(path.join(__dirname, '../public/js/pipeline-row-actions.js'), 'utf8');
const rowsEjs = fs.readFileSync(path.join(__dirname, '../views/partials/pipeline_lead_rows.ejs'), 'utf8');

describe('pipeline » opens panel; title opens Money Mode', () => {
  it('selectRow and openLeadDetailFromKey do not redirect to Money Mode', () => {
    assert.doesNotMatch(
      appJs,
      /const selectRow = async \(row\) => \{[\s\S]{0,400}__adhelloMoneyModeLeadUrl/,
    );
    assert.doesNotMatch(
      appJs,
      /window\.openLeadDetailFromKey = async \(rawKey\) => \{[\s\S]{0,300}__adhelloMoneyModeLeadUrl/,
    );
    assert.doesNotMatch(openLite, /__adhelloMoneyModeLeadUrl/);
  });

  it('Money Mode is triggered only from the company title', () => {
    assert.match(rowActions, /isMoneyModeTitleClick/);
    assert.match(rowActions, /\.company-title-text,\s*\.js-money-mode-title/);
    assert.doesNotMatch(rowActions, /isMoneyModeRowClick/);
    assert.match(rowsEjs, /js-money-mode-title/);
    assert.match(rowsEjs, /view-detail-btn/);
    assert.match(rowsEjs, /Open Money Mode/);
  });
});
