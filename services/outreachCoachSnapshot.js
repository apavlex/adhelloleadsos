/**
 * Pipeline + tracker context for outreach motivation / AI coaching (Daily Tracker page).
 */

const dbService = require('./database');
const {
  computeOutreachStreak,
  countUniqueLeadsTouchedOnUtcDate,
  dailyPersonalizedTouchGoal,
} = require('./trackerStats');
const { PIPELINE_STAGES } = require('./salesConstants');
const { scoreLeadRecord } = require('./opportunityScore');
const { filterLeadsForRequest, userEmail } = require('./workspaceService');

const ENTREPRENEUR_QUOTES = [
  { text: 'The way to get started is to quit talking and begin doing.', author: 'Walt Disney' },
  {
    text: 'Your most unhappy customers are your greatest source of learning.',
    author: 'Bill Gates',
  },
  {
    text: "I'm convinced that about half of what separates successful entrepreneurs from the non-successful ones is pure perseverance.",
    author: 'Steve Jobs',
  },
  { text: "Don't worry about failure; you only have to be right once.", author: 'Drew Houston' },
  { text: 'The secret of getting ahead is getting started.', author: 'Mark Twain' },
  {
    text: "If you are not embarrassed by the first version of your product, you've launched too late.",
    author: 'Reid Hoffman',
  },
  { text: 'Sales fixes everything.', author: 'Mark Cuban' },
  {
    text: 'Every sale has five basic obstacles: no need, no money, no hurry, no desire, no trust.',
    author: 'Zig Ziglar',
  },
  {
    text: 'Success is walking from failure to failure with no loss of enthusiasm.',
    author: 'Winston Churchill',
  },
  { text: 'Ideas are easy. Implementation is hard.', author: 'Guy Kawasaki' },
  {
    text: 'The best time to plant a tree was 20 years ago. The second best time is now.',
    author: 'Chinese proverb',
  },
  {
    text: "I have not failed. I've just found 10,000 ways that won't work.",
    author: 'Thomas Edison',
  },
];

function firstNameFromUser(user) {
  const raw =
    (user && user.displayName) ||
    (user && user.emails && user.emails[0] && user.emails[0].value) ||
    'there';
  return String(raw).trim().split(/\s+/)[0] || 'there';
}

function countReplySignals(leads) {
  return leads.filter((l) => {
    const logs = l.logs || [];
    return logs.some((log) => {
      const blob = `${log.type || ''} ${log.message || ''}`.toLowerCase();
      return blob.includes('reply') || blob.includes('inbound') || blob.includes('replied');
    });
  }).length;
}

function countOverdueSequences(leads) {
  const now = Date.now();
  return leads.filter((l) => {
    const st = l.sequenceState;
    if (!st || st.status !== 'active' || !st.nextDueAt) return false;
    return Date.parse(st.nextDueAt) < now;
  }).length;
}

function leadShortKey(l) {
  const k = String(l?.key || '').trim();
  if (!k) return '';
  return k.startsWith('lead:') ? k.slice(5) : k;
}

function displayLeadName(l) {
  const c = String(l.contactName || '').trim();
  if (c) return c;
  const em = String(l.email || '').trim();
  if (em && em !== 'N/A') {
    const local = em.split('@')[0];
    if (local) return local.replace(/[._]+/g, ' ').trim();
  }
  return 'Contact';
}

function companyTitle(l) {
  const t = String(l.title || '').trim();
  return t || 'Company';
}

/**
 * Named, one-click actions for Today / outreach coach (server-driven).
 * @param {object[]} leads — workspace-filtered leads
 * @param {object} snapshot — from buildOutreachCoachSnapshot (needs scheduledSearchesCount, totalLeads)
 * @returns {Array<{ label: string, leadId: string, leadName: string, href: string, actionType: string }>}
 */
function buildNamedCoachActions(leads, snapshot) {
  const list = Array.isArray(leads) ? leads : [];
  const actions = [];
  const used = new Set();
  const now = Date.now();
  const total = snapshot.totalLeads != null ? snapshot.totalLeads : list.length;

  const overdue = list
    .filter((l) => {
      const st = l.sequenceState;
      if (!st || st.status !== 'active' || !st.nextDueAt) return false;
      return Date.parse(st.nextDueAt) < now;
    })
    .sort((a, b) => Date.parse(a.sequenceState.nextDueAt) - Date.parse(b.sequenceState.nextDueAt));

  overdue.slice(0, 6).forEach((l) => {
    const id = leadShortKey(l);
    if (!id || used.has(id)) return;
    used.add(id);
    actions.push({
      label: `Follow up — ${companyTitle(l)} (cadence overdue)`,
      leadId: id,
      leadName: displayLeadName(l),
      href: `/focus?leadId=${encodeURIComponent(id)}`,
      actionType: 'follow_up',
    });
  });

  const early = list.filter((l) => {
    const ps = parseInt(l.pipelineStage, 10);
    const n = !Number.isNaN(ps) && ps >= 1 && ps <= 10 ? ps : 1;
    return n <= 2;
  });

  let draftCount = 0;
  early.forEach((l) => {
    if (draftCount >= 6) return;
    const id = leadShortKey(l);
    if (!id || used.has(id)) return;
    used.add(id);
    draftCount += 1;
    const ln = displayLeadName(l);
    const co = companyTitle(l);
    actions.push({
      label: `Draft follow-up to ${ln} (${co})`,
      leadId: id,
      leadName: ln,
      href: `/focus?leadId=${encodeURIComponent(id)}`,
      actionType: 'draft_email',
    });
  });

  list.forEach((l) => {
    if (actions.length >= 12) return;
    const id = leadShortKey(l);
    if (!id || used.has(id)) return;
    const ps = parseInt(l.pipelineStage, 10);
    if (Number.isNaN(ps) || ps < 3 || ps > 5) return;
    const { tier } = scoreLeadRecord(l);
    if (tier !== 'high') return;
    used.add(id);
    actions.push({
      label: `Advance ${companyTitle(l)} — next pipeline step`,
      leadId: id,
      leadName: displayLeadName(l),
      href: `/focus?leadId=${encodeURIComponent(id)}`,
      actionType: 'advance_stage',
    });
  });

  if (total < 20) {
    actions.push({
      label: 'Add prospects — find more leads',
      leadId: '',
      leadName: '',
      href: '/find?preset=icp',
      actionType: 'add_prospects',
    });
  }

  if ((snapshot.scheduledSearchesCount || 0) === 0 && total < 40) {
    actions.push({
      label: 'Schedule a recurring maps search',
      leadId: '',
      leadName: '',
      href: '/prospecting?tab=queue',
      actionType: 'schedule_run',
    });
  }

  return actions.slice(0, 14);
}

function pickQuoteForDate(isoDate) {
  const day = isoDate.slice(8, 10);
  const m = isoDate.slice(5, 7);
  const idx = (parseInt(m, 10) * 31 + parseInt(day, 10)) % ENTREPRENEUR_QUOTES.length;
  return ENTREPRENEUR_QUOTES[idx];
}

/**
 * @param {import('express').Request} req
 */
async function buildOutreachCoachSnapshot(req) {
  const email = userEmail(req);
  const today = new Date().toISOString().slice(0, 10);
  const touchGoal = dailyPersonalizedTouchGoal();
  const wid = req.workspaceId || 'default';

  const all = await dbService.getAllLeads();
  const leads = filterLeadsForRequest(req, all);

  const allSchedules = await dbService.listSchedules();
  const scheduledSearchesCount = allSchedules.filter((s) => (s.workspaceId || 'default') === wid).length;

  const touchesToday = countUniqueLeadsTouchedOnUtcDate(leads, today);

  const history60 = await dbService.listDailyTrackers(email, 62);
  const streak = computeOutreachStreak(history60, today);

  const stageCounts = {};
  for (let i = 1; i <= 10; i += 1) stageCounts[i] = 0;

  let warmInbound = 0;
  let oppHigh = 0;
  let oppMed = 0;
  let oppLow = 0;

  for (const l of leads) {
    const ps = parseInt(l.pipelineStage, 10);
    const id = !Number.isNaN(ps) && ps >= 1 && ps <= 10 ? ps : 1;
    stageCounts[id] += 1;
    if (l.source && String(l.source).startsWith('adhello_')) warmInbound += 1;
    const { tier } = scoreLeadRecord(l);
    if (tier === 'high') oppHigh += 1;
    else if (tier === 'medium') oppMed += 1;
    else oppLow += 1;
  }

  const inNewOrContacted = (stageCounts[1] || 0) + (stageCounts[2] || 0);
  const inEngagedCqi = (stageCounts[3] || 0) + (stageCounts[4] || 0);
  let inClosing = 0;
  for (let s = 6; s <= 10; s += 1) inClosing += stageCounts[s] || 0;

  const stageBreakdown = PIPELINE_STAGES.map((s) => ({
    id: s.id,
    slug: s.slug,
    name: s.name,
    count: stageCounts[s.id] || 0,
  }));

  return {
    date: today,
    firstName: firstNameFromUser(req.user),
    touchGoal,
    touchesToday,
    streak,
    totalLeads: leads.length,
    warmInbound,
    inNewOrContacted,
    inEngagedCqi,
    inClosing,
    stageCounts,
    stageBreakdown,
    opportunityTiers: { high: oppHigh, medium: oppMed, low: oppLow },
    repliesLoggedApprox: countReplySignals(leads),
    overdueSequences: countOverdueSequences(leads),
    scheduledSearchesCount,
    entrepreneurQuote: pickQuoteForDate(today),
  };
}

module.exports = {
  buildOutreachCoachSnapshot,
  buildNamedCoachActions,
  ENTREPRENEUR_QUOTES,
};
