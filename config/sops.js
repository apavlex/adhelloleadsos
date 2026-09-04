/**
 * Built-in sales SOPs shown at /sops.
 * Keep copy operational — short steps SDRs can follow during a shift.
 */

const SOPS = [
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

function listSops() {
  return SOPS.map((s) => ({
    id: s.id,
    title: s.title,
    purpose: s.purpose,
    owner: s.owner,
    trigger: s.trigger,
  }));
}

function getSopById(id) {
  const key = String(id || '')
    .trim()
    .toLowerCase();
  return SOPS.find((s) => s.id === key) || null;
}

module.exports = {
  SOPS,
  listSops,
  getSopById,
};
