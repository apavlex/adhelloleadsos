const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const ejs = require('ejs');
const path = require('path');
const fs = require('fs');
const { resolveCarrierSellingPoints } = require('../services/carrierSellingPoints');

const views = path.join(__dirname, '..', 'views');

describe('pipeline_lead_rows carrier chips', () => {
  it('does not use a relative require that breaks under EJS cwd resolution', () => {
    const src = fs.readFileSync(path.join(views, 'partials/pipeline_lead_rows.ejs'), 'utf8');
    assert.doesNotMatch(src, /require\(['"]\.\.\/\.\.\/services\/carrierSellingPoints['"]\)/);
  });

  it('renders carrier chips when resolveCarrierSellingPoints is provided via locals', () => {
    const html = ejs.render(
      `<%- include('partials/pipeline_lead_rows') %>`,
      {
        leads: [
          {
            key: 'lead:test',
            title: '8K TRANSPORTATION LLC',
            phone: '9567650026',
            importFields: {
              mc_no: '1592260',
              driver: '15',
              ins_co: 'AGRICULTURAL WORKERS MUTUAL AU',
              cover: 'BI&PD',
            },
          },
        ],
        pipelineStages: [],
        tags: [],
        folders: [],
        resolveCarrierSellingPoints,
      },
      { filename: path.join(views, 'prospecting.ejs'), root: views, views: [views] },
    );
    assert.match(html, /MC 1592260/);
    assert.match(html, /15 driver/);
    assert.match(html, /AGRICULTURAL WORKERS MUTUAL AU/);
  });
});
