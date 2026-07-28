const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const dbService = require('../services/database');
const {
  DIRECT_MAIL_FOLDER_NAME,
  DIRECT_MAIL_TAG_NAME,
  addLeadsToDirectMailQueue,
  listDirectMailQueueLeads,
  removeLeadsFromDirectMailQueue,
} = require('../services/directMailQueue');

describe('directMailQueue', () => {
  it('uses stable folder and tag names', () => {
    assert.equal(DIRECT_MAIL_FOLDER_NAME, 'Direct Mail');
    assert.equal(DIRECT_MAIL_TAG_NAME, 'Direct Mail List');
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

      const visibleAfter = await dbService.getAllLeads('default');
      const listed = await listDirectMailQueueLeads('default', visibleAfter);
      assert.ok(listed.leads.some((l) => l.key === leadKey));
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
