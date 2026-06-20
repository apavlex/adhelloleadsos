/**
 * Shared helpers for GHL sync — tag union merge and note ↔ log mapping.
 */

const AGENCY_OS_NOTE_PREFIX = '[Agency OS]';

const SKIP_LOG_TYPES = new Set(['merge', 'ghl_note']);

function tagKey(tag) {
  return String(tag || '').trim().toLowerCase();
}

/** Union tags; preserve first-seen casing; case-insensitive dedupe. */
function mergeTagLists(...lists) {
  const out = [];
  const seen = new Set();
  lists.forEach((list) => {
    (Array.isArray(list) ? list : []).forEach((tag) => {
      const raw = String(tag || '').trim();
      if (!raw) return;
      const key = tagKey(raw);
      if (seen.has(key)) return;
      seen.add(key);
      out.push(raw);
    });
  });
  return out;
}

function tagsToAdd(remoteTags, localTags) {
  const remote = Array.isArray(remoteTags) ? remoteTags : [];
  const local = Array.isArray(localTags) ? localTags : [];
  const remoteKeys = new Set(remote.map(tagKey));
  return local.filter((t) => {
    const raw = String(t || '').trim();
    return raw && !remoteKeys.has(tagKey(raw));
  });
}

function normalizeGhlLogSync(lead) {
  const raw = lead && lead.ghlLogSync && typeof lead.ghlLogSync === 'object' ? lead.ghlLogSync : {};
  return {
    pushedFingerprints: Array.isArray(raw.pushedFingerprints)
      ? raw.pushedFingerprints.map(String)
      : [],
    pulledNoteIds: Array.isArray(raw.pulledNoteIds) ? raw.pulledNoteIds.map(String) : [],
  };
}

function logFingerprint(log) {
  if (!log || typeof log !== 'object') return '';
  const ts = String(log.timestamp || '').trim();
  const type = String(log.type || '').trim();
  const message = String(log.message || log.value || '').trim();
  if (!message) return '';
  return `${ts}|${type}|${message}`;
}

function formatLogAsNoteBody(log) {
  const type = String(log.type || 'activity').trim();
  const message = String(log.message || log.value || '').trim();
  const ts = log.timestamp ? new Date(log.timestamp).toISOString() : '';
  const lines = [`${AGENCY_OS_NOTE_PREFIX} ${type}`];
  if (message) lines.push(message);
  if (ts && !Number.isNaN(Date.parse(ts))) lines.push(`Logged: ${ts}`);
  return lines.join('\n');
}

function isAgencyOsNoteBody(body) {
  return String(body || '').trim().startsWith(AGENCY_OS_NOTE_PREFIX);
}

function shouldPushLog(log, syncState) {
  if (!log || typeof log !== 'object') return false;
  if (log.ghlNoteId) return false;
  const type = String(log.type || '').trim();
  if (SKIP_LOG_TYPES.has(type)) return false;
  const message = String(log.message || log.value || '').trim();
  if (!message) return false;
  const fp = logFingerprint(log);
  if (!fp) return false;
  if (syncState.pushedFingerprints.includes(fp)) return false;
  return true;
}

function noteTimestamp(note) {
  const raw = note && (note.dateAdded || note.createdAt || note.updatedAt);
  const ts = Date.parse(raw || '');
  return Number.isFinite(ts) ? new Date(ts).toISOString() : new Date().toISOString();
}

function ghlNoteToLogEntry(note) {
  const id = String((note && note.id) || '').trim();
  const body = String((note && note.body) || '').trim();
  if (!id || !body) return null;
  return {
    type: 'ghl_note',
    message: body,
    timestamp: noteTimestamp(note),
    ghlNoteId: id,
    source: 'ghl_sync',
  };
}

function parseGhlNotesResponse(data) {
  if (!data || typeof data !== 'object') return [];
  if (Array.isArray(data.notes)) return data.notes;
  if (Array.isArray(data.data)) return data.data;
  if (Array.isArray(data)) return data;
  return [];
}

module.exports = {
  AGENCY_OS_NOTE_PREFIX,
  mergeTagLists,
  tagsToAdd,
  normalizeGhlLogSync,
  logFingerprint,
  formatLogAsNoteBody,
  isAgencyOsNoteBody,
  shouldPushLog,
  ghlNoteToLogEntry,
  parseGhlNotesResponse,
};
