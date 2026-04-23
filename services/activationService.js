const dbService = require('./database');

/** @typedef {'d1'|'d2'|'d3'|'d4'|'d5'|'d6'|'d7'} ActivationDay */

const PLAN = [
  {
    id: 'd1',
    label: 'Day 1 — First search',
    hint: 'Run a Maps + Apify lead pull',
    href: '/',
    event: 'search_saved',
  },
  {
    id: 'd2',
    label: 'Day 2 — Import CSV',
    hint: 'Drop enriched or exported leads',
    href: '/prospecting?tab=pipeline',
    event: 'csv_import',
  },
  {
    id: 'd3',
    label: 'Day 3 — Schedule lead runs',
    hint: 'Daily / weekly scrape while you sleep',
    href: '/prospecting?tab=queue',
    event: 'autopilot_scheduled',
  },
  {
    id: 'd4',
    label: 'Day 4 — Start a cadence',
    hint: 'Attach Clay / Paul / Bob cadence to a lead',
    href: '/prospecting?tab=queue',
    event: 'sequence_started',
  },
  {
    id: 'd5',
    label: 'Day 5 — Log outreach',
    hint: 'Streak + discipline in the tracker',
    href: '/prospecting?tab=queue',
    event: 'outreach_logged',
  },
  {
    id: 'd6',
    label: 'Day 6 — Advance the pipeline',
    hint: 'Move a card past New (stage 1)',
    href: '/sales/workflow',
    event: 'pipeline_advanced',
  },
  {
    id: 'd7',
    label: 'Day 7 — Review reports',
    hint: 'See traffic + conversion momentum',
    href: '/reports',
    event: 'analytics_visit',
  },
];

const EVENT_TO_DAY = PLAN.reduce((acc, row) => {
  acc[row.event] = row.id;
  return acc;
}, {});

function emptyState() {
  return {
    version: 1,
    startedAt: null,
    days: {},
    updatedAt: null,
  };
}

async function getState(email) {
  if (!email) return { ...emptyState(), plan: PLAN, progress: 0, total: PLAN.length };
  let s = await dbService.getActivationState(email);
  if (!s || typeof s !== 'object') s = emptyState();
  if (!s.days || typeof s.days !== 'object') s.days = {};
  const done = PLAN.filter((p) => s.days[p.id]).length;
  return {
    ...s,
    plan: PLAN,
    progress: done,
    total: PLAN.length,
  };
}

async function completeDay(email, dayId) {
  if (!email || !/^d[1-7]$/.test(dayId)) return getState(email);
  let s = await dbService.getActivationState(email);
  if (!s || typeof s !== 'object') s = emptyState();
  if (!s.days) s.days = {};
  if (!s.startedAt) s.startedAt = new Date().toISOString();
  s.days[dayId] = { at: new Date().toISOString(), manual: true };
  s.updatedAt = new Date().toISOString();
  await dbService.saveActivationState(email, s);
  return getState(email);
}

/**
 * Record an activation milestone by product event name.
 */
async function recordEvent(email, eventKey) {
  if (!email || !EVENT_TO_DAY[eventKey]) return getState(email);
  const dayId = EVENT_TO_DAY[eventKey];
  let s = await dbService.getActivationState(email);
  if (!s || typeof s !== 'object') s = emptyState();
  if (!s.days) s.days = {};
  if (s.days[dayId]) return getState(email);
  if (!s.startedAt) s.startedAt = new Date().toISOString();
  s.days[dayId] = { at: new Date().toISOString(), event: eventKey };
  s.updatedAt = new Date().toISOString();
  await dbService.saveActivationState(email, s);
  return getState(email);
}

module.exports = {
  PLAN,
  getState,
  completeDay,
  recordEvent,
};
