const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const bulkBarPath = path.join(__dirname, '../views/partials/bulk_action_bar.ejs');
const pipelineCorePath = path.join(__dirname, '../views/partials/leads_pipeline_core.ejs');
const shareServicePath = path.join(__dirname, '../services/leadWorkspaceShare.js');
const foldersRoutePath = path.join(__dirname, '../routes/folders.js');
const bulkSelectPath = path.join(__dirname, '../public/js/pipeline-bulk-select.js');

describe('bulk bar Share/Delete + select-all', () => {
  it('moves Share and Delete under Cancel in the secondary row', () => {
    const html = fs.readFileSync(bulkBarPath, 'utf8');
    const primaryIdx = html.indexOf('bulk-bar-primary-row');
    const secondaryIdx = html.indexOf('bulk-bar-secondary-actions');
    assert.ok(primaryIdx > 0);
    assert.ok(secondaryIdx > primaryIdx);

    const primaryChunk = html.slice(primaryIdx, secondaryIdx);
    assert.doesNotMatch(primaryChunk, /id="bulkShareWorkspaceBtn"/);
    assert.doesNotMatch(primaryChunk, /id="bulkDeleteBtn"/);

    const secondaryChunk = html.slice(secondaryIdx);
    assert.match(secondaryChunk, /id="cancelSelectionBtn"/);
    assert.match(secondaryChunk, /id="bulkShareWorkspaceBtn"/);
    assert.match(secondaryChunk, /id="bulkDeleteBtn"/);
    assert.doesNotMatch(secondaryChunk, /id="bulkSelectAllFolderBtn"/);

    const cancelIdx = secondaryChunk.indexOf('id="cancelSelectionBtn"');
    const shareIdx = secondaryChunk.indexOf('id="bulkShareWorkspaceBtn"');
    const deleteIdx = secondaryChunk.indexOf('id="bulkDeleteBtn"');
    assert.ok(cancelIdx >= 0);
    assert.ok(shareIdx > cancelIdx, 'Share should sit with/after Cancel');
    assert.ok(deleteIdx > cancelIdx, 'Delete should sit with/after Cancel');
  });

  it('places Select all next to the Selected count', () => {
    const html = fs.readFileSync(bulkBarPath, 'utf8');
    const countIdx = html.indexOf('bulk-bar-count');
    const folderStripIdx = html.indexOf('bulk-bar-folder-strip');
    assert.ok(countIdx > 0);
    assert.ok(folderStripIdx > countIdx);
    const countChunk = html.slice(countIdx, folderStripIdx);
    const selectedIdx = countChunk.indexOf('bulk-bar-selected-label');
    const selectAllIdx = countChunk.indexOf('id="bulkSelectAllFolderBtn"');
    assert.ok(selectedIdx >= 0);
    assert.ok(selectAllIdx > selectedIdx, 'Select all should sit after Selected label');
  });

  it('exposes a one-click Select all control on the pipeline paging bar', () => {
    const html = fs.readFileSync(pipelineCorePath, 'utf8');
    assert.match(html, /id="pipelineTableSelectAllBtn"/);
    assert.match(html, /Select all/);
  });

  it('supports uncapped selection keys for folders', () => {
    const svc = fs.readFileSync(shareServicePath, 'utf8');
    const route = fs.readFileSync(foldersRoutePath, 'utf8');
    assert.match(svc, /MAX_SELECTION_LEADS\s*=\s*10000/);
    assert.match(svc, /opts\.max/);
    assert.match(route, /purpose\s*===\s*'select'/);
    assert.match(route, /MAX_SELECTION_LEADS/);
  });

  it('wires select-all-in-list helpers in pipeline-bulk-select', () => {
    const js = fs.readFileSync(bulkSelectPath, 'utf8');
    assert.match(js, /__selectAllInCurrentList/);
    assert.match(js, /purpose=select/);
    assert.match(js, /folderWideKeys/);
    assert.match(js, /pipelineTableSelectAllBtn/);
    assert.match(js, /fetchPipelineListSelectionKeys/);
    assert.match(js, /\/prospecting\/lead-keys\.json/);
    assert.match(js, /__bulkFolderWidePainting/);
  });

  it('keeps large select-all off the per-row DOM / softphone hot path', () => {
    const bulk = fs.readFileSync(bulkSelectPath, 'utf8');
    const app = fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf8');
    const nav = fs.readFileSync(path.join(__dirname, '../public/js/navbar-shell.js'), 'utf8');
    assert.match(bulk, /markVisibleRowsForFolderWideSelection/);
    assert.match(bulk, /pipeline-row-page-hidden/);
    assert.match(bulk, /BULK_SELECTION_HEAVY_AT/);
    assert.match(bulk, /FOCUS_URL_KEY_CAP/);
    assert.match(app, /isHeavyFolderWideSelection/);
    assert.match(app, /updateBulkActionBar = \(opts\)/);
    assert.match(nav, /__bulkFolderWideIsHeavy/);
  });

  it('exposes pipeline lead-keys JSON matching table-rows filters', () => {
    const route = fs.readFileSync(path.join(__dirname, '../routes/prospecting.js'), 'utf8');
    assert.match(route, /resolvePipelineListLeads/);
    assert.match(route, /router\.get\('\/lead-keys\.json'/);
    assert.match(route, /purpose:\s*'select'/);
  });

  it('Directory uses the full Select all set when only the visible page is checked', () => {
    const bar = fs.readFileSync(bulkBarPath, 'utf8');
    const src = bar.slice(bar.indexOf('function addKey'), bar.indexOf('function say'));
    const selectedKeys = new Function(
      'window',
      'document',
      `${src}\nreturn selectedKeys;`,
    )(
      {
        __collectSelectedLeadKeysEarly() {
          const keys = [];
          for (let i = 0; i < 120; i += 1) keys.push(`lead:row_${i}`);
          return keys;
        },
      },
      {
        querySelectorAll() {
          const boxes = [];
          for (let i = 0; i < 50; i += 1) {
            boxes.push({
              closest() {
                return { getAttribute: () => `lead:row_${i}` };
              },
              getAttribute: () => '',
            });
          }
          return boxes;
        },
      },
    );
    const keys = selectedKeys();
    assert.equal(keys.length, 120);
    assert.equal(keys[0], 'lead:row_0');
    assert.equal(keys[119], 'lead:row_119');
  });

  it('includes folder descendants when selecting via folders lead-keys', () => {
    const route = fs.readFileSync(foldersRoutePath, 'utf8');
    assert.match(route, /folderKeysIncludingDescendants/);
    assert.match(route, /buildFolderTree/);
  });
});
