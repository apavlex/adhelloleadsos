const test = require('node:test');
const assert = require('node:assert/strict');
const { JOB_TYPES } = require('../services/scrapeJobTypes');
const {
  resolveTargetFolder,
  leadMetadataForJobType,
  findFolderForJobType,
} = require('../services/pipelineFolders');

test('leadMetadataForJobType tags mobile home saves', () => {
  const meta = leadMetadataForJobType(JOB_TYPES.MOBILE_HOMES);
  assert.equal(meta.jobType, 'mobile_homes');
  assert.equal(meta.sourceType, 'mobile_home_listing');
  assert.equal(meta.source, 'mobile_homes_search');
});

test('findFolderForJobType matches jobType field on folder', () => {
  const folders = [
    { key: 'folder:1', name: 'Mobile homes', jobType: 'mobile_homes' },
    { key: 'folder:2', name: 'Other', jobType: '' },
  ];
  const hit = findFolderForJobType(folders, JOB_TYPES.MOBILE_HOMES);
  assert.equal(hit.key, 'folder:1');
});

test('resolveTargetFolder auto-picks default pipeline folder', async () => {
  const created = [];
  const mockDb = {
    listFolders: async () => [
      { key: 'folder:maps', name: 'Businesses (Maps)', jobType: 'maps_business', isPipelineDefault: true },
    ],
    createFolder: async (wid, name, meta) => {
      const row = { key: `folder:${name}`, name, ...meta };
      created.push(row);
      return row;
    },
  };

  const orig = require('../services/database');
  require.cache[require.resolve('../services/database')].exports = mockDb;
  delete require.cache[require.resolve('../services/pipelineFolders')];
  const { resolveTargetFolder: resolveFresh } = require('../services/pipelineFolders');

  const out = await resolveFresh('ws1', { jobType: JOB_TYPES.MAPS_BUSINESS });
  assert.equal(out.targetFolderKey, 'folder:maps');
  assert.equal(out.targetFolderName, 'Businesses (Maps)');

  require.cache[require.resolve('../services/database')].exports = orig;
  delete require.cache[require.resolve('../services/pipelineFolders')];
});
