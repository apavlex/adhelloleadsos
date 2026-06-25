const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const dbService = require('../services/database');
const { prepareLeadForGhlPush, patchLeadDispositionForGhlPush } = require('../services/ghlProspectSync');
const { AO_ACTION_TAGS } = require('../services/ghlActionTags');

describe('ghlProspectSync', () => {
  let testKey = '';

  beforeEach(async () => {
    testKey = await dbService.saveLead({
      title: 'GHL Sync Test Co',
      workspaceId: 'default',
      status: 'Not Contacted',
      pipelineStage: 1,
      tags: [],
      phone: '+15555550199',
      source: 'test',
    });
  });

  afterEach(async () => {
    if (testKey) await dbService.deleteLead(testKey);
    testKey = '';
  });

  it('patchLeadDispositionForGhlPush stores lastDisposition for quick log codes', async () => {
    const result = await patchLeadDispositionForGhlPush({
      leadKey: testKey,
      code: 'voicemail',
      notes: 'Left VM with callback number.',
      workspaceId: 'default',
    });
    assert.equal(result.ok, true);
    const lead = await dbService.getLead(testKey);
    assert.equal(lead.lastDisposition, 'voicemail');
    assert.equal(lead.lastDispositionNotes, 'Left VM with callback number.');
  });

  it('prepareLeadForGhlPush includes AO action tags from lastDisposition', async () => {
    await patchLeadDispositionForGhlPush({
      leadKey: testKey,
      code: 'voicemail',
      workspaceId: 'default',
    });
    const lead = await dbService.getLead(testKey);
    const prepared = await prepareLeadForGhlPush(lead, 'default');
    assert.ok(Array.isArray(prepared.ghlTagNamesForPush));
    assert.ok(prepared.ghlTagNamesForPush.includes(AO_ACTION_TAGS.VOICEMAIL));
  });
});
