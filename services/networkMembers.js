/**
 * Member signup side effects: create the business's GHL sub-account and turn
 * an invited business (application) into a network member.
 */

const dbService = require('./database');
const store = require('./networkStore');
const trades = require('./networkTrades');
const notify = require('./networkNotify');
const networkReferrals = require('./networkReferrals');
const referralNetwork = require('./referralNetwork');
const workspaceIntegrations = require('./workspaceIntegrations');
const ghlSubaccounts = require('./ghlSubaccounts');
const { isAgencySalesWorkspace } = require('./leadPanelWorkspace');

const GHL_TIMEOUT_MS = 30000;

/** GHL sub-accounts are an agency feature; vertical workspaces (e.g. Flooring) never create them. */
function ghlSubaccountsAllowedFor(workspace) {
  return isAgencySalesWorkspace(workspace);
}

async function ghlSubaccountsAllowed(network) {
  const ws = network && network.ownerWorkspaceId ? await dbService.getWorkspace(network.ownerWorkspaceId) : null;
  return ghlSubaccountsAllowedFor(ws);
}

function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); }),
  ]).finally(() => clearTimeout(timer));
}

/**
 * Create (or link) the member's GHL sub-account from their operator lead and
 * record the outcome on the member. Never throws.
 */
async function provisionGhlSubaccount(network, member, { createForLead = ghlSubaccounts.createSubaccountForLead } = {}) {
  const now = new Date().toISOString();
  const lead = member.leadKey ? await dbService.getLead(member.leadKey, network.ownerWorkspaceId) : null;
  let result;
  if (!lead || !lead.key) {
    result = { ok: false, error: 'The member has no saved lead to build the sub-account from.' };
  } else {
    if (!lead.workspaceId) lead.workspaceId = network.ownerWorkspaceId;
    try {
      const integrationEnv = await workspaceIntegrations.getResolvedIntegrationEnv(network.ownerWorkspaceId);
      result = await withTimeout(createForLead(lead, integrationEnv), GHL_TIMEOUT_MS, 'GHL took too long to respond.');
    } catch (err) {
      result = { ok: false, error: err.message || 'GHL sub-account failed.' };
    }
  }
  const saved = await store.saveMember(network.id, {
    ...member,
    ghlLocationId: result.ok ? result.locationId : member.ghlLocationId,
    ghlSubaccountUrl: result.ok ? (result.url || '') : member.ghlSubaccountUrl,
    ghlError: result.ok ? '' : String(result.error || 'GHL sub-account failed.'),
    ghlAttemptedAt: now,
  });
  return { ...result, member: saved };
}

function ghlNotice(result) {
  if (!result) return '';
  if (result.ok && result.created) return ' GHL sub-account created.';
  if (result.ok) return ' Linked their existing GHL sub-account.';
  return ` GHL sub-account not created: ${String(result.error || 'unknown error').replace(/[.\s]+$/, '')}.`;
}

async function approveApplication({ network, applicationId, zoneIds, tradeSlugs, baseUrl, provision = provisionGhlSubaccount }) {
  const application = await store.getApplication(network.id, applicationId);
  if (!application) return { ok: false, error: 'Application not found.' };
  if (application.status !== 'pending') return { ok: false, error: `That application was already ${application.status}.` };

  const chosenTrades = trades.normalizeTradeSlugs(tradeSlugs && tradeSlugs.length ? tradeSlugs : [application.tradeSlug])
    .filter((slug) => network.trades.includes(slug));
  if (!chosenTrades.length) return { ok: false, error: 'Pick at least one trade for the new member.' };

  const saved = await dbService.saveLeadWithMeta({
    workspaceId: network.ownerWorkspaceId,
    title: application.companyName,
    contactName: application.contactName || '',
    phone: application.phone || 'N/A',
    email: application.email || 'N/A',
    city: application.city || '',
    categoryName: trades.tradeLabel(chosenTrades[0], network),
    source: 'network_application',
    message: application.note || `Invited to ${network.name}`,
  });
  const lead = await dbService.getLead(saved.key, network.ownerWorkspaceId);
  if (!lead || !lead.key) return { ok: false, error: 'Could not save the business as a lead.' };
  const connected = referralNetwork.applyPartnerAction(lead, 'connect');
  if (connected.ok) await dbService.updateLead(lead.key, { referralPartner: connected.referralPartner }, network.ownerWorkspaceId);

  const existing = await store.findMemberByLeadKey(network.id, lead.key);
  const { member, conflicts } = await networkReferrals.saveMemberWithSeats(network, {
    ...(existing || {}),
    leadKey: lead.key,
    companyName: application.companyName,
    contactName: application.contactName,
    phone: application.phone,
    email: application.email,
    invitedByMemberId: application.invitedByMemberId,
    status: 'active',
  }, { trades: chosenTrades, zoneIds: zoneIds || [] });

  let ghl = null;
  let current = member;
  if (network.autoGhlSubaccount && await ghlSubaccountsAllowed(network)) {
    ghl = await provision(network, member);
    if (ghl && ghl.member) current = ghl.member;
  }
  const notified = await notify.sendMemberPortalLink({ network, member: current, baseUrl, welcome: true })
    .catch((err) => ({ ok: false, error: err.message }));

  await store.saveApplication(network.id, {
    ...application,
    status: 'approved',
    memberId: current.id,
    decidedAt: new Date().toISOString(),
  });
  return { ok: true, member: current, conflicts, ghl, notified };
}

async function rejectApplication({ network, applicationId }) {
  const application = await store.getApplication(network.id, applicationId);
  if (!application) return { ok: false, error: 'Application not found.' };
  if (application.status !== 'pending') return { ok: false, error: `That application was already ${application.status}.` };
  const saved = await store.saveApplication(network.id, { ...application, status: 'rejected', decidedAt: new Date().toISOString() });
  return { ok: true, application: saved };
}

module.exports = {
  ghlSubaccountsAllowedFor,
  ghlSubaccountsAllowed,
  provisionGhlSubaccount,
  ghlNotice,
  approveApplication,
  rejectApplication,
};
