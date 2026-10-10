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
const reviewRequestScript = require('./reviewRequestScript');

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

async function networkIntegrationEnv(network) {
  return workspaceIntegrations.getResolvedIntegrationEnv(network.ownerWorkspaceId);
}

/** GHL SMS/email readiness for the network's owner workspace. */
async function messagingReadyForNetwork(network) {
  const integrationEnv = await networkIntegrationEnv(network);
  return ghlMessaging.messagingReady(integrationEnv);
}

/**
 * Text (or email as a fallback) a member a message via the operator workspace's
 * Go High Level connection, logging it on the member's lead when present.
 */
async function messageMember(network, member, { sms, subject, email }) {
  const lead = await memberLead(network, member);
  const target = lead || {
    key: `member:${network.id}:${member.id}`,
    title: member.companyName,
    phone: member.phone,
    email: member.email,
    companyName: member.companyName,
  };
  const integrationEnv = await networkIntegrationEnv(network);
  const ready = ghlMessaging.messagingReady(integrationEnv);
  let sent = null;
  let error = '';
  const phone = member.phone || (lead && lead.phone) || '';
  if (phone && phone !== 'N/A') {
    if (!ready.smsReady) {
      error = ready.configured
        ? 'Set a GHL SMS from number in Workspace → Integrations.'
        : 'Connect Go High Level in Workspace → Integrations to send texts.';
    } else {
      try {
        const result = lead
          ? await smsOutbound.sendSmsToLead({
            lead: target,
            message: sms,
            integrationEnv,
            workspaceId: network.ownerWorkspaceId,
            requireProvider: 'ghl',
            to: phone,
          })
          : await ghlMessaging.sendSmsToPerson({
            name: member.contactName || member.companyName,
            phone,
            message: sms,
            companyName: member.companyName,
            integrationEnv,
          });
        sent = { channel: 'sms', provider: result.provider || 'ghl', messageId: result.messageId || '' };
      } catch (err) {
        error = err.message || 'SMS failed.';
      }
    }
  }
  const mail = member.email || (lead && lead.email) || '';
  if (!sent && mail && mail !== 'N/A') {
    if (!ready.emailReady) {
      error = error || (ready.configured
        ? 'Set the GHL outbound email from address in Workspace → Integrations.'
        : 'Connect Go High Level in Workspace → Integrations to send email.');
    } else {
      try {
        const result = lead
          ? await ghlMessaging.sendEmailToLead({
            lead,
            subject,
            body: email || sms,
            integrationEnv,
            toEmail: mail,
          })
          : await ghlMessaging.sendEmailToPerson({
            name: member.contactName || member.companyName,
            email: mail,
            subject,
            body: email || sms,
            companyName: member.companyName,
            integrationEnv,
          });
        sent = { channel: 'email', provider: 'ghl', messageId: (result && result.messageId) || '' };
      } catch (err) {
        error = error || err.message || 'Email failed.';
      }
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

/**
 * Ask a customer for a review via the network workspace's GHL SMS (preferred)
 * or email. Creates/finds the GHL contact for the customer.
 */
async function sendReviewRequest({
  network,
  member,
  baseUrl,
  toPhone,
  toEmail,
  customerName,
  channel,
  useAi = true,
  scriptOverride,
}) {
  const phone = String(toPhone || '').trim();
  const email = String(toEmail || '').trim();
  const name = String(customerName || 'there').trim() || 'there';
  if (!member || !member.reviewSlug) {
    return { ok: false, error: 'Add at least one review link first, then try again.' };
  }
  const link = `${String(baseUrl || '').replace(/\/+$/, '')}/rv/${encodeURIComponent(member.reviewSlug)}`;
  if (!link || link.endsWith('/rv/')) {
    return { ok: false, error: 'Could not build the review link.' };
  }
  if ((!phone || phone === 'N/A') && (!email || email === 'N/A' || !email.includes('@'))) {
    return { ok: false, error: 'Enter a mobile number or email for the customer.' };
  }

  const integrationEnv = await networkIntegrationEnv(network);
  const ready = ghlMessaging.messagingReady(integrationEnv);
  if (!ready.configured) {
    return {
      ok: false,
      error: 'Go High Level is not connected for this network. Ask your agency to connect GHL in Workspace → Integrations.',
    };
  }

  const prefer = String(channel || 'auto').trim().toLowerCase();
  const company = member.companyName || brandView(network).appName;
  const wantAi = useAi !== false && String(useAi).toLowerCase() !== '0' && String(useAi).toLowerCase() !== 'false';

  let smsBody = '';
  let subject = '';
  let emailBody = '';
  let copyProvider = 'script';

  const trySms = prefer !== 'email' && phone && phone !== 'N/A';
  const tryEmail = prefer !== 'sms' && email && email !== 'N/A' && email.includes('@');

  if (trySms) {
    const built = await reviewRequestScript.buildReviewSms({
      member,
      customerName: name,
      companyName: company,
      reviewLink: link,
      useAi: wantAi,
      scriptOverride,
    });
    smsBody = built.message;
    copyProvider = built.provider;
  }
  if (tryEmail || (!trySms && prefer !== 'sms')) {
    const builtEmail = await reviewRequestScript.buildReviewEmail({
      member,
      customerName: name,
      companyName: company,
      reviewLink: link,
      useAi: wantAi,
      scriptOverride: prefer === 'email' ? scriptOverride : undefined,
    });
    subject = builtEmail.subject;
    emailBody = builtEmail.body;
    if (!smsBody) copyProvider = builtEmail.provider;
  }

  let sent = null;
  let error = '';

  if (trySms) {
    if (!ready.smsReady) {
      error = 'Set a GHL SMS from number in Workspace → Integrations to send review texts.';
    } else {
      try {
        const result = await ghlMessaging.sendSmsToPerson({
          name,
          phone,
          message: smsBody,
          companyName: company,
          integrationEnv,
        });
        sent = {
          channel: 'sms',
          provider: 'ghl',
          messageId: result.messageId || '',
          reviewUrl: link,
          copyProvider,
          message: smsBody,
        };
      } catch (err) {
        error = err.message || 'SMS failed.';
      }
    }
  }

  if (!sent && tryEmail) {
    if (!ready.emailReady) {
      error = error || 'Set the GHL outbound email from address in Workspace → Integrations to send review emails.';
    } else {
      try {
        const result = await ghlMessaging.sendEmailToPerson({
          name,
          email,
          subject,
          body: emailBody,
          companyName: company,
          integrationEnv,
        });
        sent = {
          channel: 'email',
          provider: 'ghl',
          messageId: result.messageId || '',
          reviewUrl: link,
          copyProvider,
          message: emailBody,
          subject,
        };
      } catch (err) {
        error = error || err.message || 'Email failed.';
      }
    }
  }

  if (!sent && !error) {
    if (prefer === 'sms') error = 'Enter a mobile number to text the review request.';
    else if (prefer === 'email') error = 'Enter an email to send the review request.';
    else error = 'Enter a mobile number or email for the customer.';
  }

  if (sent) {
    const lead = await memberLead(network, member);
    if (lead) {
      await dbService.updateLead(lead.key, {
        updates: appendUpdate(lead, {
          type: sent.channel === 'sms' ? 'sms_outbound' : 'email_outbound',
          value: sent.channel === 'sms' ? smsBody : `${subject}\n\n${emailBody}`,
          provider: 'ghl',
          messageSid: sent.messageId,
          source: 'member_review_request',
          copyProvider,
          customerName: name,
          customerPhone: phone || undefined,
          customerEmail: email || undefined,
        }),
      }, network.ownerWorkspaceId);
    }
  }

  return sent ? { ok: true, ...sent } : { ok: false, error };
}

function homeownerSummary(referral, network) {
  const h = referral.homeowner || {};
  const where = [h.city, h.zip].filter(Boolean).join(' ');
  return `${tradeLabel(referral.tradeSlug, network)} job for ${h.name || 'a homeowner'}${where ? ` in ${where}` : ''}`;
}

async function notifyReferralRecipient({ network, referral, member, baseUrl }) {
  if (!member || !referral.toMemberId) return { ok: false, error: 'No member to notify.' };
  const link = referralLink(baseUrl, network, referral, member.id);
  const summary = homeownerSummary(referral, network);
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
  const title = `Assign referral: ${tradeLabel(referral.tradeSlug, network)} for ${h.name || 'homeowner'}${h.city ? ` (${h.city})` : ''} — ${why}`;
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
  sendReviewRequest,
  messagingReadyForNetwork,
  notifyApplication,
  notifyFeedback,
  messageMember,
  createOperatorTask,
  syncPartnerCounter,
  homeownerSummary,
};
