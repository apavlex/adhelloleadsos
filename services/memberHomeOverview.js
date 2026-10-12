/**
 * Member-app Home overview: one “need you” count + breakdown by source
 * (website forms, agency deliveries, network referrals, purchased left).
 */

function formLeadChannel(lead) {
  const s = String((lead && lead.source) || '').toLowerCase();
  if (s === 'agency') return 'agency';
  return 'website';
}

function sortByAtDesc(a, b) {
  return Date.parse((b && b.at) || 0) - Date.parse((a && a.at) || 0);
}

/**
 * @param {object} opts
 * @param {string} opts.base — /m/:token
 * @param {object|null} opts.appointment — from attachAppointment
 * @param {object[]} opts.referrals — raw network referrals
 * @param {string} opts.memberId
 * @param {function} [opts.presentReferral] — maps raw referral → { title, body, when, … }
 */
function buildOverview({
  base,
  appointment,
  referrals,
  memberId,
  presentReferral,
} = {}) {
  const pathBase = String(base || '').replace(/\/+$/, '') || '/m';
  const leadsHref = `${pathBase}/referrals`;
  const formLeads = appointment && Array.isArray(appointment.formLeads)
    ? appointment.formLeads
    : [];
  const openForm = formLeads.filter((f) => f && f.status !== 'closed');
  const website = openForm.filter((f) => formLeadChannel(f) === 'website');
  const agency = openForm.filter((f) => formLeadChannel(f) === 'agency');

  const pendingRefs = (Array.isArray(referrals) ? referrals : []).filter(
    (r) => r && r.toMemberId === memberId && r.status === 'sent',
  );
  const poolOpen = (Array.isArray(referrals) ? referrals : []).filter(
    (r) => r && r.status === 'unrouted',
  ).length;

  const apptsLeft = appointment && appointment.tracker && appointment.tracker.counts
    ? Number(appointment.tracker.counts.remaining) || 0
    : 0;
  const creditsLeft = appointment && appointment.leadCredits
    ? Number(appointment.leadCredits.remaining) || 0
    : 0;

  const needYou = website.length + agency.length + pendingRefs.length;

  const sources = [
    {
      key: 'website',
      label: 'Website',
      count: website.length,
      href: `${leadsHref}?source=website`,
      hint: 'Form fills',
    },
    {
      key: 'agency',
      label: 'Agency',
      count: agency.length,
      href: `${leadsHref}?source=agency`,
      hint: 'Assigned to you',
    },
    {
      key: 'referral',
      label: 'Referrals',
      count: pendingRefs.length,
      href: `${leadsHref}?source=referral`,
      hint: poolOpen ? `${poolOpen} in pool` : 'Network',
    },
    {
      key: 'purchased',
      label: 'Purchased',
      count: apptsLeft,
      href: appointment && appointment.portalPath
        ? appointment.portalPath
        : `${leadsHref}?source=purchased`,
      hint: creditsLeft ? `${creditsLeft} credits` : 'Appts left',
    },
  ];

  const attention = [];

  openForm.forEach((lead) => {
    const ch = formLeadChannel(lead);
    attention.push({
      id: `lead:${lead.id}`,
      kind: ch,
      title: lead.name || 'Lead',
      body: ch === 'agency'
        ? (lead.formName || 'Agency lead')
        : (lead.formName || 'Website form'),
      href: `${leadsHref}?source=${ch}#lead-${encodeURIComponent(lead.id)}`,
      at: lead.at || '',
      pill: ch === 'agency' ? 'Agency' : 'Website',
      pillClass: ch === 'agency' ? 'ma-pill--sent' : 'ma-pill--accepted',
    });
  });

  pendingRefs.forEach((r) => {
    const presented = typeof presentReferral === 'function' ? presentReferral(r) : null;
    const customer = (presented && presented.customer) || (r && r.homeowner) || {};
    const title = (presented && presented.customer && presented.customer.name)
      || customer.name
      || 'Referral';
    const trade = (presented && presented.trade) || r.tradeSlug || 'Job';
    const from = (presented && presented.from) || 'Partner';
    attention.push({
      id: `ref:${r.id}`,
      kind: 'referral',
      title,
      body: `Referral · ${trade} · from ${from}`,
      href: `${leadsHref}?source=referral#ref-${encodeURIComponent(r.id)}`,
      at: r.createdAt || r.updatedAt || '',
      pill: 'Referral',
      pillClass: 'ma-pill--sent',
    });
  });

  attention.sort(sortByAtDesc);

  return {
    needYou,
    sources,
    attention: attention.slice(0, 10),
    websiteCount: website.length,
    agencyCount: agency.length,
    referralCount: pendingRefs.length,
    purchasedLeft: apptsLeft,
    creditsLeft,
    poolOpen,
    leadsHref,
  };
}

/** Filter Leads & Referrals lists by ?source= */
function filterBySource(source, { formLeads, received } = {}) {
  const s = String(source || '').toLowerCase();
  const forms = Array.isArray(formLeads) ? formLeads : [];
  const refs = Array.isArray(received) ? received : [];
  if (s === 'website') {
    return {
      formLeads: forms.filter((f) => formLeadChannel(f) === 'website'),
      received: [],
      sourceFilter: s,
    };
  }
  if (s === 'agency') {
    return {
      formLeads: forms.filter((f) => formLeadChannel(f) === 'agency'),
      received: [],
      sourceFilter: s,
    };
  }
  if (s === 'referral') {
    return {
      formLeads: [],
      received: refs,
      sourceFilter: s,
    };
  }
  if (s === 'purchased') {
    return { formLeads: forms, received: refs, sourceFilter: s };
  }
  return { formLeads: forms, received: refs, sourceFilter: '' };
}

module.exports = {
  formLeadChannel,
  buildOverview,
  filterBySource,
};
