const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  mergeSecondaryIntoPrimary,
  snapshotLocation,
  mergeLocationLists,
  mergeLeadsByKeys,
} = require('../services/leadMerge');
const db = require('../services/database');

describe('leadMerge', () => {
  it('keeps primary title and stores secondary as a location', () => {
    const primary = {
      key: 'lead:1',
      title: 'Diamond Cleaning Company LLC',
      address: '123 Main St',
      city: 'Austin',
      state: 'TX',
      phone: '(512) 555-0100',
      tags: ['tag:a'],
    };
    const secondary = {
      key: 'lead:2',
      title: 'DiamondShineBee cleaning',
      address: '456 Oak Ave',
      city: 'Austin',
      state: 'TX',
      phone: '(512) 555-0199',
      tags: ['tag:b'],
      updates: [{ type: 'note', value: 'Second location callback' }],
    };
    const merged = mergeSecondaryIntoPrimary(primary, secondary, 'lead:2');
    assert.equal(merged.title, 'Diamond Cleaning Company LLC');
    assert.deepEqual(merged.tags, ['tag:a', 'tag:b']);
    assert.equal(merged.updates.length, 1);
    assert.equal(merged.leadLocations.length, 1);
    assert.equal(merged.leadLocations[0].title, 'DiamondShineBee cleaning');
    assert.ok(merged.alternateTitles.includes('DiamondShineBee cleaning'));
    assert.ok(merged.logs.some((l) => l.type === 'merge'));
  });

  it('fills blank primary fields from secondary', () => {
    const primary = { key: 'lead:1', title: 'Acme Co' };
    const secondary = {
      key: 'lead:2',
      title: 'Acme Company',
      email: 'info@acme.com',
      website: 'https://acme.com',
    };
    const merged = mergeSecondaryIntoPrimary(primary, secondary, 'lead:2');
    assert.equal(merged.email, 'info@acme.com');
    assert.equal(merged.website, 'https://acme.com');
  });

  it('dedupes locations by address and phone', () => {
    const a = snapshotLocation(
      { title: 'A', address: '1 St', city: 'X', state: 'TX', phone: '5125550100' },
      'lead:1',
    );
    const b = snapshotLocation(
      { title: 'A', address: '1 St', city: 'X', state: 'TX', phone: '5125550100' },
      'lead:2',
    );
    const merged = mergeLocationLists([], [], [a, b]);
    assert.equal(merged.length, 1);
  });

  it('mergeLeadsByKeys combines leads and deletes secondaries', async () => {
    const ws = 'merge-test-ws';
    const ka = await db.saveLead({ title: 'Primary Co', workspaceId: ws, city: 'Austin', state: 'TX' });
    const kb = await db.saveLead({ title: 'Secondary Co', workspaceId: ws, city: 'Dallas', state: 'TX' });
    const result = await mergeLeadsByKeys({
      dbService: db,
      workspaceId: ws,
      keys: [ka, kb],
      primaryKey: ka.replace(/^lead:/i, ''),
    });
    assert.equal(result.success, true);
    assert.equal(result.mergedCount, 1);
    const remaining = await db.getAllLeads(ws);
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].title, 'Primary Co');
    assert.ok(Array.isArray(remaining[0].leadLocations));
  });
});
