/**
 * Built-in SOP seeds + normalize helpers.
 * Workspace copies live in KV (see database list/save/delete WorkspaceSop).
 */

const BUILTIN_SOPS = [
  {
    id: 'inbound-new-leads',
    title: 'Responding to New Inbound Leads',
    purpose: 'Contact qualified inbound leads quickly and consistently.',
    owner: 'Sales Development Representative (SDR)',
    trigger: 'A new lead is assigned in the CRM.',
    successMeasure: 'First response time under 15 minutes; all activities logged in CRM.',
    relatedPaths: [
      { href: '/leads?source=inbound', label: 'Inbound leads' },
      { href: '/focus?channel=call', label: 'Focus · Call' },
      { href: '/sequences', label: 'Cadence playbooks' },
      { href: '/scripts', label: 'Script library' },
    ],
    steps: [
      'Review the lead’s company, role, source, and submitted information.',
      'Contact the lead within 15 minutes during business hours.',
      'Make one call and send a personalized email.',
      'Log all activity in the CRM.',
      'If there is no response, follow the approved 7-day follow-up cadence.',
      'Qualify interested leads using the discovery checklist.',
      'Book a meeting with an Account Executive or mark the lead as not qualified.',
    ],
  },
];

function slugifySopId(title) {
  const base = String(title || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return base || `sop-${Date.now().toString(36)}`;
}

function newSopId(title) {
  const slug = slugifySopId(title);
  const suffix = Math.random().toString(36).slice(2, 7);
  return `${slug}-${suffix}`;
}

function normalizeRelatedPaths(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const href = String(item.href || '').trim();
      const label = String(item.label || '').trim();
      if (!href || !label) return null;
      if (!href.startsWith('/') && !/^https?:\/\//i.test(href)) return null;
      return { href: href.slice(0, 500), label: label.slice(0, 80) };
    })
    .filter(Boolean)
    .slice(0, 12);
}

function normalizeSteps(raw) {
  let lines = [];
  if (Array.isArray(raw)) {
    lines = raw.map((s) => String(s || '').trim());
  } else {
    lines = String(raw || '')
      .split(/\r?\n/)
      .map((s) => s.replace(/^\s*\d+[.)]\s*/, '').trim());
  }
  return lines.filter(Boolean).slice(0, 40);
}

function normalizeSop(input, opts) {
  opts = opts || {};
  const now = new Date().toISOString();
  const title = String((input && input.title) || '')
    .trim()
    .slice(0, 160);
  if (!title) throw new Error('Title is required.');
  let id = String((input && input.id) || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  if (!id) id = newSopId(title);
  const steps = normalizeSteps(input && input.steps);
  if (!steps.length) throw new Error('Add at least one step.');
  return {
    id,
    title,
    purpose: String((input && input.purpose) || '')
      .trim()
      .slice(0, 400),
    owner: String((input && input.owner) || '')
      .trim()
      .slice(0, 120),
    trigger: String((input && input.trigger) || '')
      .trim()
      .slice(0, 400),
    successMeasure: String((input && input.successMeasure) || '')
      .trim()
      .slice(0, 400),
    relatedPaths: normalizeRelatedPaths(input && input.relatedPaths),
    steps,
    builtin: !!(input && input.builtin),
    createdAt: (input && input.createdAt) || now,
    updatedAt: now,
    updatedBy: opts.updatedBy ? String(opts.updatedBy).trim().slice(0, 320) : undefined,
  };
}

function listBuiltinSops() {
  return BUILTIN_SOPS.map((s) => normalizeSop({ ...s, builtin: true }));
}

function getBuiltinSopById(id) {
  const key = String(id || '')
    .trim()
    .toLowerCase();
  const hit = BUILTIN_SOPS.find((s) => s.id === key);
  return hit ? normalizeSop({ ...hit, builtin: true }) : null;
}

module.exports = {
  BUILTIN_SOPS,
  listBuiltinSops,
  getBuiltinSopById,
  normalizeSop,
  normalizeSteps,
  newSopId,
  slugifySopId,
};
