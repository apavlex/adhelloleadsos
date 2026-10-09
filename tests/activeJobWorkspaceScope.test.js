const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.APP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'active-job-ws-'));

const test = require('node:test');
const assert = require('node:assert/strict');
const dbService = require('../services/database');

test('active and finished jobs are hidden when viewing a different workspace', async () => {
  await dbService.setActiveJob({
    type: 'search',
    keyword: 'Interior Designers',
    city: 'Camas',
    state: 'WA',
    workspaceId: 'ws_a',
  });

  assert.equal((await dbService.getActiveJob('ws_a')).keyword, 'Interior Designers');
  assert.equal(await dbService.getActiveJob('ws_b'), null);
  // Queue / busy checks omit workspaceId and still see the global job.
  assert.equal((await dbService.getActiveJob()).workspaceId, 'ws_a');

  await dbService.clearActiveJob({ resultCount: 3, searchKey: 'search:1' });

  assert.equal((await dbService.getLatestFinishedJob('ws_a')).resultCount, 3);
  assert.equal(await dbService.getLatestFinishedJob('ws_b'), null);

  await dbService.markNotificationRead('ws_b');
  assert.equal((await dbService.getLatestFinishedJob('ws_a')).isRead, false);

  await dbService.markNotificationRead('ws_a');
  assert.equal((await dbService.getLatestFinishedJob('ws_a')).isRead, true);
});

test('legacy jobs without workspaceId still surface for every workspace filter', async () => {
  await dbService.setActiveJob({
    type: 'search',
    keyword: 'Roofers',
    city: 'Portland',
    state: 'OR',
  });
  assert.equal((await dbService.getActiveJob('ws_anywhere')).keyword, 'Roofers');
  await dbService.clearActiveJob({ failed: true, error: 'test cleanup' });
});
