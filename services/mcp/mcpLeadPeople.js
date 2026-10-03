/**
 * "Whose leads" for AI assistants: resolve "me" / a teammate / a bot, then use Team history to find
 * the leads that person bookmarked, tagged or worked on (including what assistants did at their request).
 */
const dbService = require('../database');
const teamActivity = require('../teamActivity');
const { emailAliases } = require('../workspaceService');

const ME = new Set(['me', 'my', 'mine', 'myself', 'i', 'self']);
const TAG_ACTIONS = new Set(['lead_tags', 'bulk_tags']);

function notFound(message) {
  const err = new Error(message);
  err.code = 'NOT_FOUND';
  return err;
}

/** { label, emails } for "me", a teammate (email or name) or an AI assistant ("Muse"). */
async function resolvePerson(ctx, ref) {
  const want = String(ref || '').trim().toLowerCase();
  const me = String((ctx && ctx.userEmail) || '').trim().toLowerCase();
  if (!want || ME.has(want) || want === me) {
    if (!me) throw notFound('No signed-in user on this connection, so "me" is unknown. Pass a teammate email instead.');
    return { label: 'you', emails: emailAliases(me) };
  }
  const ws = await dbService.getWorkspace(ctx.workspaceId);
  const people = teamActivity.memberDirectory(ws, dbService.teamActivityActorStats(ctx.workspaceId, {}));
  const nameOf = (p) => teamActivity.displayName(p).toLowerCase();
  let hit = people.find((p) => p.email === want) || people.find((p) => nameOf(p) === want);
  if (!hit) {
    const partial = people.filter((p) => nameOf(p).includes(want) || p.email.split('@')[0].startsWith(want));
    if (partial.length === 1) [hit] = partial;
  }
  if (!hit) {
    const names = people.map((p) => teamActivity.displayName(p)).join(', ');
    throw notFound(`No teammate or assistant matches "${ref}". People: ${names || 'none'}.`);
  }
  return {
    label: teamActivity.displayName(hit),
    emails: hit.isBot ? [hit.email] : emailAliases(hit.email),
  };
}

function rowKeys(r) {
  const keys = r.lead_key ? [r.lead_key] : r.meta && Array.isArray(r.meta.leadKeys) ? r.meta.leadKeys : [];
  return keys.map(teamActivity.normalizeLeadKey).filter(Boolean);
}

/**
 * Maps of lead key → { at, summary } for one person: every lead they worked on, leads whose bookmark
 * they set last (and didn't remove), and leads they added tags to.
 */
function personalLeadIndex(workspaceId, emails) {
  const worked = new Map();
  const bookmarked = new Map();
  const tagged = new Map();
  for (const r of dbService.listTeamActivityLeadRows(workspaceId, emails)) {
    const parts = String(r.summary || '').split(' · ').map((s) => s.trim());
    const bookmarkOn = parts.includes('Bookmarked');
    const bookmarkOff = parts.includes('Removed bookmark');
    const tagAdd = TAG_ACTIONS.has(r.action) && /^(Added|Set tags)\b/.test(r.summary || '');
    const entry = { at: r.created_at, summary: r.summary || '' };
    rowKeys(r).forEach((k) => {
      worked.set(k, entry);
      if (bookmarkOn) bookmarked.set(k, entry);
      else if (bookmarkOff) bookmarked.delete(k);
      if (tagAdd) tagged.set(k, entry);
    });
  }
  emails.forEach((email) => {
    dbService.listLeadKeysByActor(workspaceId, email, 'any').forEach((raw) => {
      const k = teamActivity.normalizeLeadKey(raw);
      if (k && !worked.has(k)) worked.set(k, { at: 0, summary: 'Added or last worked this lead' });
    });
  });
  return { worked, bookmarked, tagged };
}

module.exports = {
  resolvePerson,
  personalLeadIndex,
};
