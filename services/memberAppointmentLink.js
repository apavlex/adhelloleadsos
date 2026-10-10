/**
 * Link a referral-network member to an agency appointment package so the
 * member app can show the contractor portal (tracker, form leads, packages).
 */
const appointmentPackages = require('./appointmentPackages');

function str(v) {
  return String(v == null ? '' : v).trim();
}

function normName(v) {
  return str(v).toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
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

module.exports = {
  findPackageForMember,
  normName,
};
