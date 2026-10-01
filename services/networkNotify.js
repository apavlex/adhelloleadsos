/**
 * Side effects for network referrals: text the member a signed link, open
 * operator tasks when a referral needs a human, and keep the referral partner
 * counters on member leads in step with the ledger.
 */

const dbService = require('./database');
const smsOutbound = require('./smsOutbound');
const ghlMessaging = require('./ghlMessaging');
const workspaceIntegrations = require('./workspaceIntegrations');
const { upsertOpenTaskForLead, TASK_SOURCE_NETWORK } = require('./userTasks');
const referralNetwork = require('./referralNetwork');
const { tradeLabel } = require('./networkTrades');
const { createReferralLinkToken, createMemberPortalToken } = require('./networkLinkSign');
const { UNROUTED_REASONS } = require('./referralExchange');
const { brandView } = require('./networkBrand');

function baseUrlFromReq(req) {
  const env = String(process.env.BASE_URL || '').trim();
  if (env) return env.replace(/\/+$/, '');
  if (!req) return '';
  const proto = req.get('x-forwarded-proto') || req.protocol || 'http';
  const host = req.get('x-forwarded-host') || req.get('host') || 'localhost';
  return `${proto}://${host}`.replace(/\/+$/, '');
}

function referralLink(baseUrl, network, referral, memberId) {
  const token = createReferralLinkToken({ networkId: network.id, referralId: referral.id, memberId });
  return `${baseUrl}/r/${encodeURIComponent(token)}`;
}

function memberPortalLink(baseUrl, network, member) {
  const token = createMemberPortalToken({ networkId: network.id, memberId: member.id });
  return `${baseUrl}/m/${encodeURIComponent(token)}`;
}

async function memberLead(network, member) {
  if (!member || !member.leadKey) return null;
  const lead = await dbService.getLead(member.leadKey, network.ownerWorkspaceId);
  return lead && lead.key ? lead : null;
}

async function operatorEmail(network) {
  if (network.ownerEmail) return network.ownerEmail;
  const ws = await dbService.getWorkspace(network.ownerWorkspaceId);
  const members = ws && ws.members && typeof ws.members === 'object' ? ws.members : {};
  const owner = Object.entries(members).find(([, row]) => row && row.role === 'owner');
  return owner ? owner[0] : '';
}

function appendUpdate(lead, entry) {
  const updates = Array.isArray(lead.updates) ? lead.updates.slice() : [];
  updates.push({ timestamp: new Date().toISOString(), ...entry });
  return updates;
}

/**
 * Text (or email as a fallback) a member a message from the operator's
 * workspace, logging it on the member's lead.
 */
async function messageMember(network, member, { sms, subject, email }) {
  const lead = await memberLead(network, member);
  const target = lead || { key: '', title: member.companyName, phone: member.phone, email: member.email };
  const integrationEnv = await workspaceIntegrations.getResolvedIntegrationEnv(network.ownerWorkspaceId);
  let sent = null;
  let error = '';
  const phone = member.phone || (lead && lead.phone) || '';
  if (phone && phone !== 'N/A') {
    try {
      const result = await smsOutbound.sendSmsToLead({
        lead: target,
        message: sms,
        integrationEnv,
        workspaceId: network.ownerWorkspaceId,
        to: phone,
      });
      sent = { channel: 'sms', provider: result.provider, messageId: result.messageId || '' };
    } catch (err) {
      error = err.message || 'SMS failed.';
    }
  }
  const mail = member.email || (lead && lead.email) || '';
  if (!sent && mail && mail !== 'N/A' && lead) {
    try {
      const result = await ghlMessaging.sendEmailToLead({
        lead,
        subject,
        body: email || sms,
        integrationEnv,
        toEmail: mail,
      });
      sent = { channel: 'email', provider: 'ghl', messageId: (result && result.messageId) || '' };
    } catch (err) {
      error = error || err.message || 'Email failed.';
    }
  }
  if (sent && lead) {
    await dbService.updateLead(lead.key, {
      updates: appendUpdate(lead, {
        type: sent.channel === 'sms' ? 'sms_outbound' : 'email_outbound',
        value: sent.channel === 'sms' ? sms : `${subject}\n\n${email || sms}`,
        provider: sent.provider,
        messageSid: sent.messageId,
        source: 'referral_network',
      }),
    }, network.ownerWorkspaceId);
  }
  if (!sent && !error) error = 'No phone or email on file for this member.';
  return sent ? { ok: true, ...sent } : { ok: false, error };
}

function homeownerSummary(referral) {
  const h = referral.homeowner || {};
  const where = [h.city, h.zip].filter(Boolean).join(' ');
  return `${tradeLabel(referral.tradeSlug)} job for ${h.name || 'a homeowner'}${where ? ` in ${where}` : ''}`;
}

async function notifyReferralRecipient({ network, referral, member, baseUrl }) {
  if (!member || !referral.toMemberId) return { ok: false, error: 'No member to notify.' };
  const link = referralLink(baseUrl, network, referral, member.id);
  const summary = homeownerSummary(referral);
  const sms = `${network.name}: new referral — ${summary}. Accept or decline: ${link}`;
  const email = `You have a new referral from ${network.name}.\n\n${summary}.\n\nOpen it to accept, decline, and report the outcome:\n${link}`;
  return messageMember(network, member, { sms, subject: `New referral: ${summary}`, email });
}

async function sendMemberPortalLink({ network, member, baseUrl, welcome }) {
  const link = memberPortalLink(baseUrl, network, member);
  const app = brandView(network).appName;
  const sms = welcome
    ? `Welcome to ${app}! Your referral app: ${link} — open it on your phone and tap Share > Add to Home Screen.`
    : `${app}: your referral app — send and receive referrals: ${link} (tip: Share > Add to Home Screen)`;
  return messageMember(network, member, {
    sms,
    subject: welcome ? `Welcome to ${app}` : `Your ${app} referral app`,
    email: `${welcome ? `Welcome to ${app}!\n\n` : ''}Here is your ${app} referral app. Open it on your phone to send referrals, see referrals sent to you, and share your review link:\n\n${link}\n\nTip: on iPhone tap Share, then "Add to Home Screen" so it opens like an app.`,
  });
}

/** Operator task + text/email when a member invites a business to join. */
async function notifyApplication({ network, application, invitedBy }) {
  const email = await operatorEmail(network);
  const who = invitedBy ? invitedBy.companyName : 'A member';
  const title = `Approve network applicant: ${application.companyName}${application.city ? ` (${application.city})` : ''} — invited by ${who}`;
  if (!email) return null;
  try {
    return await upsertOpenTaskForLead(network.ownerWorkspaceId, email, {
      title: title.slice(0, 240),
      leadKey: null,
      scheduledAt: new Date().toISOString(),
      source: TASK_SOURCE_NETWORK,
    });
  } catch (err) {
    console.warn('[network] application task failed:', err.message);
    return null;
  }
}

/** Private (low-star) feedback from a review page: tell the member and open an operator task. */
async function notifyFeedback({ network, member, feedback }) {
  const stars = '★'.repeat(feedback.rating || 0) || 'No rating';
  const who = [feedback.name, feedback.phone || feedback.email].filter(Boolean).join(', ') || 'A customer';
  const body = `${stars} private feedback from ${who}: "${String(feedback.message || '').slice(0, 300)}"`;
  const memberResult = await messageMember(network, member, {
    sms: `${brandView(network).appName}: ${body} — reach out to make it right.`,
    subject: `Private feedback (${feedback.rating || '?'}★) from ${feedback.name || 'a customer'}`,
    email: `${body}\n\nReach out to make it right.`,
  }).catch((err) => ({ ok: false, error: err.message }));
  const email = await operatorEmail(network);
  if (email) {
    try {
      await upsertOpenTaskForLead(network.ownerWorkspaceId, email, {
        title: `Review feedback for ${member.companyName}: ${feedback.rating || '?'}★ from ${feedback.name || 'customer'}`.slice(0, 240),
        leadKey: member.leadKey || null,
        scheduledAt: new Date().toISOString(),
        source: TASK_SOURCE_NETWORK,
      });
    } catch (err) {
      console.warn('[network] feedback task failed:', err.message);
    }
  }
  return memberResult;
}

/** Operator task for referrals nobody is working (unrouted or declined). */
async function createOperatorTask({ network, referral, reason, member }) {
  const email = await operatorEmail(network);
  if (!email) return null;
  const h = referral.homeowner || {};
  const why = reason === 'declined'
    ? `declined by ${member ? member.companyName : 'the member'}`
    : (UNROUTED_REASONS[referral.unroutedReason] || 'Needs a member.').replace(/\.$/, '');
  const title = `Assign referral: ${tradeLabel(referral.tradeSlug)} for ${h.name || 'homeowner'}${h.city ? ` (${h.city})` : ''} — ${why}`;
  try {
    return await upsertOpenTaskForLead(network.ownerWorkspaceId, email, {
      title: title.slice(0, 240),
      leadKey: null,
      scheduledAt: new Date().toISOString(),
      source: TASK_SOURCE_NETWORK,
    });
  } catch (err) {
    console.warn('[network] operator task failed:', err.message);
    return null;
  }
}

/**
 * Referral partner counters are from the operator's side: "sent" = leads we
 * sent the partner, "received" = leads the partner sent us.
 */
async function syncPartnerCounter(network, member, action) {
  const lead = await memberLead(network, member);
  if (!lead) return;
  const applied = referralNetwork.applyPartnerAction(lead, action);
  if (!applied.ok) return;
  await dbService.updateLead(lead.key, { referralPartner: applied.referralPartner }, network.ownerWorkspaceId);
}

module.exports = {
  baseUrlFromReq,
  referralLink,
  memberPortalLink,
  notifyReferralRecipient,
  sendMemberPortalLink,
  notifyApplication,
  notifyFeedback,
  messageMember,
  createOperatorTask,
  syncPartnerCounter,
  homeownerSummary,
};
