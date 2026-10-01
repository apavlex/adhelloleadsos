const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.APP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'search-interrupted-'));

const test = require('node:test');
const assert = require('node:assert/strict');
const dbService = require('../services/database');
const scrapeJobRunner = require('../services/scrapeJobRunner');
const workspaceIntegrations = require('../services/workspaceIntegrations');

async function searchesFor(wid) {
  return (await dbService.getAllSearches()).filter((s) => s.workspaceId === wid);
}

test('a failed search is kept in Search History with its error', async () => {
  await dbService.setActiveJob({ type: 'search', keyword: 'interior design', city: 'Camas', state: 'WA', maxResults: 20, workspaceId: 'ws_fail' });
  await dbService.clearActiveJob({ failed: true, error: 'No businesses found.' });

  const [record] = await searchesFor('ws_fail');
  assert.equal(record.status, 'failed');
  assert.equal(record.error, 'No businesses found.');
  assert.equal(record.keyword, 'interior design');
  assert.equal(record.resultCount, 0);
});

test('a search cut off by a restart runs again once at boot and saves its results', async (t) => {
  t.mock.method(workspaceIntegrations, 'getResolvedIntegrationEnv', async () => ({}));
  t.mock.method(scrapeJobRunner, 'isJobConfigured', () => true);
  t.mock.method(scrapeJobRunner, 'executeScrapeJob', async () => [{ name: 'Studio Nine Interiors' }]);

  await dbService.setActiveJob({
    type: 'search',
    keyword: 'interior design',
    city: 'Camas',
    state: 'WA',
    workspaceId: 'ws_resume',
    resume: { jobType: 'listings', keyword: 'interior design', city: 'Camas', state: 'WA', maxResults: 20, workspaceId: 'ws_resume' },
  });
  await dbService.failOrphanedActiveJob();
  assert.equal(dbService._readActiveJobRaw().resumeCount, 1);

  for (let i = 0; i < 50 && dbService._readActiveJobRaw(); i += 1) {
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.equal(dbService._readActiveJobRaw(), null);
  const [record] = await searchesFor('ws_resume');
  assert.equal(record.resumed, true);
  assert.equal(record.resultCount, 1);
  assert.equal((await dbService.getLatestFinishedJob()).status, 'completed');
});

test('a search interrupted twice is marked failed instead of looping', async () => {
  await dbService.setActiveJob({
    type: 'search',
    keyword: 'roofers',
    workspaceId: 'ws_twice',
    resumeCount: 1,
    resume: { keyword: 'roofers', workspaceId: 'ws_twice' },
  });
  await dbService.failOrphanedActiveJob();

  assert.equal(dbService._readActiveJobRaw(), null);
  const [record] = await searchesFor('ws_twice');
  assert.equal(record.status, 'failed');
  assert.match(record.error, /restarted/);
});
