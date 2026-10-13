/**
 * Workspace Get the app → personal member PWA (/m/:token).
 * Owner keeps the stable `owner` row (Review app + white-label).
 * Other logged-in staff get their own member row (name, customers, leads).
 */
const crypto = require('crypto');
const networkStore = require('./networkStore');
const networkNotify = require('./networkNotify');
const whiteLabel = require('./whiteLabel');
const workspaceService = require('./workspaceService');
const { getPublicBaseUrl } = require('../lib/publicBaseUrl');

const OWNER_MEMBER_ID = 'owner';

function firstNameFromUser(user) {
  const raw =
    (user && user.displayName) ||
    (user && user.emails && user.emails[0] && user.emails[0].value) ||
    '';
  return String(raw).trim().split(/\s+/)[0] || '';
}

function userEmail(user) {
  return String(
    (user && user.emails && user.emails[0] && user.emails[0].value) || '',
  )
    .trim()
    .toLowerCase();
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

/** Stable member id for a workspace staff email (not the owner row). */
function staffMemberIdForEmail(email) {
  const em = String(email || '').trim().toLowerCase();
  if (!em) return '';
  const hash = crypto.createHash('sha256').update(`wsstaff:${em}`).digest('hex').slice(0, 12);
  return `staff_${hash}`;
}

function isWorkspaceOwnerLogin(ws, network, email) {
  const em = String(email || '').trim().toLowerCase();
  if (!em) return true; // no email → keep legacy owner app
  if (workspaceService.roleForEmail(ws, em) === 'owner') return true;
  const ownerEmail = String((network && network.ownerEmail) || '').trim().toLowerCase();
  return !!(ownerEmail && ownerEmail === em);
}

/**
 * @returns {Promise<{ network: object, member: object, path: string, url: string, isStaff: boolean }>}
 */
async function ensureOwnerReferralApp(req) {
  const workspaceId = req.workspaceId;
  if (!workspaceId) throw new Error('ensureOwnerReferralApp requires workspaceId');
  const ws = req.workspace || {};
  const email = userEmail(req.user);

  const network = await networkStore.getOrCreateNetworkForWorkspace(workspaceId, {
    name: (ws.name && String(ws.name).trim()) || 'Referral network',
    ownerEmail: email,
  });

  const companyName = ownerBusinessName(ws, network);
  const contactName = firstNameFromUser(req.user) || '';
  const asOwner = isWorkspaceOwnerLogin(ws, network, email);

  let member;
  if (asOwner) {
    member = await networkStore.getMember(network.id, OWNER_MEMBER_ID);
    if (!member && email) {
      const members = await networkStore.listMembers(network.id);
      member = members.find((m) => String(m.email || '').trim().toLowerCase() === email) || null;
    }
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
      if (contactName && member.contactName !== contactName) patch.contactName = contactName;
      if (email && !member.email) patch.email = email;
      if (Object.keys(patch).length) {
        member = await networkStore.saveMember(network.id, { ...member, ...patch });
      }
    }
  } else {
    const staffId = staffMemberIdForEmail(email);
    member = await networkStore.getMember(network.id, staffId);
    if (!member) {
      const members = await networkStore.listMembers(network.id);
      member = members.find((m) => String(m.email || '').trim().toLowerCase() === email) || null;
    }
    if (!member) {
      member = await networkStore.saveMember(network.id, {
        id: staffId,
        companyName,
        contactName: contactName || email.split('@')[0] || 'Teammate',
        email,
        status: 'active',
        workspaceStaff: true,
        joinedAt: new Date().toISOString(),
      });
    } else {
      const patch = { workspaceStaff: true };
      if (member.status === 'paused') patch.status = 'active';
      if (companyName && member.companyName !== companyName) patch.companyName = companyName;
      if (contactName && member.contactName !== contactName) patch.contactName = contactName;
      if (email && member.email !== email) patch.email = email;
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

  return {
    network,
    member,
    path,
    url,
    isStaff: !asOwner,
  };
}

module.exports = {
  OWNER_MEMBER_ID,
  staffMemberIdForEmail,
  isWorkspaceOwnerLogin,
  ensureOwnerReferralApp,
};
