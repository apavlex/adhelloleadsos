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

function noteTimestampsMatch(stored, requested) {
  const a = String(stored || '').trim();
  const b = String(requested || '').trim();
  if (!a || !b) return false;
  if (a === b) return true;
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (Number.isFinite(ta) && Number.isFinite(tb)) {
    return Math.floor(ta / 1000) === Math.floor(tb / 1000);
  }
  return false;
}

function leadNoteMatches(entry, match) {
  if (!isDeletableLeadNote(entry)) return false;
  const ts = String((match && match.timestamp) || '').trim();
  const val = String((match && match.value) || '').trim();
  if (!ts) return false;
  if (!noteTimestampsMatch(entry.timestamp || entry.ts || '', ts)) return false;
  if (val && noteEntryBody(entry) !== val) return false;
  return true;
}

function leadNoteLogMatches(log, match) {
  if (!log || typeof log !== 'object') return false;
  if (String(log.type || '') !== 'note') return false;
  const ts = String((match && match.timestamp) || '').trim();
  const val = String((match && match.value) || '').trim();
  if (!ts) return false;
  if (!noteTimestampsMatch(log.timestamp || '', ts)) return false;
  if (val && String(log.message || '').trim() !== val) return false;
  return true;
}

function removeLeadNoteFromLead(lead, match) {
  const target = findDeletableLeadNote(lead, match);
  const resolvedMatch = target
    ? {
        timestamp: String(target.timestamp || target.ts || match.timestamp || ''),
        value: noteEntryBody(target) || String((match && match.value) || ''),
      }
    : match;
  const updates = (Array.isArray(lead && lead.updates) ? lead.updates : []).filter(
    (u) => !leadNoteMatches(u, resolvedMatch),
  );
  const logs = (Array.isArray(lead && lead.logs) ? lead.logs : []).filter(
    (log) => !leadNoteLogMatches(log, resolvedMatch),
  );
  return { updates, logs };
}

function findDeletableLeadNote(lead, match) {
  const updates = Array.isArray(lead && lead.updates) ? lead.updates : [];
  const direct = updates.find((u) => leadNoteMatches(u, match));
  if (direct) return direct;
  const val = String((match && match.value) || '').trim();
  if (!val) return null;
  const candidates = updates.filter(
    (u) => isDeletableLeadNote(u) && noteEntryBody(u) === val,
  );
  if (candidates.length === 1) return candidates[0];
  return null;
}

module.exports = {
  noteEntryBody,
  isDeletableLeadNote,
  noteTimestampsMatch,
  leadNoteMatches,
  leadNoteLogMatches,
  removeLeadNoteFromLead,
  findDeletableLeadNote,
};
