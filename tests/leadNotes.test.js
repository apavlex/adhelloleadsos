const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isDeletableLeadNote,
  removeLeadNoteFromLead,
  findDeletableLeadNote,
} = require('../services/leadNotes');

test('isDeletableLeadNote allows panel notes only', () => {
  assert.equal(
    isDeletableLeadNote({
      type: 'note',
      value: 'Hello',
      source: 'panel_post',
      timestamp: '2026-06-27T22:12:00.000Z',
    }),
    true,
  );
  assert.equal(
    isDeletableLeadNote({
      type: 'quick_log',
      value: 'Left VM',
      source: 'quick_log_pill',
      timestamp: '2026-06-27T22:12:00.000Z',
    }),
    false,
  );
});

test('findDeletableLeadNote matches panel note by value when timestamp differs within a second', () => {
  const lead = {
    updates: [
      {
        type: 'note',
        value: 'hello',
        timestamp: '2026-06-27T22:12:00.456Z',
        source: 'panel_post',
      },
    ],
    logs: [],
  };
  const match = { timestamp: '2026-06-27T22:12:00.123Z', value: 'hello' };
  assert.ok(findDeletableLeadNote(lead, match));
  const { updates } = removeLeadNoteFromLead(lead, match);
  assert.equal(updates.length, 0);
});

test('findDeletableLeadNote matches unique panel note by value alone', () => {
  const lead = {
    updates: [
      {
        type: 'note',
        value: 'only note',
        timestamp: '2026-06-27T22:12:00.000Z',
        source: 'panel_post',
      },
    ],
    logs: [],
  };
  const match = { timestamp: '2026-06-27T22:12:05.000Z', value: 'only note' };
  assert.ok(findDeletableLeadNote(lead, match));
  const { updates } = removeLeadNoteFromLead(lead, match);
  assert.equal(updates.length, 0);
});

test('removeLeadNoteFromLead removes matching update and log', () => {
  const lead = {
    updates: [
      { type: 'note', value: 'Keep', timestamp: '2026-06-27T22:10:00.000Z', source: 'panel_post' },
      { type: 'note', value: 'Delete me', timestamp: '2026-06-27T22:12:00.000Z', source: 'panel_post' },
    ],
    logs: [
      { type: 'note', message: 'Delete me', timestamp: '2026-06-27T22:12:00.000Z' },
      { type: 'call', message: 'Dialed', timestamp: '2026-06-27T22:11:00.000Z' },
    ],
  };
  const match = { timestamp: '2026-06-27T22:12:00.000Z', value: 'Delete me' };
  assert.ok(findDeletableLeadNote(lead, match));
  const { updates, logs } = removeLeadNoteFromLead(lead, match);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].value, 'Keep');
  assert.equal(logs.length, 1);
  assert.equal(logs[0].type, 'call');
});
