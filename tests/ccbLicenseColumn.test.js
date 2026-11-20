const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const core = fs.readFileSync(path.join(__dirname, '../views/partials/leads_pipeline_core.ejs'), 'utf8');
const rows = fs.readFileSync(path.join(__dirname, '../views/partials/pipeline_lead_rows.ejs'), 'utf8');
const appJs = fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf8');

describe('CCB / License pipeline column', () => {
  it('adds table header and cell for ccbLicense', () => {
    assert.match(core, /data-plc="ccbLicense"/);
    assert.match(core, /CCB \/ License/);
    assert.match(rows, /data-plc="ccbLicense"/);
    assert.match(rows, /contractorLicenseNumber/);
    assert.match(rows, /data-ccb-license=/);
  });

  it('registers column in Columns picker + sort', () => {
    assert.match(appJs, /id:\s*'ccbLicense'/);
    assert.match(appJs, /ccblicense/);
    assert.match(appJs, /case 'ccblicense'/);
  });
});
