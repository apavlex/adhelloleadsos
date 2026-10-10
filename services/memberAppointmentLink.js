/**
 * Link a referral-network member to an agency appointment package so the
 * member app can show the contractor portal (tracker, form leads, packages)
 * and the contractor can reach review requests from the same partner app.
 */
const appointmentPackages = require('./appointmentPackages');
const networkStore = require('./networkStore');

function str(v) {
  return String(v == null ? '' : v).trim();
}

function normName(v) {
  return str(v).toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
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
 */
async function findPackageForMember(workspaceId, member) {
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

  return null;
}

/**
 * Reverse lookup: network member linked to an appointment package (for review-app links).
 */
async function findMemberForPackage(workspaceId, pkg) {
  const wid = str(workspaceId);
  if (!wid || !pkg) return null;
  const network = await networkStore.getNetworkForWorkspace(wid);
  if (!network) return null;
  const members = await networkStore.listMembers(network.id);
  const active = members.filter((m) => m && m.status !== 'paused');
  const hit = active.find((m) => memberMatchesPackage(m, pkg));
  if (!hit) return null;
  return { network, member: hit };
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
  findPackageForMember,
  findMemberForPackage,
  listPartnerAppsForWorkspace,
  memberMatchesPackage,
  normName,
};
