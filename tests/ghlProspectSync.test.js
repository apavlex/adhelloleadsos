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

  it('prepareLeadForGhlPush maps no_answer to AO: No answer', async () => {
    await patchLeadDispositionForGhlPush({
      leadKey: testKey,
      code: 'no_answer',
      notes: 'No pickup. Retry in next calling window.',
      workspaceId: 'default',
    });
    const lead = await dbService.getLead(testKey);
    const prepared = await prepareLeadForGhlPush(lead, 'default');
    assert.ok(prepared.ghlTagNamesForPush.includes(AO_ACTION_TAGS.NO_ANSWER));
  });

  it('ghlSync.pushLeads can prepare a lead after leads-first circular load', async () => {
    const cycle = [
      require.resolve('../services/ghlProspectSync'),
      require.resolve('../services/ghlSync'),
      require.resolve('../services/inboundReplyRules'),
    ];
    for (const id of cycle) delete require.cache[id];

    // Production boot order: routes/leads.js requires ghlProspectSync before routes/ghl.js loads ghlSync.
    require('../services/ghlProspectSync');
    const ghlSync = require('../services/ghlSync');
    assert.equal(typeof require('../services/ghlProspectSync').prepareLeadForGhlPush, 'function');

    const result = await ghlSync.pushLeads({
      workspaceId: 'default',
      leadKeys: [testKey],
      integrationEnv: {
        GHL_API_KEY: 'test-key',
        GHL_LOCATION_ID: 'test-location',
      },
    });
    assert.equal(result.total, 1);
    const err = result.results[0] && result.results[0].error;
    assert.equal(
      /prepareLeadForGhlPush is not a function/.test(String(err || '')),
      false,
      err || 'push succeeded',
    );
  });
});
