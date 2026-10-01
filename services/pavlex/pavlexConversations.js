/**
 * Pavlex chat page conversations — one list per workspace + user.
 * The list lives in one KV row; messages stay in chat_messages under
 * pavlexChatChannel(workspaceId, email, conversationId).
 */
const crypto = require('crypto');
const dbService = require('../database');
const { pavlexChatChannel } = require('./pavlexWorkspaceScope');

const DEFAULT_TITLE = 'New chat';
const TITLE_MAX = 60;
const PREVIEW_MAX = 140;
const MAX_CONVERSATIONS = 300;
const TOOLS_LOG_MAX = 100;

function normEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function normWorkspace(workspaceId) {
  return String(workspaceId || '').trim();
}

function scopeOrThrow(workspaceId, email) {
  const wid = normWorkspace(workspaceId);
  const em = normEmail(email);
  if (!wid || !em) {
    const err = new Error('Sign in required.');
    err.status = 401;
    throw err;
  }
  return { wid, em };
}

function storeKey(wid, em) {
  return `pavlexconv:${wid}:${em}`;
}

function readList(wid, em) {
  const raw = dbService.getKvSync(storeKey(wid, em));
  if (!raw) return [];
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const items = Array.isArray(parsed) ? parsed : parsed && Array.isArray(parsed.items) ? parsed.items : [];
    return items.filter((c) => c && typeof c.id === 'string');
  } catch {
    return [];
  }
}

function writeList(wid, em, items) {
  dbService.setKvSync(storeKey(wid, em), JSON.stringify({ v: 1, items }));
}

function newConversationId() {
  return `c_${crypto.randomBytes(9).toString('base64url')}`;
}

function isValidConversationId(id) {
  return /^c_[A-Za-z0-9_-]{6,40}$/.test(String(id || ''));
}

function collapseWhitespace(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function truncate(text, max) {
  const s = collapseWhitespace(text);
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[\s,.;:!?-]+$/, '')}…`;
}

/** Title from the first user message: plain text, first line, ~60 chars. */
function autoTitleFromMessage(message) {
  const firstLine = String(message || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find(Boolean);
  const plain = String(firstLine || '')
    .replace(/[`*_#>[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!plain) return DEFAULT_TITLE;
  const t = truncate(plain, TITLE_MAX);
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function previewFrom(text) {
  const plain = String(text || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^\s*\|?[\s:|-]*-{2,}[\s:|-]*\|?\s*$/gm, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[`*_#>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return truncate(plain, PREVIEW_MAX);
}

function publicShape(c) {
  return {
    id: c.id,
    title: c.title || DEFAULT_TITLE,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    messageCount: c.messageCount || 0,
    lastPreview: c.lastPreview || '',
    pinned: c.pinned === true,
  };
}

function sortConversations(items) {
  return [...items].sort((a, b) => {
    if ((a.pinned === true) !== (b.pinned === true)) return a.pinned === true ? -1 : 1;
    return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
  });
}

function channelFor(wid, em, id) {
  return pavlexChatChannel(wid, em, id);
}

/** Drop the oldest unpinned conversations (and their messages) past the cap. */
function enforceCap(wid, em, items) {
  if (items.length <= MAX_CONVERSATIONS) return items;
  const sorted = sortConversations(items);
  const keep = sorted.slice(0, MAX_CONVERSATIONS);
  const dropped = sorted.slice(MAX_CONVERSATIONS);
  for (const c of dropped) dbService.deleteChatHistory(channelFor(wid, em, c.id));
  return keep;
}

/**
 * @param {string} workspaceId
 * @param {string} email
 * @param {{ q?: string }} [opts]
 */
function listConversations(workspaceId, email, opts = {}) {
  const { wid, em } = scopeOrThrow(workspaceId, email);
  const q = collapseWhitespace(opts.q).toLowerCase();
  let items = sortConversations(readList(wid, em));
  if (q) {
    items = items.filter(
      (c) =>
        String(c.title || '').toLowerCase().includes(q) ||
        String(c.lastPreview || '').toLowerCase().includes(q),
    );
  }
  return items.map(publicShape);
}

function getConversation(workspaceId, email, id) {
  const { wid, em } = scopeOrThrow(workspaceId, email);
  if (!isValidConversationId(id)) return null;
  const found = readList(wid, em).find((c) => c.id === id);
  return found ? publicShape(found) : null;
}

/**
 * @param {string} workspaceId
 * @param {string} email
 * @param {{ title?: string }} [opts]
 */
function createConversation(workspaceId, email, opts = {}) {
  const { wid, em } = scopeOrThrow(workspaceId, email);
  const now = new Date().toISOString();
  const title = collapseWhitespace(opts.title).slice(0, TITLE_MAX);
  const conv = {
    id: newConversationId(),
    title: title || DEFAULT_TITLE,
    titleSource: title ? 'user' : 'default',
    createdAt: now,
    updatedAt: now,
    messageCount: 0,
    lastPreview: '',
    pinned: false,
  };
  const items = enforceCap(wid, em, [conv, ...readList(wid, em)]);
  writeList(wid, em, items);
  return publicShape(conv);
}

/**
 * @param {string} workspaceId
 * @param {string} email
 * @param {string} id
 * @param {{ title?: string, pinned?: boolean }} patch
 */
function updateConversation(workspaceId, email, id, patch = {}) {
  const { wid, em } = scopeOrThrow(workspaceId, email);
  if (!isValidConversationId(id)) return null;
  const items = readList(wid, em);
  const idx = items.findIndex((c) => c.id === id);
  if (idx < 0) return null;
  const next = { ...items[idx] };
  if (patch.title !== undefined) {
    const title = collapseWhitespace(patch.title).slice(0, TITLE_MAX);
    if (title) {
      next.title = title;
      next.titleSource = 'user';
    }
  }
  if (patch.pinned !== undefined) next.pinned = patch.pinned === true;
  items[idx] = next;
  writeList(wid, em, items);
  return publicShape(next);
}

function deleteConversation(workspaceId, email, id) {
  const { wid, em } = scopeOrThrow(workspaceId, email);
  if (!isValidConversationId(id)) return false;
  const items = readList(wid, em);
  const remaining = items.filter((c) => c.id !== id);
  if (remaining.length === items.length) return false;
  writeList(wid, em, remaining);
  dbService.deleteChatHistory(channelFor(wid, em, id));
  return true;
}

/**
 * Messages for a conversation (oldest first). Returns null when it is not the user's.
 */
function getConversationMessages(workspaceId, email, id, limit = 200) {
  const { wid, em } = scopeOrThrow(workspaceId, email);
  if (!isValidConversationId(id)) return null;
  const conv = readList(wid, em).find((c) => c.id === id);
  if (!conv) return null;
  const messages = dbService
    .getChatHistory(channelFor(wid, em, id), limit)
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ id: m.id, role: m.role, content: m.content, createdAt: m.created_at }));
  // toolsLog has one entry per assistant reply, oldest first — align from the newest end.
  const log = Array.isArray(conv.toolsLog) ? conv.toolsLog : [];
  let li = log.length - 1;
  for (let i = messages.length - 1; i >= 0 && li >= 0; i--) {
    if (messages[i].role !== 'assistant') continue;
    if (Array.isArray(log[li]) && log[li].length) messages[i].toolsUsed = log[li];
    li--;
  }
  return messages;
}

/**
 * After a successful exchange: bump updatedAt / counts / preview, auto-title the first message.
 * Returns null when the conversation was deleted meanwhile (its stray messages are removed).
 */
function recordExchange(workspaceId, email, id, { userMessage = '', reply = '', toolsUsed = [] } = {}) {
  const { wid, em } = scopeOrThrow(workspaceId, email);
  const items = readList(wid, em);
  const idx = items.findIndex((c) => c.id === id);
  if (idx < 0) {
    if (isValidConversationId(id)) dbService.deleteChatHistory(channelFor(wid, em, id));
    return null;
  }
  const next = { ...items[idx] };
  if (next.titleSource !== 'user' && (!next.messageCount || next.title === DEFAULT_TITLE)) {
    next.title = autoTitleFromMessage(userMessage);
    next.titleSource = 'auto';
  }
  next.messageCount = (next.messageCount || 0) + (userMessage ? 1 : 0) + (reply ? 1 : 0);
  next.lastPreview = previewFrom(reply || userMessage);
  if (reply) {
    const tools = (Array.isArray(toolsUsed) ? toolsUsed : [])
      .map((t) => String((t && t.name) || t || '').slice(0, 60))
      .filter(Boolean)
      .slice(0, 12);
    next.toolsLog = [...(Array.isArray(next.toolsLog) ? next.toolsLog : []), tools].slice(-TOOLS_LOG_MAX);
  }
  next.updatedAt = new Date().toISOString();
  items[idx] = next;
  writeList(wid, em, items);
  return publicShape(next);
}

module.exports = {
  DEFAULT_TITLE,
  listConversations,
  getConversation,
  createConversation,
  updateConversation,
  deleteConversation,
  getConversationMessages,
  recordExchange,
  autoTitleFromMessage,
  isValidConversationId,
};
