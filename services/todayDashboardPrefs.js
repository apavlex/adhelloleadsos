/**
 * Today dashboard layout prefs (section order + hidden) — account-scoped so
 * desktop customize shows on phone / other browsers.
 */

const SECTION_IDS = [
  'hero',
  'sources',
  'resume',
  'actions',
  'pipeline',
  'dueTasks',
  'weekReview',
  'touches',
];

const SECTION_SET = new Set(SECTION_IDS);
const MAX_SECTIONS = SECTION_IDS.length + 8;

function sanitizeOrder(raw) {
  const out = [];
  const seen = {};
  const list = Array.isArray(raw) ? raw : [];
  for (const item of list.slice(0, MAX_SECTIONS)) {
    const id = String(item || '').trim();
    if (!id || !SECTION_SET.has(id) || seen[id]) continue;
    seen[id] = true;
    out.push(id);
  }
  for (const id of SECTION_IDS) {
    if (seen[id]) continue;
    seen[id] = true;
    out.push(id);
  }
  return out;
}

function sanitizeHidden(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const id of Object.keys(raw).slice(0, MAX_SECTIONS)) {
    if (!SECTION_SET.has(id)) continue;
    if (raw[id]) out[id] = true;
  }
  return out;
}

/** Normalize a client/server payload; clamp updatedAt so a skewed clock can't win forever. */
function sanitizeTodayDashboardPrefs(raw, now = Date.now()) {
  if (!raw || typeof raw !== 'object') return null;
  const ts = Number(raw.updatedAt);
  return {
    order: sanitizeOrder(raw.order),
    hidden: sanitizeHidden(raw.hidden),
    updatedAt: Number.isFinite(ts) && ts > 0 ? Math.min(ts, now) : now,
  };
}

function db() {
  return require('./database');
}

async function loadTodayDashboardPrefs(email) {
  if (!email) return null;
  const prefs = await db().getUserPrefs(email);
  const saved = prefs && prefs.todayDashboard;
  if (!saved || typeof saved !== 'object') return null;
  return sanitizeTodayDashboardPrefs(saved, Math.max(Date.now(), Number(saved.updatedAt) || 0));
}

async function saveTodayDashboardPrefs(email, raw) {
  if (!email) return null;
  const next = sanitizeTodayDashboardPrefs(raw);
  if (!next) return null;
  const cur = await loadTodayDashboardPrefs(email);
  if (cur && cur.updatedAt > next.updatedAt) return cur;
  await db().saveUserPrefs(email, { todayDashboard: next });
  return next;
}

module.exports = {
  SECTION_IDS,
  sanitizeTodayDashboardPrefs,
  loadTodayDashboardPrefs,
  saveTodayDashboardPrefs,
};
