/**
 * Bell notifications raised in the browser (contact hunts, artwork, bulk sends, GHL sync…),
 * kept per workspace so they show up in notification history after the tab is closed.
 */
const dbService = require('./database');

const MAX_ENTRIES = 200;
const kvKey = (wid) => `notificationLog:${wid}`;

function clean(v, max) {
  return String(v == null ? '' : v).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function safeHref(v) {
  const s = String(v || '').trim();
  return s.startsWith('/') && !s.startsWith('//') ? s.slice(0, 500) : '';
}

function list(workspaceId) {
  const wid = String(workspaceId || '').trim();
  if (!wid) return [];
  let raw = dbService.getKvSync(kvKey(wid));
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      raw = [];
    }
  }
  return Array.isArray(raw) ? raw : [];
}

/** @returns {object|null} the stored entry */
function add(workspaceId, item, userEmail) {
  const wid = String(workspaceId || '').trim();
  const title = clean(item && (item.headline || item.title), 140);
  if (!wid || !title) return null;
  const entry = {
    id: `n_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    at: new Date().toISOString(),
    title,
    body: clean(item.body, 400),
    href: safeHref(item.href),
    linkLabel: clean(item.linkLabel, 40),
    userEmail: String(userEmail || '').trim().toLowerCase(),
  };
  dbService.setKvSync(kvKey(wid), [entry, ...list(wid)].slice(0, MAX_ENTRIES));
  return entry;
}

module.exports = { add, list, MAX_ENTRIES };
