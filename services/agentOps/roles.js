/**
 * Role bots for the AdHello business ops layer (Bops-style operators).
 * Each role owns a clear job set and writes into AdHello as system of record.
 */

const ROLES = [
  {
    id: 'sdr',
    name: 'SDR',
    title: 'Focus SDR',
    blurb: 'Preps your call queue, scripts, and next-touch tasks.',
    color: '#2563eb',
    defaultJob: 'sdr.prepare_focus',
    jobs: ['sdr.prepare_focus'],
  },
  {
    id: 'review',
    name: 'Review',
    title: 'Review bot',
    blurb: 'Finds customers ready for a review ask and queues requests.',
    color: '#f26b1d',
    defaultJob: 'review.scan',
    jobs: ['review.scan', 'review.request'],
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
  'sdr.prepare_focus': 'Prepare Focus queue',
  'review.scan': 'Scan for review asks',
  'review.request': 'Send review request',
  'dispatcher.scan_pool': 'Scan referral pool',
  'ops.health': 'Ops health check',
};

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
  roleForJob,
  listRoles,
};
