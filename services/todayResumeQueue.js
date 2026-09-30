/**
 * Today → "Pick up where you left off": bookmarked-lead sessions (grouped by folder)
 * and the leads most recently worked, each linking into Money Mode with an explicit key list.
 */

const { buildWorkspaceActivityFeed } = require('./leadActivityFeed');
const { buildFocusQueue, shortLeadKey } = require('./focusQueue');

/** Keeps /focus?keys=… URLs well under proxy/header limits. */
const RESUME_MAX_KEYS = 150;
const UNFILED_FOLDER_ID = '__unfiled__';

/** Inbound signals and automation aren't the rep "working" a lead. */
const NOT_WORKED_TYPES = new Set(['sms_inbound', 'email_inbound', 'engagement_signal']);

function isBookmarkedLead(l) {
  const v = l && l.bookmarked;
  return v === true || v === 1 || v === '1' || v === 'true';
}

function hasCallablePhone(l) {
  const p = String((l && l.phone) || '').trim();
  return Boolean(p && p !== 'N/A' && p !== '—');
}

function focusSessionHref(keys) {
  const list = (keys || []).filter(Boolean).slice(0, RESUME_MAX_KEYS);
  if (!list.length) return '/focus';
  const params = new URLSearchParams();
  params.set('lead', list[0]);
  params.set('keys', list.join(','));
  params.set('channel', 'call');
  return `/focus?${params.toString()}`;
}

function relativeTimeLabel(tsMs, nowMs = Date.now()) {
  if (!tsMs) return '';
  const diff = Math.max(0, nowMs - tsMs);
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function buildFolderNameLookup(folders) {
  const map = new Map();
  (folders || []).forEach((f) => {
    if (!f || !f.key) return;
    const name = String(f.name || 'Folder').trim() || 'Folder';
    const full = String(f.key).trim();
    map.set(full, name);
    const suffix = full.split(':').pop();
    if (suffix && !map.has(suffix)) map.set(suffix, name);
  });
  return (folderKey) => {
    const k = String(folderKey || '').trim();
    if (!k) return '';
    return map.get(k) || map.get(k.split(':').pop()) || '';
  };
}

/**
 * @param {object[]} leads — business pipeline leads visible to the user
 * @param {object[]} folders — dbService.listFolders()
 * @param {object} [focusOpts] — same ROI / queueMode opts Money Mode ranks with
 */
function buildBookmarkSessions(leads, folders, focusOpts = {}) {
  const folderName = buildFolderNameLookup(folders);
  const bookmarked = (leads || []).filter(isBookmarkedLead);
  const ranked = buildFocusQueue(bookmarked, RESUME_MAX_KEYS * 4, focusOpts);

  const groups = new Map();
  for (const lead of ranked) {
    const fk = String(lead.folderKey || '').trim();
    const id = fk || UNFILED_FOLDER_ID;
    if (!groups.has(id)) {
      groups.set(id, {
        id,
        name: fk ? folderName(fk) || 'Folder' : 'Main pipeline (unfiled)',
        keys: [],
        count: 0,
        callable: 0,
      });
    }
    const g = groups.get(id);
    g.count += 1;
    if (hasCallablePhone(lead)) g.callable += 1;
    g.keys.push(shortLeadKey(lead));
  }

  const folderSessions = [...groups.values()]
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .map((g) => ({
      id: g.id,
      name: g.name,
      count: g.count,
      callable: g.callable,
      href: focusSessionHref(g.keys),
    }));

  return {
    total: ranked.length,
    callable: ranked.filter(hasCallablePhone).length,
    href: focusSessionHref(ranked.map(shortLeadKey)),
    folders: folderSessions,
  };
}

/**
 * @param {object[]} leads — business pipeline leads visible to the user
 * @param {object[]} folders
 * @param {{ limit?: number, sinceDays?: number }} [opts]
 */
function buildRecentlyWorked(leads, folders, opts = {}) {
  const limit = Math.max(1, parseInt(opts.limit, 10) || 8);
  const sinceDays = Number.isFinite(opts.sinceDays) ? opts.sinceDays : 14;
  const folderName = buildFolderNameLookup(folders);
  const byKey = new Map((leads || []).map((l) => [l.key, l]));

  const feed = buildWorkspaceActivityFeed(leads, { filter: 'all', limit: 200, sinceDays });
  const nowMs = Date.now();
  const items = [];
  for (const group of feed.groups) {
    const worked = (group.events || []).find((e) => !NOT_WORKED_TYPES.has(String(e.type || '').toLowerCase()));
    if (!worked) continue;
    const lead = byKey.get(group.leadKey);
    const key = lead ? shortLeadKey(lead) : String(group.leadKey || '').replace(/^lead:/i, '');
    if (!key) continue;
    items.push({
      key,
      title: group.leadTitle,
      folderName: folderName(group.folderKey),
      tsMs: worked.tsMs,
      when: relativeTimeLabel(worked.tsMs, nowMs),
      typeLabel: worked.typeLabel || '',
      text: String(worked.text || '').slice(0, 90),
      callable: hasCallablePhone(lead),
      href: focusSessionHref([key]),
    });
  }
  items.sort((a, b) => b.tsMs - a.tsMs);

  const resumeKeys = items.slice(0, RESUME_MAX_KEYS).map((i) => i.key);
  return {
    total: items.length,
    sinceDays,
    items: items.slice(0, limit),
    href: focusSessionHref(resumeKeys),
  };
}

module.exports = {
  buildBookmarkSessions,
  buildRecentlyWorked,
  focusSessionHref,
  relativeTimeLabel,
  isBookmarkedLead,
  RESUME_MAX_KEYS,
};
