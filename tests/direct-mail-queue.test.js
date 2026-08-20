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
    let workspaceId = 'default';

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
      const saved = await dbService.getLead(leadKey);
      workspaceId = (saved && saved.workspaceId) || 'default';
    });

    afterEach(async () => {
      if (leadKey) await dbService.deleteLead(leadKey);
      leadKey = '';
    });

    it('adds a lead to the Direct Mail folder and lists it', async () => {
      const visible = await dbService.getAllLeads(workspaceId);
      const queued = await addLeadsToDirectMailQueue(workspaceId, [leadKey], visible);
      assert.equal(queued.added, 1);
      assert.equal(queued.leads.length, 1);
      assert.equal(queued.leads[0].key, leadKey);
      assert.equal(queued.leads[0].categoryName, 'Uncategorized');
      assert.match(String(queued.leads[0].queuedDay || ''), /^\d{4}-\d{2}-\d{2}$/);
      assert.ok(queued.leads[0].addedAt);

      const visibleAfter = await dbService.getAllLeads(workspaceId);
      const listed = await listDirectMailQueueLeads(workspaceId, visibleAfter);
      const hit = listed.leads.find((l) => l.key === leadKey);
      assert.ok(hit);
      assert.equal(hit.categoryName, 'Uncategorized');
      assert.match(String(hit.queuedDay || ''), /^\d{4}-\d{2}-\d{2}$/);
    });

    it('removes a lead from the Direct Mail queue', async () => {
      const visible = await dbService.getAllLeads(workspaceId);
      await addLeadsToDirectMailQueue(workspaceId, [leadKey], visible);
      const visibleAfterAdd = await dbService.getAllLeads(workspaceId);
      const removed = await removeLeadsFromDirectMailQueue(workspaceId, [leadKey], visibleAfterAdd);
      assert.equal(removed.removed, 1);
      const listed = await listDirectMailQueueLeads(workspaceId, await dbService.getAllLeads(workspaceId));
      assert.equal(listed.leads.some((l) => l.key === leadKey), false);
    });

    it('skips Closed-Won when queueing from auto-outreach helper', async () => {
      const { queueLeadForDirectMailIfEligible, isClosedWonOrLostStatus } = require('../services/directMailQueue');
      assert.equal(isClosedWonOrLostStatus({ status: 'Closed - Won' }), true);
      const closedKey = await dbService.saveLead({
        title: 'Closed DM Skip',
        workspaceId: 'default',
        status: 'Closed - Lost',
        source: 'test',
      });
      try {
        const lead = await dbService.getLead(closedKey);
        const r = await queueLeadForDirectMailIfEligible(lead.workspaceId || workspaceId, lead);
        assert.equal(r.queued, false);
        assert.equal(r.reason, 'closed');
      } finally {
        await dbService.deleteLead(closedKey);
      }
    });
  });
});
