/**
 * In-app activity feed for the member PWA (/m) — leads & referrals that need
 * immediate attention. Separate from the workspace CRM bell (staff-only).
 */
const dbService = require('./database');

const MAX_ENTRIES = 80;
const kvKey = (networkId, memberId) =>
  `memberActivity:${String(networkId || '').trim()}:${String(memberId || '').trim()}`;

function clean(v, max) {
  return String(v == null ? '' : v).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function safeHref(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  // Allow relative /m/... or /r/... deep links only.
  if (s.startsWith('/') && !s.startsWith('//')) return s.slice(0, 500);
  try {
    const u = new URL(s);
    if (u.pathname.startsWith('/m/') || u.pathname.startsWith('/r/') || u.pathname.startsWith('/a/')) {
      return `${u.pathname}${u.search}`.slice(0, 500);
    }
  } catch { /* ignore */ }
  return '';
}

function list(networkId, memberId) {
  if (!String(networkId || '').trim() || !String(memberId || '').trim()) return [];
  const key = kvKey(networkId, memberId);
  let raw = dbService.getKvSync(key);
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch { raw = []; }
  }
  return Array.isArray(raw) ? raw : [];
}

function unreadCount(networkId, memberId) {
  return list(networkId, memberId).filter((e) => e && !e.read).length;
}

/**
 * @returns {object|null} stored entry
 */
function add(networkId, memberId, item = {}) {
  const nid = String(networkId || '').trim();
  const mid = String(memberId || '').trim();
  const title = clean(item.title || item.headline, 140);
  if (!nid || !mid || !title) return null;
  const entry = {
    id: `ma_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    at: new Date().toISOString(),
    kind: clean(item.kind || 'lead', 32) || 'lead',
    title,
    body: clean(item.body, 280),
    href: safeHref(item.href),
    read: false,
  };
  const next = [entry, ...list(nid, mid)].slice(0, MAX_ENTRIES);
  dbService.setKvSync(kvKey(nid, mid), next);
  return entry;
}

function markRead(networkId, memberId, ids) {
  const nid = String(networkId || '').trim();
  const mid = String(memberId || '').trim();
  if (!nid || !mid) return { updated: 0 };
  const want = ids == null
    ? null
    : new Set([].concat(ids).map((id) => String(id || '').trim()).filter(Boolean));
  let updated = 0;
  const next = list(nid, mid).map((e) => {
    if (!e || e.read) return e;
    if (want && !want.has(e.id)) return e;
    updated += 1;
    return { ...e, read: true };
  });
  if (updated) dbService.setKvSync(kvKey(nid, mid), next);
  return { updated };
}

function markAllRead(networkId, memberId) {
  return markRead(networkId, memberId, null);
}

module.exports = {
  add,
  list,
  unreadCount,
  markRead,
  markAllRead,
  MAX_ENTRIES,
};
