/**
 * Link a published Directory listing to a Reviews-app network member.
 * Used for profile lead forms and public review-page URLs on HomeElk / custom domains.
 */
const networkStore = require('./networkStore');
const memberAppointmentLink = require('./memberAppointmentLink');
const appointmentPackages = require('./appointmentPackages');
const reviewPage = require('./reviewPage');
const { getReviewPageUrl } = require('../lib/publicBaseUrl');

function clean(v, max = 500) {
  return String(v == null ? '' : v)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function normName(v) {
  return clean(v, 160)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function namesMatch(a, b) {
  const left = normName(a);
  const right = normName(b);
  if (!left || !right) return false;
  return left === right || left.includes(right) || right.includes(left);
}

/**
 * Prefer explicit listing.memberId → leadKey → package → company name.
 * Persist memberId from Directory so form leads / push hit the right biz app.
 * @returns {Promise<{ network, member, match, package? }|null>}
 */
async function resolveMemberForListing(workspaceId, listing) {
  const wid = clean(workspaceId, 80);
  if (!wid || !listing) return null;
  const network = await networkStore.getNetworkForWorkspace(wid);
  if (!network) return null;

  const memberId = clean(listing.memberId, 80);
  if (memberId) {
    try {
      const byId = await networkStore.getMember(network.id, memberId);
      if (byId && byId.status !== 'paused') {
        return { network, member: byId, match: 'member_id' };
      }
    } catch (_) {
      /* fall through to soft match */
    }
  }

  const leadKey = clean(listing.leadKey, 200);
  if (leadKey) {
    const byLead = await networkStore.findMemberByLeadKey(network.id, leadKey);
    if (byLead && byLead.status !== 'paused') {
      return { network, member: byLead, match: 'lead_key' };
    }
  }

  try {
    const packages = await appointmentPackages.listPackages(wid);
    let pkg = null;
    if (leadKey) {
      pkg = packages.find((p) => clean(p.leadKey, 200) === leadKey) || null;
    }
    if (!pkg) {
      pkg = packages.find((p) => namesMatch(p.businessName, listing.name)) || null;
    }
    if (pkg) {
      const linked = await memberAppointmentLink.findMemberForPackage(wid, pkg);
      if (linked && linked.member && linked.network) {
        return { network: linked.network, member: linked.member, match: 'package', package: pkg };
      }
    }
  } catch (_) {
    /* ignore package lookup failures */
  }

  const members = await networkStore.listMembers(network.id);
  const hit = members.find(
    (m) => m && m.status !== 'paused' && namesMatch(m.companyName, listing.name),
  );
  if (hit) return { network, member: hit, match: 'company_name' };

  return null;
}

/**
 * Fast feed enrichment: one members list, match by leadKey then company name.
 * Skips appointment-package lookup (detail pages still use full resolve).
 */
async function reviewFieldsByListingId(workspaceId, listings) {
  const wid = clean(workspaceId, 80);
  const rows = Array.isArray(listings) ? listings : [];
  const out = new Map();
  if (!wid || !rows.length) return out;

  let network = null;
  let members = [];
  try {
    network = await networkStore.getNetworkForWorkspace(wid);
    if (network) members = await networkStore.listMembers(network.id);
  } catch (_) {
    return out;
  }
  if (!network || !members.length) return out;

  const active = members.filter((m) => m && m.status !== 'paused');
  const byId = new Map();
  const byLead = new Map();
  for (const m of active) {
    const mid = clean(m.id, 80);
    if (mid) byId.set(mid, m);
    const key = clean(m.leadKey, 200);
    if (key && !byLead.has(key)) byLead.set(key, m);
  }

  for (const listing of rows) {
    if (!listing || !listing.id) continue;
    const linkedId = clean(listing.memberId, 80);
    let member = linkedId ? byId.get(linkedId) : null;
    if (!member) {
      const leadKey = clean(listing.leadKey, 200);
      member = leadKey ? byLead.get(leadKey) : null;
    }
    if (!member) {
      member = active.find((m) => namesMatch(m.companyName, listing.name)) || null;
    }
    const pack = publicReviewFields(member);
    if (pack.review_page_url) out.set(listing.id, pack);
  }
  return out;
}

/** Label for Directory member picker. */
function memberPickerLabel(member) {
  if (!member) return '';
  const company = clean(member.companyName || member.businessName || member.name, 160);
  const person = clean(member.contactName || member.firstName, 80);
  if (company && person) return `${company} (${person})`;
  return company || person || clean(member.id, 80);
}

/**
 * Public fields for Directory / HomeElk: Reviews page + platform links from the app.
 */
function publicReviewFields(member) {
  const m = member && typeof member === 'object' ? member : null;
  const slug = clean(m && m.reviewSlug, 80);
  const pageUrl = slug ? getReviewPageUrl(slug) : '';
  if (!pageUrl) {
    return {
      review_page_url: '',
      review_slug: '',
      review_links: [],
      review_link_count: 0,
    };
  }
  const destinations = reviewPage.reviewDestinations(m.reviewLinks, slug);
  const review_links = destinations.map((d) => ({
    key: d.key,
    label: d.label,
    url: d.url,
  }));
  return {
    review_page_url: pageUrl,
    review_slug: slug,
    review_links,
    review_link_count: review_links.length,
  };
}

async function publicReviewFieldsForListing(workspaceId, listing) {
  const linked = await resolveMemberForListing(workspaceId, listing);
  return {
    ...publicReviewFields(linked && linked.member),
    matched: !!(linked && linked.member),
    match: (linked && linked.match) || '',
  };
}

/**
 * Footer / OG “powered by” for public review pages.
 * Uses the workspace Directory live site (e.g. homeelk.com) when set.
 */
async function poweredByForWorkspace(workspaceId) {
  const wid = clean(workspaceId, 80);
  const fallback = { label: 'homeelk.com', href: 'https://homeelk.com' };
  if (!wid) return fallback;
  try {
    const directoryStore = require('./directoryStore');
    const { originFromPageUrl } = require('./directoryPagePrompt');
    const bundle = await directoryStore.load(wid, { normalize: false });
    const pageUrl = clean(bundle && bundle.settings && bundle.settings.pageUrl, 400);
    const origin = originFromPageUrl(pageUrl);
    if (!origin) return fallback;
    let hostname = '';
    try {
      hostname = new URL(origin).hostname.replace(/^www\./i, '');
    } catch (_) {
      hostname = String(origin)
        .replace(/^https?:\/\//i, '')
        .replace(/^www\./i, '')
        .split('/')[0];
    }
    if (!hostname) return fallback;
    return { label: hostname, href: origin.startsWith('http') ? origin : `https://${hostname}` };
  } catch (_) {
    return fallback;
  }
}

async function poweredByForNetwork(network) {
  return poweredByForWorkspace(network && network.ownerWorkspaceId);
}

module.exports = {
  clean,
  namesMatch,
  resolveMemberForListing,
  publicReviewFields,
  publicReviewFieldsForListing,
  reviewFieldsByListingId,
  memberPickerLabel,
  poweredByForWorkspace,
  poweredByForNetwork,
};
