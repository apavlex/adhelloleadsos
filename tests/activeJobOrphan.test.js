const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.APP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'active-job-'));

const test = require('node:test');
const assert = require('node:assert/strict');
const dbService = require('../services/database');

test('a search left running by a restart is failed at boot with a clear reason', async () => {
  assert.equal(await dbService.failOrphanedActiveJob(), null);

  await dbService.setActiveJob({ type: 'search', keyword: 'Interior Designers', city: 'Camas', state: 'WA' });
  const orphan = await dbService.failOrphanedActiveJob();
  assert.equal(orphan.keyword, 'Interior Designers');
  assert.equal(await dbService.getActiveJob(), null);

  const finished = await dbService.getLatestFinishedJob();
  assert.equal(finished.status, 'failed');
  assert.equal(finished.keyword, 'Interior Designers');
  assert.match(finished.error, /restarted for an update/);
});
