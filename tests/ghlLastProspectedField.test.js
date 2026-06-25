const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  todayDateValue,
  findFieldInList,
  FIELD_NAME,
  FIELD_KEY,
} = require('../services/ghlLastProspectedField');
const { syncedDateTagFor, isSyncedDateTag } = require('../services/ghlClient');

describe('ghlLastProspectedField', () => {
  it('todayDateValue returns YYYY-MM-DD', () => {
    assert.equal(todayDateValue(new Date('2026-06-25T20:00:00.000Z')), '2026-06-25');
  });

  it('findFieldInList matches by fieldKey or name', () => {
    const fields = [
      { id: 'cf1', name: 'Budget', fieldKey: 'contact.budget' },
      { id: 'cf2', name: FIELD_NAME, fieldKey: 'contact.other' },
    ];
    assert.equal(findFieldInList(fields).id, 'cf2');
    assert.equal(
      findFieldInList([{ id: 'cf3', name: 'Other', fieldKey: FIELD_KEY }]).id,
      'cf3',
    );
  });
});

describe('ghlClient synced date tags', () => {
  it('syncedDateTagFor uses ISO date', () => {
    assert.equal(syncedDateTagFor(new Date('2026-06-25T12:00:00.000Z')), 'AO: Synced 2026-06-25');
  });

  it('isSyncedDateTag recognizes AO synced tags', () => {
    assert.equal(isSyncedDateTag('AO: Synced 2026-06-25'), true);
    assert.equal(isSyncedDateTag('AO: Prospected'), false);
  });
});
