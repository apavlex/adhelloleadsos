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

test('classifyLeadForPipelineMigration defaults unfiled search leads to maps', () => {
  const { classifyLeadForPipelineMigration } = require('../services/pipelineFolders');
  assert.equal(
    classifyLeadForPipelineMigration({ title: 'Peninsula Electric', reviewsCount: 12 }),
    'maps_business'
  );
  assert.equal(classifyLeadForPipelineMigration({ source: 'adhello_form' }), null);
  assert.equal(classifyLeadForPipelineMigration({ source: 'manual_offline' }), null);
  assert.equal(
    classifyLeadForPipelineMigration({ listing: { price: 32000 }, folderKey: '' }),
    'mobile_homes'
  );
});

test('migrateUnfiledLeadsToPipelineFolders assigns folder and metadata', async () => {
  const updates = [];
  const mockDb = {
    listFolders: async () => [
      { key: 'folder:maps', name: 'Businesses (Maps)', jobType: 'maps_business', isPipelineDefault: true },
      { key: 'folder:mh', name: 'Mobile homes', jobType: 'mobile_homes', isPipelineDefault: true },
    ],
    getWorkspace: async () => ({ id: 'ws1', members: {} }),
    createFolder: async (wid, name, meta) => ({ key: `folder:${meta.jobType}`, name, ...meta }),
    updateLead: async (key, patch) => {
      updates.push({ key, patch });
      return { key, ...patch };
    },
  };

  const orig = require('../services/database');
  require.cache[require.resolve('../services/database')].exports = mockDb;
  delete require.cache[require.resolve('../services/pipelineFolders')];
  const { migrateUnfiledLeadsToPipelineFolders: migrateFresh } = require('../services/pipelineFolders');

  const stats = await migrateFresh('ws1', [
    { key: 'lead:1', title: 'Electric Co', reviewsCount: 5 },
    { key: 'lead:2', title: 'MH deal', listing: { price: 40000 } },
    { key: 'lead:3', title: 'Warm', source: 'adhello_form' },
  ]);

  assert.equal(stats.total, 2);
  assert.equal(stats.maps_business, 1);
  assert.equal(stats.mobile_homes, 1);
  assert.equal(stats.skipped, 1);
  assert.equal(updates[0].patch.folderKey, 'folder:maps');
  assert.equal(updates[0].patch.jobType, 'maps_business');

  require.cache[require.resolve('../services/database')].exports = orig;
  delete require.cache[require.resolve('../services/pipelineFolders')];
});

test('resolveTargetFolder auto-picks default pipeline folder', async () => {
  const created = [];
  const mockDb = {
    listFolders: async () => [
      { key: 'folder:maps', name: 'Businesses (Maps)', jobType: 'maps_business', isPipelineDefault: true },
    ],
    getWorkspace: async () => ({ id: 'ws1', members: {} }),
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

test('deleteFolderComplete hides default pipeline folder from auto-recreate', async () => {
  let workspace = { id: 'ws1', members: {} };
  const mockDb = {
    getFolder: async (wid, key) =>
      key === 'folder:re'
        ? { key: 'folder:re', name: 'Real estate', jobType: 'real_estate', isPipelineDefault: true }
        : null,
    unassignLeadsFromFolder: async () => 3,
    deleteFolder: async () => {},
    getWorkspace: async () => workspace,
    saveWorkspace: async (wid, ws) => {
      workspace = ws;
    },
    listFolders: async () => [],
    createFolder: async () => ({}),
  };

  const orig = require('../services/database');
  require.cache[require.resolve('../services/database')].exports = mockDb;
  delete require.cache[require.resolve('../services/pipelineFolders')];
  const { deleteFolderComplete: deleteFresh, ensurePipelineFolders: ensureFresh } = require('../services/pipelineFolders');

  const result = await deleteFresh('ws1', 'folder:re');
  assert.equal(result.deleted, true);
  assert.equal(result.unassigned, 3);
  assert.equal(result.wasPipelineDefault, true);

  const folders = await ensureFresh('ws1');
  assert.equal(folders.length, 2);
  assert.ok(!folders.some((f) => f.jobType === 'real_estate'));

  require.cache[require.resolve('../services/database')].exports = orig;
  delete require.cache[require.resolve('../services/pipelineFolders')];
});

test('ensurePipelineFolders skips hidden default job types', async () => {
  const mockDb = {
    listFolders: async () => [],
    getWorkspace: async () => ({
      id: 'ws1',
      pipelineSettings: { hiddenDefaultFolders: ['real_estate'] },
    }),
    createFolder: async (wid, name, meta) => ({ key: `folder:${meta.jobType}`, name, ...meta }),
  };

  const orig = require('../services/database');
  require.cache[require.resolve('../services/database')].exports = mockDb;
  delete require.cache[require.resolve('../services/pipelineFolders')];
  const { ensurePipelineFolders: ensureFresh } = require('../services/pipelineFolders');

  const folders = await ensureFresh('ws1');
  const names = folders.map((f) => f.name).sort();
  assert.deepEqual(names, ['Businesses (Maps)', 'Mobile homes']);

  require.cache[require.resolve('../services/database')].exports = orig;
  delete require.cache[require.resolve('../services/pipelineFolders')];
});
