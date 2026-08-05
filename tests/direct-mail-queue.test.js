const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const dbService = require('../services/database');
const {
  DIRECT_MAIL_FOLDER_NAME,
  DIRECT_MAIL_TAG_NAME,
  addLeadsToDirectMailQueue,
  listDirectMailQueueLeads,
  removeLeadsFromDirectMailQueue,
  queuedDayFromTimestamp,
  normalizeCategoryName,
} = require('../services/directMailQueue');

describe('directMailQueue', () => {
  it('uses stable folder and tag names', () => {
    assert.equal(DIRECT_MAIL_FOLDER_NAME, 'Direct Mail');
    assert.equal(DIRECT_MAIL_TAG_NAME, 'Direct Mail List');
  });

  it('normalizes category names for queue display', () => {
    assert.equal(normalizeCategoryName(''), 'Uncategorized');
    assert.equal(normalizeCategoryName('N/A'), 'Uncategorized');
    assert.equal(normalizeCategoryName('  Plumber  '), 'Plumber');
  });

  it('derives queuedDay from ISO timestamps', () => {
    assert.equal(queuedDayFromTimestamp('2026-08-05T15:30:00.000Z'), '2026-08-05');
    assert.equal(queuedDayFromTimestamp(''), '');
    assert.equal(queuedDayFromTimestamp('not-a-date'), 'not-a-date');
  });

  describe('queue persistence', () => {
    let leadKey = '';

    beforeEach(async () => {
      leadKey = await dbService.saveLead({
        title: 'Direct Mail Queue Test Co',
        workspaceId: 'default',
        status: 'Not Contacted',
        pipelineStage: 1,
        phone: '+15555550201',
        address: '123 Main St',
        city: 'Portland',
        state: 'OR',
        source: 'test',
      });
    });

    afterEach(async () => {
      if (leadKey) await dbService.deleteLead(leadKey);
      leadKey = '';
    });

    it('adds a lead to the Direct Mail folder and lists it', async () => {
      const visible = await dbService.getAllLeads('default');
      const queued = await addLeadsToDirectMailQueue('default', [leadKey], visible);
      assert.equal(queued.added, 1);
      assert.equal(queued.leads.length, 1);
      assert.equal(queued.leads[0].key, leadKey);
      assert.equal(queued.leads[0].categoryName, 'Uncategorized');
      assert.match(String(queued.leads[0].queuedDay || ''), /^\d{4}-\d{2}-\d{2}$/);
      assert.ok(queued.leads[0].addedAt);

      const visibleAfter = await dbService.getAllLeads('default');
      const listed = await listDirectMailQueueLeads('default', visibleAfter);
      const hit = listed.leads.find((l) => l.key === leadKey);
      assert.ok(hit);
      assert.equal(hit.categoryName, 'Uncategorized');
      assert.match(String(hit.queuedDay || ''), /^\d{4}-\d{2}-\d{2}$/);
    });

    it('removes a lead from the Direct Mail queue', async () => {
      const visible = await dbService.getAllLeads('default');
      await addLeadsToDirectMailQueue('default', [leadKey], visible);
      const visibleAfterAdd = await dbService.getAllLeads('default');
      const removed = await removeLeadsFromDirectMailQueue('default', [leadKey], visibleAfterAdd);
      assert.equal(removed.removed, 1);
      const listed = await listDirectMailQueueLeads('default', visibleAfterAdd);
      assert.equal(listed.leads.some((l) => l.key === leadKey), false);
    });
  });
});
