const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  buildSharedLeadPayload,
  STRIP_KEYS,
  shareLeadsToWorkspaces,
} = require('../services/leadWorkspaceShare');

describe('leadWorkspaceShare', () => {
  it('buildSharedLeadPayload strips workspace-local fields and tags sharedFrom', () => {
    const payload = buildSharedLeadPayload(
      {
        key: 'lead:abc',
        workspaceId: 'ws-source',
        title: 'Brenda Rojas - Manor Realty',
        phone: '360-555-0100',
        email: 'brenda@manor.test',
        website: 'https://www.zillow.com/homedetails/x',
        folderKey: 'folder-source',
        stageId: 'stage-1',
        assignedTo: 'sdr@adhello.io',
        tags: ['tag:ws:hot'],
        ghlContactId: 'ghl-1',
        contacts: [{ name: 'Brenda Rojas', email: 'brenda@manor.test', phone: '360-555-0100', primary: true }],
        source: 'chrome_extension',
      },
      {
        sourceWid: 'ws-source',
        sourceName: 'AdHello',
        targetWid: 'ws-homeelk',
        by: 'owner@adhello.io',
        at: '2026-11-18T20:00:00.000Z',
      },
    );
    assert.equal(payload.workspaceId, 'ws-homeelk');
    assert.equal(payload.title, 'Brenda Rojas - Manor Realty');
    assert.equal(payload.email, 'brenda@manor.test');
    assert.equal(payload.key, undefined);
    assert.equal(payload.folderKey, undefined);
    assert.equal(payload.stageId, undefined);
    assert.equal(payload.assignedTo, undefined);
    assert.equal(payload.tags, undefined);
    assert.equal(payload.ghlContactId, undefined);
    assert.equal(payload.sharedFrom.workspaceId, 'ws-source');
    assert.equal(payload.sharedFrom.workspaceName, 'AdHello');
    assert.ok(STRIP_KEYS.has('ghlContactId'));
  });

  it('buildSharedLeadPayload can file into a target folder', () => {
    const payload = buildSharedLeadPayload(
      { title: 'Acme', phone: '555' },
      {
        sourceWid: 'a',
        sourceName: 'A',
        targetWid: 'b',
        by: 'u@x.com',
        at: '2026-11-18T20:00:00.000Z',
        folderKey: 'folder-target',
      },
    );
    assert.equal(payload.folderKey, 'folder-target');
    assert.equal(payload.forceFolderKey, true);
  });

  it('shareLeadsToWorkspaces requires manage access and leads', async () => {
    const deny = await shareLeadsToWorkspaces({
      email: 'nobody@example.com',
      sourceWid: 'missing-ws',
      leadKeys: ['lead:x'],
      targetIds: ['other'],
    });
    assert.equal(deny.ok, false);
    assert.match(deny.error, /Manage permission|required/i);
  });
});
