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
});
