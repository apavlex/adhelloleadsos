/**
 * Owner Referral app branding overlays Workspace → White-label
 * (app name, logo, accent) onto the member PWA for the workspace owner.
 * Partner members keep Network → App branding.
 */
const dbService = require('./database');
const whiteLabel = require('./whiteLabel');
const networkBrand = require('./networkBrand');

/** Same id as services/ownerReferralApp.OWNER_MEMBER_ID */
const OWNER_MEMBER_ID = 'owner';

function cleanName(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, 60);
}

/** True for the stable owner member row (or matching owner email). */
function isOwnerMember(member, network) {
  if (!member || !member.id) return false;
  if (String(member.id) === OWNER_MEMBER_ID) return true;
  const email = String(member.email || '').trim().toLowerCase();
  const ownerEmail = String((network && network.ownerEmail) || '').trim().toLowerCase();
  return !!(email && ownerEmail && email === ownerEmail);
}

/**
 * @param {object} brand — from networkBrand.brandView
 * @param {object} network
 * @param {object} member
 * @returns {Promise<object>} brand with workspace white-label when owner
 */
async function applyWorkspaceBrand(brand, network, member) {
  const base = brand && typeof brand === 'object' ? brand : networkBrand.brandView(network, member);
  if (base.isFreeApp) return base;
  if (!network || !network.ownerWorkspaceId) return base;
  if (!isOwnerMember(member, network)) return base;

  const ws = await dbService.getWorkspace(network.ownerWorkspaceId);
  if (!ws) return base;

  const wl = whiteLabel.brandForWorkspace(ws);
  const businessName =
    cleanName(wl.customName) ||
    cleanName(ws.name) ||
    cleanName(member && member.companyName) ||
    base.appName;
  const accent =
    networkBrand.normalizeHex(ws.accentColor) ||
    base.accent ||
    networkBrand.DEFAULT_ACCENT;
  const onAccent =
    networkBrand.normalizeHex(ws.accentTextColor) ||
    networkBrand.onAccentColor(accent);

  return {
    ...base,
    appName: businessName,
    heroName: businessName,
    shortName: businessName.length <= 12 ? businessName : businessName.split(/\s+/)[0].slice(0, 12),
    accent,
    onAccent,
    logoUrl: wl.hasLogo ? wl.logoUrl : base.logoUrl,
    initials: networkBrand.initials(businessName),
    fromWorkspace: true,
  };
}

/** Load logo buffer for owner icons when brand points at /brand/ws/… */
async function workspaceLogoForBrand(brand, network) {
  if (!brand || !brand.fromWorkspace || !brand.logoUrl) return null;
  if (!network || !network.ownerWorkspaceId) return null;
  if (!String(brand.logoUrl).includes('/brand/ws/')) return null;
  return whiteLabel.getLogo(network.ownerWorkspaceId);
}

module.exports = {
  isOwnerMember,
  applyWorkspaceBrand,
  workspaceLogoForBrand,
};
