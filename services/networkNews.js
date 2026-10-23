/**
 * Network news & updates feed — posts from workspace admins/managers that
 * members browse in the Reviews app (Notifications → News & updates).
 */

const dbService = require('./database');

const MAX_POSTS = 80;
const MAX_TITLE = 120;
const MAX_BODY = 800;
const MAX_LINK = 500;

const kvKey = (networkId) => `networkNews:${String(networkId || '').trim()}`;

function clean(v, max) {
  return String(v == null ? '' : v).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function cleanMultiline(v, max) {
  return String(v == null ? '' : v)
    .replace(/\r\n/g, '\n')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, max);
}

function safeLink(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (s.startsWith('/') && !s.startsWith('//')) return s.slice(0, MAX_LINK);
  try {
    const u = new URL(s);
    if (u.protocol === 'http:' || u.protocol === 'https:') return u.toString().slice(0, MAX_LINK);
  } catch { /* ignore */ }
  return '';
}

function list(networkId) {
  if (!String(networkId || '').trim()) return [];
  const key = kvKey(networkId);
  let raw = dbService.getKvSync(key);
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch { raw = []; }
  }
  return Array.isArray(raw) ? raw : [];
}

function get(networkId, postId) {
  const id = String(postId || '').trim();
  if (!id) return null;
  return list(networkId).find((p) => p && p.id === id) || null;
}

/**
 * @returns {object|null} saved post
 */
function add(networkId, item = {}) {
  const nid = String(networkId || '').trim();
  const title = clean(item.title, MAX_TITLE);
  const body = cleanMultiline(item.body || item.message, MAX_BODY);
  if (!nid || !title || !body) return null;
  const post = {
    id: `news_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    at: new Date().toISOString(),
    title,
    body,
    link: safeLink(item.link || item.url),
    linkLabel: clean(item.linkLabel, 60),
    audience: clean(item.audience || 'all', 20) || 'all',
    createdBy: clean(item.createdBy, 200),
    channels: {
      app: !!(item.channels && item.channels.app),
      sms: !!(item.channels && item.channels.sms),
    },
  };
  const next = [post, ...list(nid)].slice(0, MAX_POSTS);
  dbService.setKvSync(kvKey(nid), next);
  return post;
}

function remove(networkId, postId) {
  const nid = String(networkId || '').trim();
  const id = String(postId || '').trim();
  if (!nid || !id) return { removed: 0 };
  const prev = list(nid);
  const next = prev.filter((p) => p && p.id !== id);
  if (next.length === prev.length) return { removed: 0 };
  dbService.setKvSync(kvKey(nid), next);
  return { removed: 1 };
}

module.exports = {
  MAX_POSTS,
  MAX_TITLE,
  MAX_BODY,
  MAX_LINK,
  list,
  get,
  add,
  remove,
  safeLink,
};
