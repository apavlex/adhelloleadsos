/**
 * Role bots for the AdHello business ops layer (Bops-style operators).
 * Each role owns a clear job set and writes into AdHello as system of record.
 */

const ROLES = [
  {
    id: 'prospect',
    name: 'Prospect',
    title: 'Prospect SDR',
    blurb: 'Preps early-stage prospects for your call queue and next touch.',
    color: '#2563eb',
    defaultJob: 'prospect.prepare',
    jobs: ['prospect.prepare', 'sdr.prepare_focus'],
  },
  {
    id: 'opportunity',
    name: 'Opportunity',
    title: 'Opportunity SDR',
    blurb: 'Reviews opportunity boards and picks the top deals to move next.',
    color: '#f26b1d',
    defaultJob: 'opportunity.scan_board',
    jobs: ['opportunity.scan_board', 'review.scan'],
  },
  {
    id: 'dispatcher',
    name: 'Dispatcher',
    title: 'Dispatcher',
    blurb: 'Watches the referral pool and appointment leftovers.',
    color: '#059669',
    defaultJob: 'dispatcher.scan_pool',
    jobs: ['dispatcher.scan_pool'],
  },
  {
    id: 'ops',
    name: 'Ops',
    title: 'Ops bot',
    blurb: 'Checks GHL sync, messaging readiness, and failed jobs.',
    color: '#7c3aed',
    defaultJob: 'ops.health',
    jobs: ['ops.health'],
  },
];

const ROLE_BY_ID = Object.fromEntries(ROLES.map((r) => [r.id, r]));

const JOB_LABELS = {
  'prospect.prepare': 'Prepare prospect queue',
  'sdr.prepare_focus': 'Prepare prospect queue',
  'opportunity.scan_board': 'Scan opportunity board',
  'review.scan': 'Scan opportunity board',
  'dispatcher.scan_pool': 'Scan referral pool',
  'ops.health': 'Ops health check',
};

/** Legacy role ids → current ids (settings / insights migration). */
const LEGACY_ROLE_IDS = {
  sdr: 'prospect',
  review: 'opportunity',
};

function normalizeRoleId(roleId) {
  const id = String(roleId || '').trim();
  return LEGACY_ROLE_IDS[id] || id;
}

function roleForJob(jobType) {
  const type = String(jobType || '');
  return ROLES.find((r) => r.jobs.includes(type)) || null;
}

function listRoles() {
  return ROLES.map((r) => ({ ...r, jobLabel: JOB_LABELS[r.defaultJob] || r.defaultJob }));
}

module.exports = {
  ROLES,
  ROLE_BY_ID,
  JOB_LABELS,
  LEGACY_ROLE_IDS,
  normalizeRoleId,
  roleForJob,
  listRoles,
};
