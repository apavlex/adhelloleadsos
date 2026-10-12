/**
 * Link a referral-network member to an agency appointment package so the
 * member app can show the contractor portal (tracker, form leads, packages)
 * and the contractor can reach review requests from the same partner app.
 *
 * Workspace owners still get website/agency form leads in /m even when the
 * network has no referral partners yet (owner-only network).
 */
const appointmentPackages = require('./appointmentPackages');
const networkStore = require('./networkStore');

/** Same id as services/ownerReferralApp.OWNER_MEMBER_ID */
const OWNER_MEMBER_ID = 'owner';

function str(v) {
  return String(v == null ? '' : v).trim();
}

function normName(v) {
  return str(v).toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function isOwnerMember(member, network) {
  if (!member || !member.id) return false;
  if (String(member.id) === OWNER_MEMBER_ID) return true;
  const email = str(member.email).toLowerCase();
  const ownerEmail = str(network && network.ownerEmail).toLowerCase();
  return !!(email && ownerEmail && email === ownerEmail);
}

function portalPackages(packages) {
  return (packages || []).filter((p) => p && p.portalEnabled !== false);
}

/** Prefer a package that already has open form leads; else most recently updated. */
function pickOwnerPackageFallback(packages) {
  const portal = portalPackages(packages);
  if (!portal.length) return null;
  if (portal.length === 1) return portal[0];
  const withOpen = portal.filter((p) => (p.formLeads || []).some((f) => f && f.status !== 'closed'));
  const pool = withOpen.length ? withOpen : portal.filter((p) => (p.formLeads || []).length);
  const ranked = (pool.length ? pool : portal).slice().sort((a, b) =>
    String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')),
  );
  return ranked[0] || null;
}

function memberMatchesPackage(member, pkg) {
  const m = member && typeof member === 'object' ? member : {};
  const p = pkg && typeof pkg === 'object' ? pkg : {};
  const pkgId = str(p.id);
  if (!pkgId) return false;

  const byId = str(m.appointmentPackageId);
  if (byId && byId === pkgId) return true;

  const leadKey = str(m.leadKey);
  if (leadKey && leadKey === str(p.leadKey)) return true;

  const email = str(m.email).toLowerCase();
  if (email && email === str(p.contactEmail).toLowerCase()) return true;

  const company = normName(m.companyName);
  const biz = normName(p.businessName);
  if (company && biz && (biz === company || biz.includes(company) || company.includes(biz))) {
    return true;
  }
  return false;
}

/**
 * Find the appointment package for a network member in the network's workspace.
 * Match order: explicit appointmentPackageId → leadKey → email → company/business name.
 * Workspace owner (id `owner`) falls back to a portal package so website leads
 * still show when there are no referral partners to match against.
 */
async function findPackageForMember(workspaceId, member, network = null) {
  const wid = str(workspaceId);
  const m = member && typeof member === 'object' ? member : {};
  if (!wid) return null;

  const packages = await appointmentPackages.listPackages(wid);
  if (!packages.length) return null;

  const byId = str(m.appointmentPackageId);
  if (byId) {
    const hit = packages.find((p) => p.id === byId);
    if (hit) return hit;
  }

  const leadKey = str(m.leadKey);
  if (leadKey) {
    const hit = packages.find((p) => str(p.leadKey) && str(p.leadKey) === leadKey);
    if (hit) return hit;
  }

  const email = str(m.email).toLowerCase();
  if (email) {
    const hit = packages.find((p) => str(p.contactEmail).toLowerCase() === email);
    if (hit) return hit;
  }

  const company = normName(m.companyName);
  if (company) {
    const hit = packages.find((p) => {
      const biz = normName(p.businessName);
      return biz && (biz === company || biz.includes(company) || company.includes(biz));
    });
    if (hit) return hit;
  }

  let net = network;
  if (!net) {
    try { net = await networkStore.getNetworkForWorkspace(wid); } catch { net = null; }
  }
  if (isOwnerMember(m, net)) {
    return pickOwnerPackageFallback(packages);
  }

  return null;
}

/**
 * All website/agency form leads across portal packages (newest first).
 * Used so a workspace owner with no partners still sees every form lead in /m.
 */
async function listOwnerFormLeads(workspaceId, { limit = 40 } = {}) {
  const wid = str(workspaceId);
  if (!wid) return [];
  const packages = portalPackages(await appointmentPackages.listPackages(wid));
  const leads = [];
  for (const pkg of packages) {
    for (const lead of pkg.formLeads || []) {
      if (!lead) continue;
      leads.push({
        ...lead,
        packageId: pkg.id,
        packageName: pkg.businessName || '',
      });
    }
  }
  leads.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
  return leads.slice(0, Math.max(1, Math.min(200, limit)));
}

/** True when the network has no active non-owner partners. */
async function networkHasReferralPartners(network) {
  if (!network || !network.id) return false;
  const members = await networkStore.listMembers(network.id);
  return members.some((m) => m && m.status !== 'paused' && !isOwnerMember(m, network));
}

/**
 * Reverse lookup: network member linked to an appointment package (for review-app links).
 * When the network has no referral partners, fall back to the workspace owner member
 * so form-lead SMS/push still reach the owner app.
 */
async function findMemberForPackage(workspaceId, pkg) {
  const wid = str(workspaceId);
  if (!wid || !pkg) return null;
  const network = await networkStore.getNetworkForWorkspace(wid);
  if (!network) return null;
  const members = await networkStore.listMembers(network.id);
  const active = members.filter((m) => m && m.status !== 'paused');
  const hit = active.find((m) => memberMatchesPackage(m, pkg));
  if (hit) return { network, member: hit };

  const hasPartners = active.some((m) => !isOwnerMember(m, network));
  if (!hasPartners) {
    const owner = active.find((m) => isOwnerMember(m, network));
    if (owner) return { network, member: owner };
  }
  return null;
}

/**
 * Partner rows for workspace Get-the-app: each active network member who can
 * open the review-request app (/m), optionally with a linked appointment package.
 */
async function listPartnerAppsForWorkspace(workspaceId) {
  const wid = str(workspaceId);
  if (!wid) return { network: null, partners: [] };
  const network = await networkStore.getNetworkForWorkspace(wid);
  if (!network) return { network: null, partners: [] };
  const members = await networkStore.listMembers(network.id);
  const packages = await appointmentPackages.listPackages(wid);
  const partners = members
    .filter((m) => m && m.status !== 'paused')
    .map((m) => {
      const pkg = packages.find((p) => memberMatchesPackage(m, p)) || null;
      return {
        memberId: m.id,
        companyName: m.companyName || 'Partner',
        contactName: m.contactName || null,
        phone: m.phone || null,
        email: m.email || null,
        packageId: pkg ? pkg.id : (str(m.appointmentPackageId) || null),
        packageName: pkg ? pkg.businessName : null,
        hasReviewApp: true,
      };
    })
    .sort((a, b) => String(a.companyName).localeCompare(String(b.companyName)));
  return { network, partners };
}

module.exports = {
  OWNER_MEMBER_ID,
  isOwnerMember,
  findPackageForMember,
  findMemberForPackage,
  listPartnerAppsForWorkspace,
  listOwnerFormLeads,
  networkHasReferralPartners,
  pickOwnerPackageFallback,
  memberMatchesPackage,
  normName,
};
