/** Helpers for lead panel notes stored on lead.updates / lead.logs */

function noteEntryBody(entry) {
  if (!entry || typeof entry !== 'object') return '';
  return String(entry.value ?? entry.content ?? entry.message ?? '').trim();
}

function isDeletableLeadNote(entry) {
  if (!entry || typeof entry !== 'object') return false;
  if (String(entry.type || '') !== 'note') return false;
  if (entry.source === 'quick_log_pill') return false;
  if (entry.disposition || entry.statusChange) return false;
  return noteEntryBody(entry).length > 0;
}

function leadNoteMatches(entry, match) {
  if (!isDeletableLeadNote(entry)) return false;
  const ts = String((match && match.timestamp) || '').trim();
  const val = String((match && match.value) || '').trim();
  if (!ts) return false;
  if (String(entry.timestamp || entry.ts || '') !== ts) return false;
  if (val && noteEntryBody(entry) !== val) return false;
  return true;
}

function leadNoteLogMatches(log, match) {
  if (!log || typeof log !== 'object') return false;
  if (String(log.type || '') !== 'note') return false;
  const ts = String((match && match.timestamp) || '').trim();
  const val = String((match && match.value) || '').trim();
  if (!ts) return false;
  if (String(log.timestamp || '') !== ts) return false;
  if (val && String(log.message || '').trim() !== val) return false;
  return true;
}

function removeLeadNoteFromLead(lead, match) {
  const updates = (Array.isArray(lead && lead.updates) ? lead.updates : []).filter(
    (u) => !leadNoteMatches(u, match),
  );
  const logs = (Array.isArray(lead && lead.logs) ? lead.logs : []).filter(
    (log) => !leadNoteLogMatches(log, match),
  );
  return { updates, logs };
}

function findDeletableLeadNote(lead, match) {
  return (Array.isArray(lead && lead.updates) ? lead.updates : []).find((u) =>
    leadNoteMatches(u, match),
  );
}

module.exports = {
  noteEntryBody,
  isDeletableLeadNote,
  leadNoteMatches,
  leadNoteLogMatches,
  removeLeadNoteFromLead,
  findDeletableLeadNote,
};
