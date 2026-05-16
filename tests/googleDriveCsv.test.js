const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const {
  downloadDriveFileAsCsvBuffer,
  classifyDriveFile,
  parseDriveApiError,
} = require('../services/googleDriveCsv');

const originalFetch = global.fetch;

function mockFetch(handler) {
  global.fetch = handler;
}

describe('googleDriveCsv', () => {
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('classifyDriveFile accepts csv mime and extensions', () => {
    assert.equal(classifyDriveFile('text/csv', 'data.bin'), 'csv');
    assert.equal(classifyDriveFile('application/octet-stream', 'leads.csv'), 'csv');
    assert.equal(
      classifyDriveFile('application/vnd.google-apps.spreadsheet', 'Sheet1'),
      'sheet'
    );
    assert.equal(classifyDriveFile('application/pdf', 'report.pdf'), null);
    assert.equal(
      classifyDriveFile(
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'leads.xlsx'
      ),
      'xlsx'
    );
    assert.equal(classifyDriveFile('application/octet-stream', 'pipeline.xlsx'), 'xlsx');
  });

  it('parseDriveApiError extracts Google error message', () => {
    const body = JSON.stringify({ error: { message: 'File not found' } });
    assert.equal(parseDriveApiError(body, 'fallback'), 'File not found');
  });

  it('downloads csv with shared-drive query params', async () => {
    const calls = [];
    mockFetch(async (url) => {
      calls.push(url);
      if (url.includes('fields=')) {
        return {
          ok: true,
          json: async () => ({ name: 'leads.csv', mimeType: 'text/csv' }),
        };
      }
      if (url.includes('alt=media')) {
        assert.match(url, /supportsAllDrives=true/);
        return { ok: true, arrayBuffer: async () => new TextEncoder().encode('a,b\n1,2').buffer };
      }
      throw new Error(`unexpected url: ${url}`);
    });

    const out = await downloadDriveFileAsCsvBuffer('token', 'file123');
    assert.equal(out.name, 'leads.csv');
    assert.equal(out.buffer.toString('utf8'), 'a,b\n1,2');
    assert.ok(calls.some((u) => u.includes('includeItemsFromAllDrives=true')));
  });

  it('exports google sheets as csv', async () => {
    mockFetch(async (url) => {
      if (url.includes('fields=')) {
        return {
          ok: true,
          json: async () => ({
            name: 'Pipeline',
            mimeType: 'application/vnd.google-apps.spreadsheet',
          }),
        };
      }
      if (url.includes('/export')) {
        assert.match(url, /mimeType=text%2Fcsv/);
        return { ok: true, arrayBuffer: async () => new TextEncoder().encode('x,y').buffer };
      }
      throw new Error(`unexpected url: ${url}`);
    });

    const out = await downloadDriveFileAsCsvBuffer('token', 'sheet-id');
    assert.equal(out.buffer.toString('utf8'), 'x,y');
  });

  it('surfaces readable errors from failed download', async () => {
    mockFetch(async (url) => {
      if (url.includes('fields=')) {
        return {
          ok: true,
          json: async () => ({ name: 'leads.csv', mimeType: 'text/csv' }),
        };
      }
      return {
        ok: false,
        status: 404,
        arrayBuffer: async () =>
          new TextEncoder().encode(
            JSON.stringify({ error: { message: 'File not found: abc.' } })
          ).buffer,
      };
    });

    await assert.rejects(
      () => downloadDriveFileAsCsvBuffer('token', 'missing'),
      /File not found: abc/
    );
  });
});
