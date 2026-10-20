const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.APP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lead-dupe-merge-'));

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const dbService = require('../services/database');
const {
  findDuplicateGroups,
  pickPrimaryLead,
  mergeAllDuplicateGroups,
} = require('../services/leadDuplicateMerge');

describe('leadDuplicateMerge', () => {
  it('groups leads by domain and picks the fuller primary', () => {
    // computeDedupeKey prefers email over domain — keep both leads email-free so they share domain:.
    const groups = findDuplicateGroups([
      { key: 'lead:a', title: 'A', website: 'https://www.camas.com', phone: '' },
      { key: 'lead:b', title: 'B', website: 'http://camas.com/contact', phone: '3605550111', address: '1 Main St' },
      { key: 'lead:c', title: 'Other', website: 'https://other.example' },
    ]);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].matchedOn, 'domain');
    assert.equal(groups[0].leads.length, 2);
    const primary = pickPrimaryLead(groups[0].leads);
    assert.equal(primary.key, 'lead:b');
  });

  it('mergeAllDuplicateGroups folds duplicates into one lead', async () => {
    const wid = 'ws_dupe_merge_1';
    await dbService.saveWorkspace(wid, {
      id: wid,
      name: 'Dupe merge',
      ownerUserId: 'owner@example.com',
      isDemo: true,
      members: { 'owner@example.com': { role: 'owner' } },
    });
    // Create as distinct identities first, then align websites so findDuplicateGroups sees them.
    // (saveLeadWithMeta / saveLead would auto-merge same-domain ingest.)
    const aKey = await dbService.saveLead({
      workspaceId: wid,
      title: 'Camas Plumbing',
      website: 'https://unique-a-test.example',
      phone: '3605550111',
    });
    const bKey = await dbService.saveLead({
      workspaceId: wid,
      title: 'Riverside Pipes',
      website: 'https://unique-b-test.example',
      phone: '3605550199',
    });
    await dbService.saveLead({
      workspaceId: wid,
      title: 'Other Co',
      website: 'https://other.example',
    });
    await dbService.updateLead(
      aKey,
      { website: 'https://camasplumbing.com', dedupeKey: 'domain:camasplumbing.com' },
      wid,
    );
    await dbService.updateLead(
      bKey,
      { website: 'http://www.camasplumbing.com/contact', dedupeKey: 'domain:camasplumbing.com' },
      wid,
    );

    const leads = await dbService.getAllLeads(wid);
    const result = await mergeAllDuplicateGroups({
      dbService,
      workspaceId: wid,
      leads,
      limit: 20,
    });
    assert.equal(result.groupsFound, 1);
    assert.equal(result.groupsMerged, 1);
    assert.equal(result.leadsMergedAway, 1);
    const remaining = await dbService.getAllLeads(wid);
    assert.equal(remaining.length, 2);
    assert.ok(remaining.some((l) => l.key === aKey || l.key === bKey));
  });
});
