/**
 * Classify lead notes as AI / you / teammate for panel + Focus touch history.
 */
const { isBotEmail } = require('./teamActivity');
const { emailAliases } = require('./workspaceService');

const AI_SOURCES = new Set(['ai_assistant', 'ai', 'pavlex', 'cursor_agent', 'mcp']);

function extractEmail(value) {
  const s = String(value || '');
  const m = s.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return m ? m[0].toLowerCase() : '';
}

function extractDisplayName(by) {
  const s = String(by || '').trim();
  if (!s) return '';
  const beforeParen = s.split('(')[0].trim();
  if (beforeParen && beforeParen.includes('@')) return beforeParen.split('@')[0];
  if (beforeParen) return beforeParen.slice(0, 40);
  return '';
}

function emailsMatch(a, b) {
  const left = emailAliases(a);
  const right = new Set(emailAliases(b));
  return left.some((e) => right.has(e));
}

function noteBody(raw) {
  if (!raw || typeof raw !== 'object') return '';
  if (raw.value != null && String(raw.value).trim()) return String(raw.value);
  if (raw.content != null && String(raw.content).trim()) return String(raw.content);
  if (raw.message != null && String(raw.message).trim()) return String(raw.message);
  if (raw.note != null && String(raw.note).trim()) return String(raw.note);
  if (raw.text != null && String(raw.text).trim()) return String(raw.text);
  return '';
}

function looksLikeAiNote(raw, body) {
  const source = String((raw && raw.source) || '').toLowerCase();
  if (AI_SOURCES.has(source)) return true;
  const byEmail = String((raw && raw.byEmail) || '').toLowerCase();
  if (isBotEmail(byEmail)) return true;
  const by = String((raw && raw.by) || '').trim();
  if (isBotEmail(by)) return true;
  if (/^ai(\s|$| assistant)/i.test(by) || /^assistant\b/i.test(by)) return true;
  // Legacy AI digests before source was stamped.
  if (/\(prospecting digest\)/i.test(body) || /^Prospect #\d+/i.test(body)) return true;
  return false;
}

/**
 * @param {object} raw - update/log entry (or activity entry.raw)
 * @param {{ viewerEmail?: string }} [opts]
 * @returns {{ kind: 'ai'|'me'|'teammate'|'unknown', label: string, badge: string, detail: string }}
 */
function classifyNoteAttribution(raw, opts = {}) {
  const entry = raw && typeof raw === 'object' ? raw : {};
  const body = noteBody(entry);
  const by = String(entry.by || '').trim();
  const byEmail = String(entry.byEmail || extractEmail(by) || '').toLowerCase();
  const viewer = String(opts.viewerEmail || '').trim().toLowerCase();

  if (looksLikeAiNote(entry, body)) {
    const detail = by && !isBotEmail(by) ? by : 'AI assistant';
    return { kind: 'ai', label: 'AI note', badge: 'AI', detail };
  }

  if (viewer && byEmail && emailsMatch(viewer, byEmail)) {
    return { kind: 'me', label: 'Your note', badge: 'You', detail: by || viewer };
  }

  if (byEmail || by) {
    const name = extractDisplayName(by) || (byEmail ? byEmail.split('@')[0] : '') || 'Teammate';
    return {
      kind: 'teammate',
      label: `${name}'s note`,
      badge: name,
      detail: by || byEmail,
    };
  }

  return { kind: 'unknown', label: 'Note', badge: '', detail: '' };
}

/** Type line for note-like activity (keeps "Note" for unknown). */
function noteTypeLabel(raw, opts = {}) {
  const attr = classifyNoteAttribution(raw, opts);
  if (attr.kind === 'unknown') return 'Note';
  return attr.label;
}

module.exports = {
  AI_SOURCES,
  extractEmail,
  extractDisplayName,
  emailsMatch,
  classifyNoteAttribution,
  noteTypeLabel,
  looksLikeAiNote,
};
