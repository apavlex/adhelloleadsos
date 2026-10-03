/**
 * Team history — per-teammate timeline of searches, tags, pipeline moves, notes,
 * lead changes and outreach, with a "reviewed up to" checkpoint per viewer.
 */
const express = require('express');
const router = express.Router();
const dbService = require('../services/database');
const { userEmail } = require('../services/workspaceService');
const teamActivity = require('../services/teamActivity');

const PAGE_SIZE = 60;
const MULTI_LEAD_PREVIEW = 5;

function viewerEmail(req) {
  return String(userEmail(req) || '').trim().toLowerCase();
}

function focusUrl(keys) {
  const list = (Array.isArray(keys) ? keys : [keys])
    .map((k) => String(k || '').replace(/^lead:/i, ''))
    .filter(Boolean);
  return list.length ? `/focus?keys=${encodeURIComponent(list.join(','))}` : '';
}

async function loadLeadTitles(workspaceId, keys) {
  const unique = [...new Set(keys.filter(Boolean))];
  const out = {};
  // Try each key with and without the "lead:" prefix. Deliberately no getLead() fallback: for a
  // deleted lead it scans and parses every lead in the database, once per missing key.
  const storageKeyFor = (key) => (/^lead:/i.test(key) ? key : `lead:${key}`);
  const found = dbService.getLeadTitlesByKeys(unique.flatMap((key) => [key, storageKeyFor(key)]));
  unique.forEach((key) => {
    const hit = found.get(key) || found.get(storageKeyFor(key));
    if (hit && (hit.workspaceId || 'default') === workspaceId) out[key] = hit.title || 'Lead';
  });
  return out;
}

/** Attach lead links/titles; deleted leads keep their recorded title without a link. */
async function hydrateRows(workspaceId, rows) {
  const keys = [];
  rows.forEach((r) => {
    if (r.lead_key) keys.push(r.lead_key);
    const many = r.meta && Array.isArray(r.meta.leadKeys) ? r.meta.leadKeys : [];
    many.slice(0, MULTI_LEAD_PREVIEW).forEach((k) => keys.push(k));
  });
  const titles = await loadLeadTitles(workspaceId, keys);
  return rows.map((r) => {
    const many = r.meta && Array.isArray(r.meta.leadKeys) ? r.meta.leadKeys : [];
    const leads = r.lead_key
      ? [{ key: r.lead_key, title: titles[r.lead_key] || r.lead_title || 'Lead', exists: !!titles[r.lead_key] }]
      : many.slice(0, MULTI_LEAD_PREVIEW).map((k) => ({ key: k, title: titles[k] || 'Lead', exists: !!titles[k] }));
    const existingKeys = r.lead_key ? (titles[r.lead_key] ? [r.lead_key] : []) : many;
    return {
      id: r.id,
      actorEmail: r.actor_email,
      actorName: r.actor_name || '',
      onBehalfOf: (r.meta && r.meta.onBehalfOf) || '',
      category: r.category,
      action: r.action,
      summary: r.summary || '',
      createdAt: r.created_at,
      leadCount: r.lead_count || 0,
      leads: leads.map((l) => ({ ...l, url: l.exists ? focusUrl(l.key) : '' })),
      moreLeads: Math.max(0, (r.lead_count || 0) - leads.length),
      openAllUrl: !r.lead_key && existingKeys.length > 1 ? focusUrl(existingKeys.slice(0, 80)) : '',
    };
  });
}

function buildMembers(req, checkpoints) {
  const me = viewerEmail(req);
  const stats = dbService.teamActivityActorStats(req.workspaceId, checkpoints);
  return teamActivity.memberDirectory(req.workspace, stats).map((m) => ({
    ...m,
    isYou: m.email === me,
    unseen: m.email === me ? 0 : m.unseen,
    label: m.email === me ? `${teamActivity.displayName(m)} (you)` : teamActivity.displayName(m),
    reviewedAt: checkpoints[m.email] || null,
  }));
}

router.get('/', async (req, res, next) => {
  try {
    const wid = req.workspaceId;
    const me = viewerEmail(req);
    const checkpoints = teamActivity.getReviewCheckpoints(wid, me);
    const members = buildMembers(req, checkpoints);
    const others = members.filter((m) => !m.isYou);

    let member = String(req.query.member || '').trim().toLowerCase();
    if (!member) {
      const busiest = others.filter((m) => m.unseen > 0).sort((a, b) => b.unseen - a.unseen)[0];
      member = busiest ? busiest.email : 'all';
    }
    if (member !== 'all' && !members.some((m) => m.email === member)) member = 'all';
    const selected = member === 'all' ? null : members.find((m) => m.email === member);

    const canReview = !selected || !selected.isYou;
    let view = String(req.query.view || '').trim().toLowerCase();
    if (view !== 'new' && view !== 'all') view = canReview && (selected ? selected.unseen : others.some((m) => m.unseen)) ? 'new' : 'all';
    if (!canReview) view = 'all';

    const category = teamActivity.CATEGORIES.some((c) => c.key === req.query.cat) ? req.query.cat : '';
    const before = parseInt(req.query.before, 10) || null;

    let rows;
    if (selected) {
      rows = dbService.listTeamActivity({
        workspaceId: wid,
        actorEmail: selected.email,
        category,
        since: view === 'new' ? checkpoints[selected.email] || null : null,
        before,
        limit: PAGE_SIZE + 1,
      });
    } else {
      rows = dbService.listTeamActivity({ workspaceId: wid, category, before, limit: (PAGE_SIZE + 1) * 2 });
      if (view === 'new') {
        rows = rows.filter((r) => r.actor_email !== me && r.created_at > (checkpoints[r.actor_email] || 0));
      }
      rows = rows.slice(0, PAGE_SIZE + 1);
    }
    const hasMore = rows.length > PAGE_SIZE;
    rows = rows.slice(0, PAGE_SIZE);
    const labelFor = (email) => (members.find((m) => m.email === email) || {}).label || '';
    const items = (await hydrateRows(wid, rows)).map((it) => ({
      ...it,
      isNew: it.actorEmail !== me && it.createdAt > (checkpoints[it.actorEmail] || 0),
      isBot: teamActivity.isBotEmail(it.actorEmail),
      actorLabel: labelFor(it.actorEmail) || it.actorName || it.actorEmail,
      onBehalfLabel: it.onBehalfOf ? (it.onBehalfOf === me ? 'you' : labelFor(it.onBehalfOf) || it.onBehalfOf.split('@')[0]) : '',
    }));

    const unseenTotal = selected ? selected.unseen : others.reduce((s, m) => s + (m.unseen || 0), 0);

    res.render('team-history', {
      title: 'Team history | Agency OS',
      activePage: 'team-history',
      members,
      selectedMember: selected,
      memberParam: member,
      view,
      canReview,
      category,
      categories: teamActivity.CATEGORIES,
      items,
      hasMore,
      nextBefore: items.length ? items[items.length - 1].createdAt : null,
      unseenTotal,
      newestAt: items.length ? items[0].createdAt : null,
      reviewedAt: selected ? checkpoints[selected.email] || null : null,
      workedLeadsUrl: selected ? `/prospecting?tab=pipeline&workedBy=${encodeURIComponent(selected.email)}` : '',
    });
  } catch (e) {
    next(e);
  }
});

/** POST /team-history/review — move the viewer's checkpoint for one teammate (or everyone) forward. */
router.post('/review', async (req, res, next) => {
  try {
    const wid = req.workspaceId;
    const me = viewerEmail(req);
    const member = String((req.body && req.body.member) || '').trim().toLowerCase();
    const requestedAt = parseInt(req.body && req.body.at, 10);
    const at = Number.isFinite(requestedAt) && requestedAt > 0 ? Math.min(requestedAt, Date.now()) : Date.now();
    if (member && member !== 'all') {
      if (member !== me) teamActivity.markReviewed(wid, me, member, at);
    } else {
      buildMembers(req, teamActivity.getReviewCheckpoints(wid, me))
        .filter((m) => !m.isYou)
        .forEach((m) => teamActivity.markReviewed(wid, me, m.email, at));
    }
    const back = `/team-history?member=${encodeURIComponent(member || 'all')}&view=all`;
    if (req.get('accept') && req.get('accept').includes('application/json')) {
      return res.json({ success: true, reviewedAt: at });
    }
    res.redirect(back);
  } catch (e) {
    next(e);
  }
});

/** GET /team-history/api/lead/:key — "Added by / Last worked by" plus recent team activity for one lead. */
router.get('/api/lead/:key', async (req, res, next) => {
  try {
    const wid = req.workspaceId;
    const raw = decodeURIComponent(String(req.params.key || '').trim());
    const storageKey = (await dbService.resolveLeadStorageKey(raw, wid)) || teamActivity.normalizeLeadKey(raw);
    const key = teamActivity.normalizeLeadKey(storageKey);
    const lead = await dbService.getLead(key, wid);
    if (!lead || (lead.workspaceId || 'default') !== wid) {
      return res.status(404).json({ success: false, error: 'Lead not found' });
    }
    const attr = dbService.getLeadAttributions(wid, [key])[key] || null;
    const members = teamActivity.memberDirectory(req.workspace, []);
    const me = viewerEmail(req);
    const person = (email) => {
      if (!email) return null;
      const m = members.find((x) => x.email === email) || { email };
      return {
        email,
        name: email === me ? 'You' : teamActivity.displayName(m),
        avatar: m.avatar || '',
        ...(teamActivity.isBotEmail(email) ? { bot: true } : {}),
      };
    };
    const recent = dbService.listTeamActivity({ workspaceId: wid, leadKey: key, limit: 8 }).map((r) => ({
      actor: person(r.actor_email),
      category: r.category,
      summary: r.summary,
      createdAt: r.created_at,
    }));
    res.json({
      success: true,
      teamSize: Object.keys((req.workspace && req.workspace.members) || {}).length,
      addedBy: attr && attr.created_by ? { ...person(attr.created_by), at: attr.created_at } : null,
      lastWorkedBy: attr && attr.last_by ? { ...person(attr.last_by), at: attr.last_at } : null,
      recent,
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
module.exports._test = { focusUrl };
