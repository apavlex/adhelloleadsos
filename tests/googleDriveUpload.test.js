const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const { uploadCsvToDrive, safeDriveFileName } = require('../services/googleDriveUpload');

const originalFetch = global.fetch;

describe('googleDriveUpload', () => {
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('safeDriveFileName sanitizes and adds .csv', () => {
    assert.equal(safeDriveFileName('report'), 'report.csv');
    assert.equal(safeDriveFileName('bad/name?.csv'), 'bad_name_.csv');
  });

  it('uploadCsvToDrive multipart upload returns file metadata', async () => {
    const calls = [];
    global.fetch = async (url, init) => {
      calls.push({ url, method: init && init.method });
      if (url.includes('q=') && url.includes('folder')) {
        return {
          ok: true,
          json: async () => ({ files: [{ id: 'folder-1' }] }),
        };
      }
      if (url.includes('upload/drive')) {
        assert.equal(init.method, 'POST');
        assert.match(init.headers['Content-Type'], /multipart\/related/);
        return {
          ok: true,
          arrayBuffer: async () =>
            new TextEncoder().encode(
              JSON.stringify({
                id: 'file-abc',
                name: 'AdHello_Leads_2026-05-16.csv',
                webViewLink: 'https://drive.google.com/file/d/file-abc/view',
              })
            ).buffer,
        };
      }
      throw new Error(`unexpected: ${url}`);
    };

    const out = await uploadCsvToDrive('token', {
      name: 'AdHello_Leads_2026-05-16.csv',
      content: 'Company,Phone\n"Acme","555"',
    });
    assert.equal(out.id, 'file-abc');
    assert.match(out.webViewLink, /drive\.google\.com/);
    assert.ok(calls.some((c) => c.url.includes('upload/drive')));
  });
});
