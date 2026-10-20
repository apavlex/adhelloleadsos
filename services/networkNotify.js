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
const memberShortLinks = require('./memberShortLinks');
const { UNROUTED_REASONS, canClaimPoolReferral } = require('./referralExchange');
const store = require('./networkStore');
const { brandView } = require('./networkBrand');
const reviewRequestScript = require('./reviewRequestScript');
const reviewAsk = require('./reviewAsk');
const { getReviewPageUrl, getReviewPublicBaseUrl } = require('../lib/publicBaseUrl');

/** Member-app + review links always brand to reviews.adhello.io (not the CRM host). */
function baseUrlFromReq(_req) {
  return getReviewPublicBaseUrl();
}

/** Customer-facing review URL branded to reviews.adhello.io/rv/…. */
function reviewPageLink(memberOrSlug, opts) {
  const slug = typeof memberOrSlug === 'string'
    ? memberOrSlug
    : (memberOrSlug && memberOrSlug.reviewSlug) || '';
  return getReviewPageUrl(slug, opts);
}

function referralLink(baseUrl, network, referral, memberId) {
  const token = createReferralLinkToken({ networkId: network.id, referralId: referral.id, memberId });
  return `${baseUrl}/r/${encodeURIComponent(token)}`;
}

function memberPortalLink(baseUrl, network, member) {
  const token = createMemberPortalToken({ networkId: network.id, memberId: member.id });
  return `${baseUrl}/m/${encodeURIComponent(token)}`;
}

/** Short /a/:code URL for SMS/email (falls back to signed /m/ if allocation fails). */
async function memberPortalShortLink(baseUrl, network, member, pathAndQuery = '') {
  try {
    return await memberShortLinks.memberAppShortLink(baseUrl, network, member, pathAndQuery);
  } catch (err) {
    console.warn('[network] short portal link failed:', err.message);
    const full = memberPortalLink(baseUrl, network, member);
    const suffix = String(pathAndQuery || '');
    if (!suffix) return full;
    return `${full}${suffix.startsWith('/') || suffix.startsWith('?') ? suffix : `/${suffix}`}`;
  }
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
 * GHL CRM connection, logging it on the member's lead when present.
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
        ? 'Set a GHL CRM SMS from number in Workspace → Integrations.'
        : 'Connect GHL CRM in Workspace → Integrations to send texts.';
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
        : 'Connect GHL CRM in Workspace → Integrations to send email.');
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
  customerId,
  channel,
  useAi = true,
  scriptOverride,
  imageId,
  jobTitle = '',
  city = '',
  keywords = '',
}) {
  const phone = String(toPhone || '').trim();
  const email = String(toEmail || '').trim();
  const name = String(customerName || 'there').trim() || 'there';
  if (!member || !member.reviewSlug) {
    return { ok: false, error: 'Add at least one review link first, then try again.' };
  }
  if ((!phone || phone === 'N/A') && (!email || email === 'N/A' || !email.includes('@'))) {
    return { ok: false, error: 'Enter a mobile number or email for the customer.' };
  }

  const integrationEnv = await networkIntegrationEnv(network);
  const ready = ghlMessaging.messagingReady(integrationEnv);
  if (!ready.configured) {
    return {
      ok: false,
      error: 'GHL CRM is not connected for this network. Ask your agency to connect GHL CRM in Workspace → Integrations.',
    };
  }

  const prefer = String(channel || 'auto').trim().toLowerCase();
  const company = member.companyName || brandView(network).appName;
  const wantAi = useAi !== false && String(useAi).toLowerCase() !== '0' && String(useAi).toLowerCase() !== 'false';
  const shareImageId = String(imageId || '').trim();

  // Prefer SMS when both are available so the 48h click reminder can run.
  const trySms = prefer !== 'email' && phone && phone !== 'N/A';
  const tryEmail = prefer !== 'sms' && email && email !== 'N/A' && email.includes('@');
  const plannedChannel = trySms ? 'sms' : 'email';

  const keywordHint =
    reviewRequestScript.buildKeywordHint({ jobTitle, city, keywords }) || '';
  const ask = await reviewAsk.createAsk({
    networkId: network.id,
    memberId: member.id,
    customerId: customerId || '',
    name,
    phone,
    email,
    channel: plannedChannel,
    reviewSlug: member.reviewSlug,
    imageId: shareImageId,
    keywordHint,
    jobTitle,
    city,
  });
  const link = ask.reviewUrl;
  if (!link) {
    return { ok: false, error: 'Could not build the review link.' };
  }

  let smsBody = '';
  let subject = '';
  let emailBody = '';
  let copyProvider = 'script';

  if (trySms) {
    const built = await reviewRequestScript.buildReviewSms({
      member,
      customerName: name,
      companyName: company,
      reviewLink: link,
      useAi: wantAi,
      scriptOverride,
      jobTitle,
      city,
      keywords: keywordHint,
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
      jobTitle,
      city,
      keywords: keywordHint,
    });
    subject = builtEmail.subject;
    emailBody = builtEmail.body;
    if (!smsBody) copyProvider = builtEmail.provider;
  }

  let sent = null;
  let error = '';

  if (trySms) {
    if (!ready.smsReady) {
      error = 'Set a GHL CRM SMS from number in Workspace → Integrations to send review texts.';
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
          imageId: shareImageId || '',
          copyProvider,
          message: smsBody,
          askId: ask.id,
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
          imageId: shareImageId || '',
          copyProvider,
          message: emailBody,
          subject,
          askId: ask.id,
        };
        await reviewAsk.saveAsk({ ...ask, channel: 'email' });
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
          askId: ask.id,
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

function recordMemberActivity(network, member, item) {
  try {
    const memberActivity = require('./memberActivity');
    memberActivity.add(network && network.id, member && member.id, item);
  } catch (err) {
    console.warn('[network] member activity failed:', err && err.message);
  }
}

async function notifyReferralRecipient({ network, referral, member, baseUrl }) {
  if (!member || !referral.toMemberId) return { ok: false, error: 'No member to notify.' };
  const link = referralLink(baseUrl, network, referral, member.id);
  const memberLeadRequests = require('./memberLeadRequests');
  const detailsAllowed = await memberLeadRequests.planAllowsLeadDetails(network, member)
    .catch(() => false);
  const projectName = String((referral.homeowner && referral.homeowner.name) || '').trim()
    || `${tradeLabel(referral.tradeSlug, network)} job`;
  if (!detailsAllowed) {
    return messageMember(network, member, {
      sms: `${network.name}: new project “${projectName.slice(0, 60)}”. Upgrade to unlock details: ${link}`,
      subject: `New project: ${projectName.slice(0, 80)}`,
      email: `You have a new project from ${network.name}: ${projectName}.\n\nUpgrade to a paid plan to see contact details:\n${link}`,
    });
  }
  const summary = homeownerSummary(referral, network);
  const sms = `${network.name}: new referral — ${summary}. Accept or decline: ${link}`;
  const email = `You have a new referral from ${network.name}.\n\n${summary}.\n\nOpen it to accept, decline, and report the outcome:\n${link}`;
  const messaging = await messageMember(network, member, { sms, subject: `New referral: ${summary}`, email });
  const app = memberPortalLink(baseUrl, network, member);
  recordMemberActivity(network, member, {
    kind: 'referral',
    title: 'New referral',
    body: summary,
    href: `${app}/referrals`,
  });
  // Home-screen / phone popup when the partner turned on alerts (linked package).
  pushMemberReferralAlert({
    network, member, baseUrl, referral, summary, kind: 'received',
  }).catch((err) => console.warn('[network] referral push failed:', err && err.message));
  return messaging;
}

/**
 * Text/email eligible partners when a referral lands in the claimable pool (unrouted).
 * Caps at 8 members to avoid spam; returns how many were messaged.
 */
async function notifyReferralPool({ network, referral, baseUrl }) {
  if (!referral || referral.status !== 'unrouted') return 0;
  const members = await store.listMembers(network.id);
  const eligible = members
    .filter((m) => m && !m.workspaceStaff && canClaimPoolReferral(referral, m))
    .slice(0, 8);
  if (!eligible.length) return 0;
  const summary = homeownerSummary(referral, network);
  const projectName = String((referral.homeowner && referral.homeowner.name) || '').trim()
    || `${tradeLabel(referral.tradeSlug, network)} job`;
  const memberLeadRequests = require('./memberLeadRequests');
  let sent = 0;
  await Promise.all(eligible.map(async (member) => {
    const app = memberPortalLink(baseUrl, network, member);
    const poolUrl = `${app}/referrals?view=pool`;
    const detailsAllowed = await memberLeadRequests.planAllowsLeadDetails(network, member)
      .catch(() => false);
    const result = await messageMember(network, member, detailsAllowed ? {
      sms: `${network.name}: open referral in the pool — ${summary}. Claim it: ${poolUrl}`,
      subject: `Claim pool referral: ${summary}`,
      email: `A referral is waiting in the pool for ${network.name}.\n\n${summary}.\n\nClaim it in your app:\n${poolUrl}`,
    } : {
      // Free / trial: tease project name only — no city, phone, or claim copy with PII.
      sms: `${network.name}: new project “${projectName.slice(0, 60)}” in the pool. Upgrade to unlock details: ${poolUrl}`,
      subject: `New project: ${projectName.slice(0, 80)}`,
      email: `A new project is in the ${network.name} pool: ${projectName}.\n\nUpgrade to a paid plan to see contact details and claim it:\n${poolUrl}`,
    }).catch(() => ({ ok: false }));
    if (result && result.ok) sent += 1;
    recordMemberActivity(network, member, {
      kind: 'pool',
      title: 'Open referral in the pool',
      body: summary,
      href: `${app}/referrals?view=pool`,
    });
    pushMemberReferralAlert({
      network, member, baseUrl, referral, summary, kind: 'pool',
    }).catch((err) => console.warn('[network] pool referral push failed:', err && err.message));
  }));
  return sent;
}

/**
 * Phone/home-screen Web Push for a partner who turned on alerts in the member app.
 * Scoped to their linked appointment package (same subscription as website-lead alerts).
 */
async function pushMemberReferralAlert({ network, member, baseUrl, referral, summary, kind } = {}) {
  const workspaceId = network && network.ownerWorkspaceId;
  if (!workspaceId || !member) return { sent: 0 };
  const memberAppointmentLink = require('./memberAppointmentLink');
  const pkg = await memberAppointmentLink.findPackageForMember(workspaceId, member);
  if (!pkg || pkg.portalEnabled === false) return { sent: 0 };
  const push = require('./pushNotifications');
  const app = memberPortalLink(baseUrl, network, member);
  const url = kind === 'pool' ? `${app}/referrals?view=pool` : `${app}/referrals`;
  const title = kind === 'pool' ? 'Open referral in the pool' : 'New referral';
  const body = String(summary || homeownerSummary(referral, network) || 'Open your app').slice(0, 200);
  return push.sendPortalPush(
    { packageId: pkg.id, workspaceId },
    {
      title,
      body,
      url,
      tag: `member-ref-${kind}-${(referral && referral.id) || Date.now()}`,
    },
  );
}

/** SMS/email a linked network partner when a website or agency lead hits their package. */
async function notifyMemberFormLead({ network, member, baseUrl, leadName, formName, source, preview }) {
  if (!network || !member) return { ok: false, error: 'No member.' };
  const app = memberPortalLink(baseUrl, network, member);
  const leadsUrl = `${app}/referrals`;
  const who = String(leadName || 'New lead').trim().slice(0, 80);
  const kind = source === 'agency' ? 'Your agency sent a lead' : 'New website lead';
  const memberLeadRequests = require('./memberLeadRequests');
  const detailsAllowed = await memberLeadRequests.planAllowsLeadDetails(network, member)
    .catch(() => false);
  if (!detailsAllowed) {
    return messageMember(network, member, {
      sms: `${brandView(network).appName}: ${kind} — “${who}”. Upgrade to unlock details: ${leadsUrl}`,
      subject: `${kind}: ${who}`,
      email: `${kind} for ${member.companyName}.\n\nProject: ${who}\n\nUpgrade to a paid plan to see phone, email, and notes:\n${leadsUrl}`,
    });
  }
  const detail = [formName, preview].filter(Boolean).join(' — ').slice(0, 160);
  const sms = `${brandView(network).appName}: ${kind} — ${who}${detail ? ` (${detail})` : ''}. Open: ${leadsUrl}`;
  recordMemberActivity(network, member, {
    kind: source === 'agency' ? 'agency' : 'form',
    title: kind,
    body: detail ? `${who} · ${detail}` : who,
    href: leadsUrl,
  });
  return messageMember(network, member, {
    sms,
    subject: `${kind}: ${who}`,
    email: `${kind} for ${member.companyName}.\n\n${who}${detail ? `\n${detail}` : ''}\n\nOpen your app:\n${leadsUrl}`,
  });
}

function firstNameFromMember(member) {
  const contact = String((member && member.contactName) || '').trim();
  if (contact) return contact.split(/\s+/)[0].slice(0, 40);
  const company = String((member && member.companyName) || '').trim();
  if (company) return company.split(/\s+/)[0].slice(0, 40);
  return 'there';
}

/** Portal SMS for free-app / AdHello Referral Network members (reviews link only). */
function freeAppPortalSms({ firstName, reviewsLink }) {
  return [
    `Hey ${firstName} — you’re in the AdHello Referral Network!`,
    `Quickest win: start collecting free reviews right here → ${reviewsLink}`,
    'After that, handle customers, jobs, and referrals in the app. Tip: Share → Add to Home Screen.',
  ].join('\n');
}

/** Free signups + anyone on the host Agency network get Referral Network copy. */
function usesReferralNetworkPortalSms(network, member) {
  if (String((member && member.plan) || '') === 'app_free') return true;
  const brand = brandView(network);
  const label = `${brand.appName || ''} ${network && network.name ? network.name : ''}`;
  return /adhello/i.test(label) && /agency|referral\s*network/i.test(label);
}

async function sendMemberPortalLink({ network, member, baseUrl, welcome }) {
  const link = await memberPortalShortLink(baseUrl, network, member);
  const referralSms = usesReferralNetworkPortalSms(network, member);
  // Referral Network / free-app: land on Review QR, not the GHL ask form.
  const reviewPath = referralSms ? '/review' : '/review?ask=1';
  const reviewLink = await memberPortalShortLink(baseUrl, network, member, reviewPath);
  const app = brandView(network).appName;
  const sms = referralSms
    ? freeAppPortalSms({
      firstName: firstNameFromMember(member),
      reviewsLink: reviewLink,
    })
    : (welcome
      ? `Welcome to ${app}! Start with reviews: ${reviewLink} — then app home: ${link}. Tip: Share > Add to Home Screen`
      : `${app}: reviews ${reviewLink} · app ${link}. Tip: Share > Add to Home Screen`);
  return messageMember(network, member, {
    sms,
    subject: welcome ? `Welcome to ${referralSms ? 'the AdHello Referral Network' : app}` : `Your ${app} app — reviews first`,
    email: `${welcome ? `Welcome to ${referralSms ? 'the AdHello Referral Network' : app}!\n\n` : ''}Here is your ${referralSms ? 'AdHello Referral Network' : app} app. Open it on your phone to:\n1. Request Google reviews from customers\n2. Add and manage customers and jobs\n3. Send and receive referrals (and leads when linked)\n\nRequest a review:\n${reviewLink}\n\nApp home:\n${link}\n\nTip: on iPhone tap Share, then "Add to Home Screen" so it opens like an app.`,
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

/**
 * Member app “Request leads” — ping agency owners/admins that this business
 * wants more work. Used when no appointment package is linked yet.
 */
async function notifyLeadRequest({ network, member, quantity, note }) {
  const email = await operatorEmail(network);
  if (!email) return { ok: false, error: 'No agency owner email.' };
  const company = String((member && member.companyName) || 'A network member').trim().slice(0, 120);
  const qty = Math.max(1, Math.min(500, Math.round(Number(quantity) || 25)));
  const detail = String(note || '').trim().slice(0, 120);
  const title = `${company} requested ${qty} more leads — ready for more work!${detail ? ` (${detail})` : ''}`;
  try {
    const memberId = member && member.id ? String(member.id).trim() : '';
    const task = await upsertOpenTaskForLead(network.ownerWorkspaceId, email, {
      title: title.slice(0, 240),
      leadKey: (member && member.leadKey) || null,
      scheduledAt: new Date().toISOString(),
      source: TASK_SOURCE_NETWORK,
      href: memberId ? `/appointments?member=${encodeURIComponent(memberId)}` : '/appointments',
    });
    return { ok: true, taskId: task && task.id, title };
  } catch (err) {
    console.warn('[network] lead request task failed:', err.message);
    return { ok: false, error: err.message || 'Could not ping agency.' };
  }
}

/**
 * Customer tapped 4–5★ on a tracked review ask — ping the business to confirm
 * the public review before we send their referral-reward offer.
 */
async function notifyReviewRewardPending({ network, member, ask, baseUrl }) {
  if (!network || !member || !ask) return { ok: false, error: 'missing' };
  const reviewReferralReward = require('./reviewReferralReward');
  const settings = reviewReferralReward.settingsFromMember(member);
  if (!reviewReferralReward.qualifies(settings, ask.rating, member)) {
    return { ok: false, error: 'not_configured' };
  }
  const who = ask.name || 'A customer';
  const stars = ask.rating || 5;
  const portal = await memberPortalShortLink(
    baseUrl || getPublicBaseUrl(),
    network,
    member,
    ask.customerId
      ? `/customers/c/${encodeURIComponent(ask.customerId)}`
      : '/review',
  );
  const sms = `${brandView(network).appName}: ${who} chose ${stars}★ and may have left a review. Confirm it in the app to send your “${settings.rewardLabel}” referral offer: ${portal}`;
  const email = `${who} tapped ${stars}★ on your review page${ask.clickedAt ? ` and opened ${ask.clickPlatform || 'a review site'}` : ''}.\n\nConfirm the public review in your app, then we’ll text them your referral reward offer (${settings.rewardLabel}).\n\n${portal}`;
  const messaging = await messageMember(network, member, {
    sms,
    subject: `Confirm ${stars}★ review from ${who}`,
    email,
  }).catch((err) => ({ ok: false, error: err.message }));
  const token = createMemberPortalToken({ networkId: network.id, memberId: member.id });
  const deep = ask.customerId
    ? `/m/${encodeURIComponent(token)}/customers/c/${encodeURIComponent(ask.customerId)}`
    : `/m/${encodeURIComponent(token)}/review`;
  recordMemberActivity(network, member, {
    kind: 'review_reward',
    title: `${stars}★ — confirm review`,
    body: `${who} · then send “${settings.rewardLabel}” referral offer`,
    href: deep,
  });
  return messaging && messaging.ok !== false ? { ok: true, ...messaging } : (messaging || { ok: false });
}

/**
 * Text/email a teammate that a contact/lead (and their projects) were shared.
 */
async function notifyCustomerSharedWithTeammate({
  network,
  fromMember,
  toMember,
  customer,
  jobsShared = 0,
  focusJob = null,
  baseUrl,
}) {
  if (!network || !fromMember || !toMember || !customer) return { ok: false, error: 'missing' };
  const who = fromMember.contactName || fromMember.companyName || 'A teammate';
  const company = fromMember.companyName || brandView(network).appName;
  const cust = customer.name || 'a customer';
  const path = focusJob && focusJob.id
    ? `/customers/jobs/${encodeURIComponent(focusJob.id)}`
    : `/customers/c/${encodeURIComponent(customer.id)}`;
  const portal = await memberPortalShortLink(
    baseUrl || getPublicBaseUrl(),
    network,
    toMember,
    path,
  );
  const projectBit = jobsShared > 1
    ? `${jobsShared} projects`
    : (jobsShared === 1 ? '1 project' : 'their contact');
  const when = focusJob ? [focusJob.date, focusJob.time].filter(Boolean).join(' ') : '';
  const sms = focusJob
    ? [
      `${who} shared ${cust} with you (${projectBit})`,
      focusJob.title || 'Job',
      when,
      `Open: ${portal}`,
    ].filter(Boolean).join(' — ')
    : `${who} shared ${cust} with you (${projectBit}). Open: ${portal}`;
  const email = `${who} (${company}) shared a contact with you.\n\n`
    + `${cust}${customer.phone ? `\nPhone: ${customer.phone}` : ''}`
    + `${customer.address ? `\nAddress: ${customer.address}` : ''}`
    + `\nProjects shared: ${jobsShared}`
    + (focusJob ? `\nFocus job: ${focusJob.title || 'Job'}${when ? ` · ${when}` : ''}` : '')
    + `\n\nThey show on your calendar/customers only — not theirs.\n\n${portal}`;
  const messaging = await messageMember(network, toMember, {
    sms,
    subject: `${who} shared ${cust} with you`,
    email,
  }).catch((err) => ({ ok: false, error: err.message }));
  const token = createMemberPortalToken({ networkId: network.id, memberId: toMember.id });
  recordMemberActivity(network, toMember, {
    kind: 'customer_shared',
    title: 'Contact shared with you',
    body: `${cust} · ${projectBit}`,
    href: `/m/${encodeURIComponent(token)}${path}`,
  });
  return messaging && messaging.ok !== false ? { ok: true, ...messaging, portal } : (messaging || { ok: false });
}

/** @deprecated Prefer notifyCustomerSharedWithTeammate (shares contact + projects). */
async function notifyJobSharedWithTeammate(opts) {
  return notifyCustomerSharedWithTeammate({
    ...opts,
    jobsShared: opts.jobsShared != null ? opts.jobsShared : (opts.job ? 1 : 0),
    focusJob: opts.focusJob || opts.job || null,
  });
}

/** After the business confirms the public review, send the referral-reward offer. */
async function sendReviewReferralReward({ network, member, ask }) {
  if (!network || !member || !ask) return { ok: false, error: 'missing' };
  const reviewReferralReward = require('./reviewReferralReward');
  if (!reviewReferralReward.isPaidMember(member)) {
    return { ok: false, error: 'Referral rewards are on the monthly plan. Upgrade to unlock them.' };
  }
  const settings = reviewReferralReward.settingsFromMember(member);
  if (!reviewReferralReward.qualifies(settings, ask.rating || 5, member)) {
    return { ok: false, error: 'Reward offer is not set up. Add a gift/discount in Review settings.' };
  }
  if (!ask.phone && !ask.email) return { ok: false, error: 'No phone or email on this review request.' };
  const company = member.companyName || brandView(network).appName;
  const message = reviewReferralReward.buildCustomerMessage(settings, {
    name: ask.name || 'there',
    company,
    stars: ask.rating || 5,
  });
  const integrationEnv = await networkIntegrationEnv(network);
  const ready = ghlMessaging.messagingReady(integrationEnv);
  let sent = null;
  let error = '';
  if (ask.phone && ask.phone !== 'N/A' && ready.configured && ready.smsReady) {
    try {
      sent = await ghlMessaging.sendSmsToPerson({
        name: ask.name || 'there',
        phone: ask.phone,
        message,
        companyName: company,
        integrationEnv,
      });
    } catch (err) {
      error = err.message || 'sms_failed';
    }
  }
  if (!sent && ask.email && ready.configured && ready.emailReady) {
    try {
      sent = await ghlMessaging.sendEmailToPerson({
        name: ask.name || 'there',
        email: ask.email,
        subject: `Thank you from ${company}`,
        html: `<p>${message.replace(/\n/g, '<br>')}</p>`,
        text: message,
        companyName: company,
        integrationEnv,
      });
    } catch (err) {
      error = err.message || 'email_failed';
    }
  }
  if (!sent) {
    return {
      ok: false,
      error: error || (!ready.configured
        ? 'GHL CRM isn’t connected.'
        : 'Could not send the reward offer (need SMS or email ready).'),
    };
  }
  return { ok: true, message, messageId: sent.messageId || sent.id || '' };
}

module.exports = {
  baseUrlFromReq,
  reviewPageLink,
  getReviewPublicBaseUrl,
  referralLink,
  memberPortalLink,
  memberPortalShortLink,
  notifyReferralRecipient,
  notifyReferralPool,
  pushMemberReferralAlert,
  notifyMemberFormLead,
  sendMemberPortalLink,
  sendReviewRequest,
  messagingReadyForNetwork,
  notifyApplication,
  notifyFeedback,
  notifyLeadRequest,
  notifyReviewRewardPending,
  notifyCustomerSharedWithTeammate,
  notifyJobSharedWithTeammate,
  sendReviewReferralReward,
  messageMember,
  createOperatorTask,
  syncPartnerCounter,
  homeownerSummary,
};
