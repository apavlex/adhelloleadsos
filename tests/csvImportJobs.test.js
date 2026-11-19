const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const csvImportJobs = require('../services/csvImportJobs');

describe('csvImportJobs', () => {
  beforeEach(() => {
    csvImportJobs._jobsForTests.clear();
  });

  it('creates a job and reports public progress fields', () => {
    const job = csvImportJobs.createJob({
      workspaceId: 'ws1',
      fileName: 'TX - December cleaned.csv',
      source: 'csv',
    });
    assert.ok(job.id);
    csvImportJobs.touch(job, {
      status: 'importing',
      processed: 45,
      total: 100,
      created: 40,
      updated: 5,
    });
    const pub = csvImportJobs.publicJob(job);
    assert.equal(pub.percent, 45);
    assert.equal(pub.imported, 45);
    assert.equal(pub.fileName, 'TX - December cleaned.csv');
  });

  it('caps percent at 100 when done', () => {
    const job = csvImportJobs.createJob({ workspaceId: 'ws1', fileName: 'a.csv' });
    csvImportJobs.touch(job, { status: 'done', processed: 10, total: 10 });
    assert.equal(job.percent, 100);
  });

  it('scopes getJob lookups', () => {
    const job = csvImportJobs.createJob({ workspaceId: 'ws1', fileName: 'a.csv' });
    assert.equal(csvImportJobs.getJob(job.id), job);
    assert.equal(csvImportJobs.getJob('missing'), null);
  });
});
