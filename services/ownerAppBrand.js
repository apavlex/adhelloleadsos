/**
 * Owner Referral app branding overlays Workspace → White-label
 * (app name, logo, accent) onto the member PWA for the workspace owner.
 * Partner members keep Network → App branding.
 */
const dbService = require('./database');
const whiteLabel = require('./whiteLabel');
const networkBrand = require('./networkBrand');
const networkStore = require('./networkStore');

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

/**
 * Owner-only: update Workspace → White label from the member app Profile.
 * Logo also mirrors onto the network brand so Home’s badge stays in sync.
 *
 * @param {{ appName?: string, logoBuffer?: Buffer|null, removeLogo?: boolean }} patch
 */
async function saveOwnerWorkspaceBranding(network, member, patch = {}) {
  if (!network || !network.ownerWorkspaceId) {
    return { ok: false, error: 'No workspace is linked to this app.' };
  }
  if (!isOwnerMember(member, network)) {
    return { ok: false, error: 'Only the workspace owner can edit app branding.' };
  }
  const wid = network.ownerWorkspaceId;
  const ws = await dbService.getWorkspace(wid);
  if (!ws) return { ok: false, error: 'Workspace not found.' };

  const next = whiteLabel.settings(ws);
  if (Object.prototype.hasOwnProperty.call(patch, 'appName')) {
    next.appName = whiteLabel.cleanAppName(patch.appName);
  }
  if (patch.removeLogo) {
    await whiteLabel.deleteLogo(wid);
    next.logoVersion = '';
  } else if (patch.logoBuffer && Buffer.isBuffer(patch.logoBuffer) && patch.logoBuffer.length) {
    next.logoVersion = await whiteLabel.saveLogo(wid, patch.logoBuffer);
  }

  await dbService.saveWorkspace(wid, { ...ws, whiteLabel: next });

  // Keep Network brand logo aligned so Home badge + partners see the same mark.
  const brand = { ...(network.brand || {}) };
  if (patch.removeLogo) {
    brand.logoUrl = '';
    await networkStore.deleteBrandImage(network.id, 'logo').catch(() => null);
  } else if (patch.logoBuffer && Buffer.isBuffer(patch.logoBuffer) && patch.logoBuffer.length) {
    const prepared = await networkBrand.prepareImage('logo', patch.logoBuffer);
    const stamp = await networkStore.saveBrandImage(network.id, 'logo', prepared);
    brand.logoUrl = `/m/brand/${network.id}/logo?v=${Date.parse(stamp) || Date.now()}`;
  }
  if (next.appName) {
    brand.appName = next.appName;
  }
  const savedNet = await networkStore.saveNetwork({ ...network, brand });
  const brandView = whiteLabel.brandForWorkspace({ ...ws, id: wid, whiteLabel: next });
  return { ok: true, workspace: { ...ws, id: wid, whiteLabel: next }, network: savedNet, brand: brandView };
}

module.exports = {
  isOwnerMember,
  applyWorkspaceBrand,
  workspaceLogoForBrand,
  saveOwnerWorkspaceBranding,
};
