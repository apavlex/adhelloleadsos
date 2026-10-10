/**
 * Workspace owner's Referral app = the network member app (/m/:token),
 * same PWA partners use (reviews → customers → referrals).
 * Ensures a stable owner member row so Get the app can open/share it.
 */
const networkStore = require('./networkStore');
const networkNotify = require('./networkNotify');
const { getPublicBaseUrl } = require('../lib/publicBaseUrl');

const OWNER_MEMBER_ID = 'owner';

function firstNameFromUser(user) {
  const raw =
    (user && user.displayName) ||
    (user && user.emails && user.emails[0] && user.emails[0].value) ||
    '';
  return String(raw).trim().split(/\s+/)[0] || '';
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

  const companyName =
    (ws.name && String(ws.name).trim()) ||
    network.name ||
    'My business';
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
  } else if (member.status === 'paused') {
    member = await networkStore.saveMember(network.id, { ...member, status: 'active' });
  }

  const baseUrl = getPublicBaseUrl(req) || networkNotify.baseUrlFromReq(req);
  const url = networkNotify.memberPortalLink(baseUrl, network, member);
  let path = '/m/';
  try {
    path = new URL(url).pathname;
  } catch (_) {
    const tokenMatch = String(url).match(/\/m\/([^/?#]+)/);
    path = tokenMatch ? `/m/${tokenMatch[1]}` : url;
  }

  return { network, member, path, url };
}

module.exports = {
  OWNER_MEMBER_ID,
  ensureOwnerReferralApp,
};
