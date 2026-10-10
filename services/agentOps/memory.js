/**
 * Per-role working memory for ops bots (short notes the next run can use).
 */
const store = require('./store');

const MEMORY_PREFIX = 'agent_ops_memory:';
const MAX_NOTES = 30;

function getDb() {
  try {
    return require('../database');
  } catch (_) {
    return null;
  }
}

function readJson(key, fallback) {
  const db = getDb();
  if (!db || typeof db.getKvSync !== 'function') return fallback;
  try {
    const raw = db.getKvSync(key);
    if (!raw) return fallback;
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch (_) {
    return fallback;
  }
}

function writeJson(key, value) {
  const db = getDb();
  if (!db || typeof db.setKvSync !== 'function') return;
  try {
    db.setKvSync(key, JSON.stringify(value));
  } catch (err) {
    console.warn('[agentOps/memory] persist failed:', err && err.message);
  }
}

function keyFor(workspaceId, roleId) {
  return `${MEMORY_PREFIX}${String(workspaceId || '').trim()}:${String(roleId || '').trim()}`;
}

function listNotes(workspaceId, roleId, limit = 12) {
  const pack = readJson(keyFor(workspaceId, roleId), { notes: [] });
  const notes = Array.isArray(pack.notes) ? pack.notes : [];
  return notes.slice(0, Math.min(MAX_NOTES, Math.max(1, limit)));
}

function remember(workspaceId, roleId, note) {
  const wid = String(workspaceId || '').trim();
  const rid = String(roleId || '').trim();
  if (!wid || !rid) return null;
  const text = String((note && note.text) || note || '').trim().slice(0, 500);
  if (!text) return null;
  const pack = readJson(keyFor(wid, rid), { notes: [] });
  const notes = Array.isArray(pack.notes) ? pack.notes : [];
  const entry = {
    id: store.newId('mem'),
    text,
    kind: String((note && note.kind) || 'note').slice(0, 40),
    meta: note && note.meta && typeof note.meta === 'object' ? note.meta : {},
    at: store.nowIso(),
  };
  notes.unshift(entry);
  writeJson(keyFor(wid, rid), { notes: notes.slice(0, MAX_NOTES), updatedAt: store.nowIso() });
  return entry;
}

function latestNote(workspaceId, roleId) {
  const notes = listNotes(workspaceId, roleId, 1);
  return notes[0] || null;
}

module.exports = {
  listNotes,
  remember,
  latestNote,
};
