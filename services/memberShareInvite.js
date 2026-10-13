/**
 * Invite someone outside the network to claim a shared contact (+ all projects).
 *
 * Flow: member creates invite → SMS/email with /share/c/:token → recipient
 * signs up on the spot on this network → contact + jobs land on their book.
 *
 *   netshareinvite:<token>
 */

const crypto = require('crypto');
const dbService = require('./database');
const store = require('./networkStore');
const work = require('./memberWork');
const notify = require('./networkNotify');
const referralNetwork = require('./referralNetwork');
const { getPublicBaseUrl } = require('../lib/publicBaseUrl');
const freeAppSignup = require('./freeAppSignup');

const PREFIX = 'netshareinvite:';
const TOKEN_RE = /^[a-z0-9]{16,48}$/;
const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_PENDING_PER_MEMBER = 40;

function newToken() {
  return `${Date.now().toString(36)}${crypto.randomBytes(8).toString('hex')}`;
}

function phoneDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function cleanLine(value, max) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
}

function cleanEmail(value) {
  return cleanLine(value, 200).toLowerCase();
}

function normalizeInvite(raw) {
  const a = raw && typeof raw === 'object' ? raw : {};
  const status = ['pending', 'claimed', 'expired', 'cancelled'].includes(a.status)
    ? a.status
    : 'pending';
  return {
    id: String(a.id || ''),
    networkId: String(a.networkId || ''),
    fromMemberId: String(a.fromMemberId || ''),
    customerId: String(a.customerId || ''),
    customerName: cleanLine(a.customerName, 120),
    phone: cleanLine(a.phone, 40),
    email: cleanEmail(a.email),
    companyName: cleanLine(a.companyName, 160),
    contactName: cleanLine(a.contactName, 120),
    status,
    claimedMemberId: String(a.claimedMemberId || ''),
    claimedCustomerId: String(a.claimedCustomerId || ''),
    createdAt: a.createdAt || '',
    expiresAt: a.expiresAt || '',
    claimedAt: a.claimedAt || '',
    updatedAt: a.updatedAt || a.createdAt || '',
  };
}

async function getInvite(token) {
  const id = String(token || '').trim().toLowerCase();
  if (!TOKEN_RE.test(id)) return null;
  const raw = await dbService.peekStorageKey(`${PREFIX}${id}`);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? normalizeInvite(parsed) : null;
  } catch {
    return null;
  }
}

async function saveInvite(invite) {
  const next = normalizeInvite({
    ...invite,
    id: invite.id || newToken(),
    updatedAt: new Date().toISOString(),
  });
  if (!TOKEN_RE.test(next.id)) throw new Error('shareInvite: invalid token');
  await dbService.putStorageKey(`${PREFIX}${next.id}`, next);
  return next;
}

function claimUrl(baseUrl, token) {
  const base = String(baseUrl || getPublicBaseUrl()).replace(/\/+$/, '');
  return `${base}/share/c/${encodeURIComponent(token)}`;
}

function isExpired(invite, now = Date.now()) {
  if (!invite) return true;
  if (invite.status !== 'pending') return invite.status !== 'claimed';
  const exp = Date.parse(invite.expiresAt || '');
  return Number.isFinite(exp) && now > exp;
}

async function findMemberByContact(networkId, { phone, email }) {
  const members = await store.listMembers(networkId);
  const digits = phoneDigits(phone);
  const em = cleanEmail(email);
  if (em) {
    const byEmail = members.find((m) => cleanEmail(m.email) === em && m.status === 'active');
    if (byEmail) return byEmail;
  }
  if (digits.length >= 7) {
    const byPhone = members.find((m) => {
      const d = phoneDigits(m.phone);
      return d && (d === digits || d.endsWith(digits) || digits.endsWith(d)) && m.status === 'active';
    });
    if (byPhone) return byPhone;
  }
  return null;
}

async function countPendingForMember(networkId, fromMemberId) {
  const keys = await dbService.listStorageKeysWithPrefix(PREFIX);
  let n = 0;
  for (const key of keys) {
    const invite = await getInvite(String(key).slice(PREFIX.length));
    if (!invite || invite.networkId !== networkId || invite.fromMemberId !== fromMemberId) continue;
    if (invite.status === 'pending' && !isExpired(invite)) n += 1;
  }
  return n;
}

/**
 * Share with an existing teammate, or create an outside invite + SMS/email link.
 */
async function createOrShare({
  network,
  fromMember,
  customerId,
  phone,
  email,
  companyName,
  contactName,
  baseUrl,
}) {
  if (!network || !fromMember) return { ok: false, error: 'Missing network.' };
  if (fromMember.status !== 'active') {
    return { ok: false, error: 'Your membership is paused. Contact the network.' };
  }
  const customer = await work.getCustomer(network.id, fromMember.id, customerId);
  if (!customer) return { ok: false, error: 'Customer not found.' };

  const digits = phoneDigits(phone);
  const em = cleanEmail(email);
  if (digits.length < 7 && !em) {
    return { ok: false, error: 'Add a mobile number or email for the person you’re inviting.' };
  }

  const existingMember = await findMemberByContact(network.id, { phone, email: em });
  if (existingMember && existingMember.id === fromMember.id) {
    return { ok: false, error: 'That’s your own number or email — invite someone else.' };
  }
  if (existingMember) {
    const shared = await work.shareCustomerWithTeammate(
      network.id,
      fromMember.id,
      existingMember.id,
      customer.id,
      { sharedByName: fromMember.contactName || fromMember.companyName },
    );
    if (!shared.ok) return shared;
    const ping = await notify.notifyCustomerSharedWithTeammate({
      network,
      fromMember,
      toMember: existingMember,
      customer: shared.customer,
      jobsShared: shared.jobsShared || 0,
      baseUrl,
    }).catch((err) => ({ ok: false, error: err.message }));
    return {
      ok: true,
      mode: 'existing_member',
      member: existingMember,
      shared,
      notified: ping,
    };
  }

  const pending = await countPendingForMember(network.id, fromMember.id);
  if (pending >= MAX_PENDING_PER_MEMBER) {
    return { ok: false, error: 'You have a lot of open share invites. Wait for some to be claimed first.' };
  }

  const now = Date.now();
  const invite = await saveInvite({
    id: newToken(),
    networkId: network.id,
    fromMemberId: fromMember.id,
    customerId: customer.id,
    customerName: customer.name,
    phone: digits ? String(phone || '').trim() : '',
    email: em,
    companyName: cleanLine(companyName, 160) || cleanLine(contactName, 160) || 'New partner',
    contactName: cleanLine(contactName, 120),
    status: 'pending',
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + INVITE_TTL_MS).toISOString(),
  });

  const url = claimUrl(baseUrl, invite.id);
  const who = fromMember.contactName || fromMember.companyName || 'A partner';
  const app = (require('./networkBrand').brandView(network)).appName;
  const sms = `${who} shared “${customer.name}” (and their projects) with you on ${app}. Open to join and see it: ${url}`;
  const emailBody = `${who} shared a contact with you on ${app}: ${customer.name}.\n\n`
    + `You’ll get their contact and all projects on your own book.\n\nJoin and open: ${url}`;

  // Send via network GHL to the invitee (not a member yet).
  const integrationEnv = await require('./workspaceIntegrations')
    .getResolvedIntegrationEnv(network.ownerWorkspaceId);
  const ghlMessaging = require('./ghlMessaging');
  const ready = ghlMessaging.messagingReady(integrationEnv);
  let notified = null;
  let error = '';
  if (invite.phone && ready.smsReady) {
    try {
      const sent = await ghlMessaging.sendSmsToPerson({
        name: invite.contactName || invite.companyName,
        phone: invite.phone,
        message: sms,
        companyName: fromMember.companyName,
        integrationEnv,
      });
      notified = { ok: true, channel: 'sms', messageId: sent.messageId || '' };
    } catch (err) {
      error = err.message || 'SMS failed.';
    }
  }
  if (!notified && invite.email && ready.emailReady) {
    try {
      const sent = await ghlMessaging.sendEmailToPerson({
        name: invite.contactName || invite.companyName,
        email: invite.email,
        subject: `${who} shared a contact with you on ${app}`,
        html: `<p>${emailBody.replace(/\n/g, '<br>')}</p>`,
        text: emailBody,
        companyName: fromMember.companyName,
        integrationEnv,
      });
      notified = { ok: true, channel: 'email', messageId: sent.messageId || sent.id || '' };
    } catch (err) {
      error = err.message || 'Email failed.';
    }
  }
  // Invite is saved either way — member can copy the claim link if SMS/email fails.
  if (!notified) {
    return {
      ok: true,
      mode: 'invite',
      invite,
      url,
      notified: {
        ok: false,
        error: error || (!ready.configured
          ? 'Connect GHL CRM in Workspace → Integrations to send the invite, or copy the link below.'
          : 'Could not text/email the invite — copy the link and send it yourself.'),
      },
    };
  }

  return { ok: true, mode: 'invite', invite, url, notified };
}

/**
 * Recipient signs up on the spot: create (or reuse) member on this network,
 * deliver the shared contact + all projects, return portal URL.
 */
async function claimInvite(token, form, { baseUrl } = {}) {
  let invite = await getInvite(token);
  if (!invite) return { ok: false, error: 'That invite link is invalid or expired.' };
  if (invite.status === 'claimed' && invite.claimedMemberId) {
    const network = await store.getNetwork(invite.networkId);
    const member = network ? await store.getMember(network.id, invite.claimedMemberId) : null;
    if (network && member) {
      const portal = notify.memberPortalLink(baseUrl || getPublicBaseUrl(), network, member);
      const path = invite.claimedCustomerId
        ? `${portal}/customers/c/${encodeURIComponent(invite.claimedCustomerId)}`
        : portal;
      return { ok: true, already: true, network, member, portal: path };
    }
  }
  if (isExpired(invite)) {
    if (invite.status === 'pending') {
      await saveInvite({ ...invite, status: 'expired' });
    }
    return { ok: false, error: 'That invite has expired. Ask them to share again.' };
  }

  const network = await store.getNetwork(invite.networkId);
  if (!network) return { ok: false, error: 'That network is no longer available.' };
  const fromMember = await store.getMember(network.id, invite.fromMemberId);
  if (!fromMember || fromMember.status !== 'active') {
    return { ok: false, error: 'The person who shared this is no longer active.' };
  }

  const companyName = cleanLine(form && form.companyName, 160) || invite.companyName || 'My business';
  const contactName = cleanLine(form && form.contactName, 120) || invite.contactName;
  const phone = cleanLine(form && form.phone, 40) || invite.phone;
  const email = cleanEmail(form && form.email) || invite.email;
  if (!companyName) return { ok: false, error: 'Add your business name.' };
  if (phoneDigits(phone).length < 7 && !email) {
    return { ok: false, error: 'Add a mobile number or email.' };
  }

  let member = await findMemberByContact(network.id, { phone, email });
  let created = false;
  if (!member) {
    const saved = await dbService.saveLeadWithMeta({
      workspaceId: network.ownerWorkspaceId,
      title: companyName,
      contactName: contactName || '',
      phone: phone || 'N/A',
      email: email || 'N/A',
      source: 'share_invite',
      message: `Joined via shared contact from ${fromMember.companyName}`,
    });
    const lead = await dbService.getLead(saved.key, network.ownerWorkspaceId);
    if (!lead || !lead.key) {
      return { ok: false, error: 'Could not create your account. Try again.' };
    }
    const connected = referralNetwork.applyPartnerAction(lead, 'connect');
    if (connected.ok) {
      await dbService.updateLead(lead.key, { referralPartner: connected.referralPartner }, network.ownerWorkspaceId);
    }
    member = await store.saveMember(network.id, {
      leadKey: lead.key,
      companyName,
      contactName,
      phone: phone || '',
      email: email || '',
      status: 'active',
      plan: freeAppSignup.PLAN_APP_FREE,
      invitedByMemberId: fromMember.id,
      joinedAt: new Date().toISOString(),
    });
    created = true;
  } else if (member.status === 'paused') {
    member = await store.saveMember(network.id, { ...member, status: 'active' });
  }

  const shared = await work.shareCustomerWithTeammate(
    network.id,
    fromMember.id,
    member.id,
    invite.customerId,
    { sharedByName: fromMember.contactName || fromMember.companyName },
  );
  if (!shared.ok) {
    return { ok: false, error: shared.error || 'Could not load the shared contact.' };
  }

  invite = await saveInvite({
    ...invite,
    status: 'claimed',
    claimedMemberId: member.id,
    claimedCustomerId: shared.customer.id,
    claimedAt: new Date().toISOString(),
    companyName,
    contactName,
    phone,
    email,
  });

  const portalBase = notify.memberPortalLink(baseUrl || getPublicBaseUrl(), network, member);
  const portal = `${portalBase}/customers/c/${encodeURIComponent(shared.customer.id)}`;

  return {
    ok: true,
    created,
    network,
    member,
    shared,
    invite,
    portal,
  };
}

module.exports = {
  TOKEN_RE,
  INVITE_TTL_MS,
  getInvite,
  saveInvite,
  claimUrl,
  isExpired,
  findMemberByContact,
  createOrShare,
  claimInvite,
};
