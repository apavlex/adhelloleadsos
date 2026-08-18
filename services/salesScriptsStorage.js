/**
 * Workspace-persisted sales scripts: merge defaults with DB overrides, validate payloads.
 */

const MAX_SECTION_LEN = 24_000;

const SCRIPT_SECTIONS = ['opening', 'discovery', 'valueProp', 'objectionHandling', 'close'];

function mergeScriptLibrary(base, overrides) {
  const o = overrides && typeof overrides === 'object' ? overrides : {};
  const out = {};
  for (const k of Object.keys(base || {})) {
    const block = base[k];
    const patch = o[k] && typeof o[k] === 'object' ? o[k] : {};
    const next = { ...block };
    for (const sec of SCRIPT_SECTIONS) {
      if (Object.prototype.hasOwnProperty.call(patch, sec)) {
        const v = patch[sec];
        next[sec] = v == null ? '' : String(v);
      }
    }
    out[k] = next;
  }
  return out;
}

function sanitizeBlockOverrides(input, allowedServiceKeys) {
  const allow = new Set(allowedServiceKeys || []);
  const src = input && typeof input === 'object' ? input : {};
  const out = {};
  for (const k of Object.keys(src)) {
    if (!allow.has(k)) continue;
    const row = src[k];
    if (!row || typeof row !== 'object') continue;
    const block = {};
    for (const sec of SCRIPT_SECTIONS) {
      if (!Object.prototype.hasOwnProperty.call(row, sec)) continue;
      let s = row[sec] == null ? '' : String(row[sec]);
      if (s.length > MAX_SECTION_LEN) s = s.slice(0, MAX_SECTION_LEN);
      block[sec] = s;
    }
    if (Object.keys(block).length) out[k] = block;
  }
  return out;
}

function normalizeLibraryItem(raw, allowedServiceKeys) {
  const allow = new Set(allowedServiceKeys || []);
  const text = raw && raw.text != null ? String(raw.text).trim() : '';
  if (!text) return null;
  const title = raw.title != null ? String(raw.title).trim().slice(0, 200) : '';
  const serviceKey = raw.serviceKey != null ? String(raw.serviceKey).trim() : '';
  const section = raw.section != null ? String(raw.section).trim() : '';
  const sk = allow.has(serviceKey) ? serviceKey : '';
  const sec = SCRIPT_SECTIONS.includes(section) ? section : '';
  return {
    id:
      raw.id != null && String(raw.id).trim()
        ? String(raw.id).trim().slice(0, 80)
        : `sv_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
    savedAt: raw.savedAt != null ? String(raw.savedAt).slice(0, 40) : new Date().toISOString(),
    title: title || 'Saved script',
    serviceKey: sk,
    section: sec,
    text: text.slice(0, MAX_SECTION_LEN),
  };
}

function sanitizeLibraryItems(arr, allowedServiceKeys) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const raw of arr) {
    const one = normalizeLibraryItem(raw, allowedServiceKeys);
    if (one) out.push(one);
  }
  return out;
}

function libraryItemFingerprint(item) {
  const title = String((item && item.title) || '')
    .trim()
    .toLowerCase();
  const body = String((item && item.text) || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  return `${title}\n${body}`;
}

function itemSavedAtMs(item) {
  const ts = Date.parse((item && item.savedAt) || '');
  return Number.isFinite(ts) ? ts : 0;
}

const LIBRARY_DEDUPE_WINDOW_MS = 15 * 60 * 1000;
const LIBRARY_IDEMPOTENT_WINDOW_MS = 30 * 1000;

/**
 * Collapse identical title+body rows saved close together (keep newest).
 */
function dedupeLibraryItems(arr, windowMs) {
  const list = Array.isArray(arr) ? arr.filter((x) => x && typeof x === 'object') : [];
  const win = windowMs == null ? LIBRARY_DEDUPE_WINDOW_MS : Number(windowMs);
  const kept = [];
  const lastByKey = new Map();
  for (const item of list) {
    const key = libraryItemFingerprint(item);
    const prevIdx = lastByKey.get(key);
    if (prevIdx == null) {
      lastByKey.set(key, kept.length);
      kept.push(item);
      continue;
    }
    const prev = kept[prevIdx];
    const gap = Math.abs(itemSavedAtMs(item) - itemSavedAtMs(prev));
    if (gap <= win) {
      if (itemSavedAtMs(item) >= itemSavedAtMs(prev)) kept[prevIdx] = item;
    } else {
      lastByKey.set(key, kept.length);
      kept.push(item);
    }
  }
  return kept;
}

/**
 * Append a library snippet unless the same title+body was just saved.
 */
function appendLibraryItemIdempotent(items, item, windowMs) {
  const list = Array.isArray(items) ? [...items] : [];
  const next = item && typeof item === 'object' ? item : null;
  if (!next) return { items: list, item: null, duplicate: false };
  const key = libraryItemFingerprint(next);
  const now = itemSavedAtMs(next) || Date.now();
  const win = windowMs == null ? LIBRARY_IDEMPOTENT_WINDOW_MS : Number(windowMs);
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const prev = list[i];
    if (libraryItemFingerprint(prev) !== key) continue;
    const prevTs = itemSavedAtMs(prev) || 0;
    if (Math.abs(now - prevTs) <= win) {
      return { items: list, item: prev, duplicate: true };
    }
    break;
  }
  list.push(next);
  return { items: list, item: next, duplicate: false };
}

function buildMergedScriptLibrary(ws, baseLib) {
  const { buildWorkspaceOfferLibrary } = require('./workspaceSalesScripts');
  return buildWorkspaceOfferLibrary(ws, baseLib).library;
}

function getWorkspaceScriptKeys(ws, baseLib) {
  const { buildWorkspaceOfferLibrary } = require('./workspaceSalesScripts');
  return buildWorkspaceOfferLibrary(ws, baseLib).keys;
}

function getInitialLibraryItemsFromWorkspace(ws) {
  return Array.isArray(ws && ws.salesScriptLibraryItems) ? ws.salesScriptLibraryItems : [];
}

/** Join saved sections into one script (legacy multi-section data still composes). */
function composeOfferScriptText(block) {
  if (!block || typeof block !== 'object') return '';
  const parts = [];
  for (const sec of SCRIPT_SECTIONS) {
    const t = String(block[sec] || '').trim();
    if (t) parts.push(t);
  }
  return parts.join('\n\n');
}

/** Single-window editor: store full script in opening, clear other sections. */
function splitOfferScriptForSave(fullText) {
  const text = fullText == null ? '' : String(fullText);
  const out = {};
  for (const sec of SCRIPT_SECTIONS) {
    out[sec] = sec === 'opening' ? text : '';
  }
  return out;
}

module.exports = {
  SCRIPT_SECTIONS,
  mergeScriptLibrary,
  sanitizeBlockOverrides,
  sanitizeLibraryItems,
  normalizeLibraryItem,
  libraryItemFingerprint,
  dedupeLibraryItems,
  appendLibraryItemIdempotent,
  LIBRARY_DEDUPE_WINDOW_MS,
  LIBRARY_IDEMPOTENT_WINDOW_MS,
  buildMergedScriptLibrary,
  getWorkspaceScriptKeys,
  getInitialLibraryItemsFromWorkspace,
  composeOfferScriptText,
  splitOfferScriptForSave,
};
