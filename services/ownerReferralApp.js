/**
 * Workspace owner's Referral app = the network member app (/m/:token),
 * same PWA partners use (reviews → customers → referrals).
 * Ensures a stable owner member row so Get the app can open/share it.
 */
const networkStore = require('./networkStore');
const networkNotify = require('./networkNotify');
const whiteLabel = require('./whiteLabel');
const { getPublicBaseUrl } = require('../lib/publicBaseUrl');

const OWNER_MEMBER_ID = 'owner';

function firstNameFromUser(user) {
  const raw =
    (user && user.displayName) ||
    (user && user.emails && user.emails[0] && user.emails[0].value) ||
    '';
  return String(raw).trim().split(/\s+/)[0] || '';
}

function ownerBusinessName(ws, network) {
  const wl = whiteLabel.brandForWorkspace(ws || {});
  return (
    (wl.customName && String(wl.customName).trim()) ||
    (ws && ws.name && String(ws.name).trim()) ||
    (network && network.name && String(network.name).trim()) ||
    'My business'
  );
}

/**
 * @returns {Promise<{ network: object, member: object, path: string, url: string }>}
 */
async function ensureOwnerReferralApp(req) {
  const workspaceId = req.workspaceId;
  if (!workspaceId) throw new Error('ensureOwnerReferralApp requires workspaceId');
  const ws = req.workspace || {};
  const email = String(
    (req.user && req.user.emails && req.user.emails[0] && req.user.emails[0].value) ||
      '',
  )
    .trim()
    .toLowerCase();

  const network = await networkStore.getOrCreateNetworkForWorkspace(workspaceId, {
    name: (ws.name && String(ws.name).trim()) || 'Referral network',
    ownerEmail: email,
  });

  let member = await networkStore.getMember(network.id, OWNER_MEMBER_ID);
  if (!member && email) {
    const members = await networkStore.listMembers(network.id);
    member = members.find((m) => String(m.email || '').trim().toLowerCase() === email) || null;
  }

  const companyName = ownerBusinessName(ws, network);
  const contactName = firstNameFromUser(req.user) || '';

  if (!member) {
    member = await networkStore.saveMember(network.id, {
      id: OWNER_MEMBER_ID,
      companyName,
      contactName,
      email,
      status: 'active',
      joinedAt: new Date().toISOString(),
    });
  } else {
    const patch = {};
    if (member.status === 'paused') patch.status = 'active';
    if (companyName && member.companyName !== companyName) patch.companyName = companyName;
    if (Object.keys(patch).length) {
      member = await networkStore.saveMember(network.id, { ...member, ...patch });
    }
  }

  const baseUrl = getPublicBaseUrl(req) || networkNotify.baseUrlFromReq(req);
  // Short /a/:code for Share + QR; signed /m/ path so Open stays in-session.
  const longUrl = networkNotify.memberPortalLink(baseUrl, network, member);
  const url = await networkNotify.memberPortalShortLink(baseUrl, network, member);
  let path = '/m/';
  try {
    path = new URL(longUrl).pathname;
  } catch (_) {
    const tokenMatch = String(longUrl).match(/\/m\/([^/?#]+)/);
    path = tokenMatch ? `/m/${tokenMatch[1]}` : longUrl;
  }

  return { network, member, path, url };
}

module.exports = {
  OWNER_MEMBER_ID,
  ensureOwnerReferralApp,
};
