/**
 * Workspace Today: lead inventory by source
 * (website forms, agency deliveries, network referrals, purchased appointments left).
 */
const appointmentPackages = require('./appointmentPackages');
const networkStore = require('./networkStore');
const { pendingInboundItems } = require('./inboundEvents');

function formLeadChannel(lead) {
  const s = String((lead && lead.source) || '').toLowerCase();
  if (s === 'agency') return 'agency';
  return 'website';
}

/**
 * @param {object} opts
 * @param {string} opts.workspaceId
 * @param {object[]} [opts.leads] — workspace CRM leads (for inbound website forms)
 * @param {object} [opts.apptView] — from appointmentPackages.loadTodayView (optional preloaded)
 */
async function buildOverview({ workspaceId, leads, apptView } = {}) {
  const wid = String(workspaceId || '');
  const view = apptView || (wid ? await appointmentPackages.loadTodayView(wid) : null);
  const packages = view && Array.isArray(view.packages) ? view.packages : [];
  const totals = (view && view.totals) || {};

  let websiteOpen = 0;
  let agencyOpen = 0;
  packages.forEach((pkg) => {
    const forms = Array.isArray(pkg.formLeads) ? pkg.formLeads : [];
    forms.forEach((f) => {
      if (!f || f.status === 'closed') return;
      if (formLeadChannel(f) === 'agency') agencyOpen += 1;
      else websiteOpen += 1;
    });
  });

  // CRM inbound form fills that still need a follow-up.
  const inboundForms = pendingInboundItems(leads || [], { limit: 100 })
    .filter((row) => row && row.type === 'form').length;
  websiteOpen += inboundForms;

  let referralPending = 0;
  let poolOpen = 0;
  if (wid) {
    try {
      const network = await networkStore.getOrCreateNetworkForWorkspace(wid, {});
      const referrals = await networkStore.listReferrals(network.id);
      referralPending = referrals.filter((r) => r && (r.status === 'sent' || r.status === 'unrouted')).length;
      poolOpen = referrals.filter((r) => r && r.status === 'unrouted').length;
    } catch (_) {
      /* network optional */
    }
  }

  const purchasedLeft = Number(totals.remaining) || 0;
  const creditsLeft = Number(totals.leadCreditsLeft) || 0;
  const needYou = websiteOpen + agencyOpen + referralPending;

  const sources = [
    {
      key: 'website',
      label: 'Website',
      count: websiteOpen,
      href: '/appointments',
      hint: inboundForms ? `${inboundForms} inbound` : 'Form fills',
    },
    {
      key: 'agency',
      label: 'Agency',
      count: agencyOpen,
      href: '/appointments',
      hint: 'Assigned out',
    },
    {
      key: 'referral',
      label: 'Referrals',
      count: referralPending,
      href: '/network',
      hint: poolOpen ? `${poolOpen} in pool` : 'Network',
    },
    {
      key: 'purchased',
      label: 'Purchased',
      count: purchasedLeft,
      href: '/appointments',
      hint: creditsLeft ? `${creditsLeft} credits` : 'Appts left',
    },
  ];

  return {
    needYou,
    sources,
    websiteCount: websiteOpen,
    agencyCount: agencyOpen,
    referralCount: referralPending,
    purchasedLeft,
    creditsLeft,
    poolOpen,
  };
}

module.exports = {
  formLeadChannel,
  buildOverview,
};
