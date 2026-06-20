const test = require('node:test');
const assert = require('node:assert/strict');
const {
  mergeTagLists,
  tagsToAdd,
  normalizeGhlLogSync,
  logFingerprint,
  formatLogAsNoteBody,
  isAgencyOsNoteBody,
  shouldPushLog,
  ghlNoteToLogEntry,
  parseGhlNotesResponse,
} = require('../services/ghlSyncHelpers');

test('mergeTagLists unions tags case-insensitively', () => {
  assert.deepEqual(mergeTagLists(['VIP', 'Lead'], ['lead', 'Newsletter']), ['VIP', 'Lead', 'Newsletter']);
  assert.deepEqual(mergeTagLists(['Hot Lead'], ['hot lead']), ['Hot Lead']);
});

test('tagsToAdd returns only tags missing on remote', () => {
  assert.deepEqual(tagsToAdd(['VIP'], ['VIP', 'New']), ['New']);
  assert.deepEqual(tagsToAdd(['vip'], ['VIP']), []);
});

test('shouldPushLog skips synced and internal logs', () => {
  const syncState = { pushedFingerprints: ['2024-01-01T00:00:00.000Z|call|Hello'] };
  assert.equal(
    shouldPushLog({ type: 'call', message: 'Hello', timestamp: '2024-01-01T00:00:00.000Z' }, syncState),
    false,
  );
  assert.equal(shouldPushLog({ type: 'merge', message: 'Merged' }, syncState), false);
  assert.equal(shouldPushLog({ type: 'call', message: 'New note', timestamp: '2024-01-02T00:00:00.000Z' }, syncState), true);
});

test('formatLogAsNoteBody prefixes Agency OS notes', () => {
  const body = formatLogAsNoteBody({ type: 'call', message: 'Left voicemail', timestamp: '2024-06-01T12:00:00.000Z' });
  assert.match(body, /^\[Agency OS\] call/);
  assert.match(body, /Left voicemail/);
  assert.equal(isAgencyOsNoteBody(body), true);
});

test('ghlNoteToLogEntry maps GHL notes to lead logs', () => {
  const log = ghlNoteToLogEntry({ id: 'n1', body: 'Spoke with owner', dateAdded: '2024-06-01T12:00:00.000Z' });
  assert.equal(log.type, 'ghl_note');
  assert.equal(log.ghlNoteId, 'n1');
  assert.equal(log.message, 'Spoke with owner');
});

test('parseGhlNotesResponse accepts common payload shapes', () => {
  assert.equal(parseGhlNotesResponse({ notes: [{ id: '1' }] }).length, 1);
  assert.equal(parseGhlNotesResponse({ data: [{ id: '2' }] }).length, 1);
});

test('normalizeGhlLogSync defaults empty arrays', () => {
  assert.deepEqual(normalizeGhlLogSync(null), { pushedFingerprints: [], pulledNoteIds: [] });
});

test('logFingerprint is stable for identical logs', () => {
  const a = logFingerprint({ type: 'sms', message: 'Sent', timestamp: '2024-01-01' });
  const b = logFingerprint({ type: 'sms', message: 'Sent', timestamp: '2024-01-01' });
  assert.equal(a, b);
});
