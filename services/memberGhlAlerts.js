/**
 * Optional GHL missed-call / text alerts inside the Reviews (member) app bell.
 * Off by default — owners and workspace staff can turn them on per member.
 * Separate from Agency OS /notifications inbound (staff CRM bell).
 */
const dbService = require('./database');
const store = require('./networkStore');
const { isOwnerMember } = require('./memberAppointmentLink');
const {
  pendingInboundItems,
  GHL_ACTIVITY_TYPES,
  TYPE_LABELS,
} = require('./inboundEvents');
const workspaceIntegrations = require('./workspaceIntegrations');
const memberAppointmentLink = require('./memberAppointmentLink');
const { getPublicBaseUrl } = require('../lib/publicBaseUrl');
const { createMemberPortalToken } = require('./networkLinkSign');

function canUseGhlAlerts(member, network) {
  if (!member || !network || !String(network.ownerWorkspaceId || '').trim()) return false;
  if (member.status === 'paused') return false;
  return !!(member.workspaceStaff || isOwnerMember(member, network));
}

function isEnabled(member) {
  return !!(member && member.ghlAlertsEnabled);
}

async function setEnabled(network, member, enabled) {
  if (!network || !member) return { ok: false, error: 'Missing member.' };
  if (!canUseGhlAlerts(member, network)) {
    return { ok: false, error: 'GHL call & text alerts are for the workspace owner and team.' };
  }
  const saved = await store.saveMember(network.id, {
    ...member,
    ghlAlertsEnabled: !!enabled,
  });
  return { ok: true, member: saved, enabled: isEnabled(saved) };
}

async function ghlLinkContext(workspaceId) {
  const env = await workspaceIntegrations.getResolvedIntegrationEnv(workspaceId);
  return {
    locationId: String((env && env.GHL_LOCATION_ID) || '').trim(),
    dashboardUrl: String((env && env.GHL_DASHBOARD_URL) || process.env.GHL_DASHBOARD_URL || '').trim(),
  };
}

/**
 * Pending GHL missed calls / voicemails / texts for the Reviews bell.
 * Empty when the toggle is off or the member cannot use GHL alerts.
 */
async function listPendingForMember(member, network, opts = {}) {
  if (!isEnabled(member) || !canUseGhlAlerts(member, network)) return [];
  const wid = String(network.ownerWorkspaceId || '').trim();
  if (!wid) return [];
  const leads = await dbService.getAllLeads(wid);
  const ghl = await ghlLinkContext(wid);
  const rows = pendingInboundItems(leads, {
    ...ghl,
    now: opts.now,
    days: opts.days,
    limit: opts.limit || 25,
  }).filter((row) => row && GHL_ACTIVITY_TYPES.has(row.type));

  return rows.map((row) => {
    const openHref = row.ghlHref || row.callHref || '';
    return {
      id: `ghl:${row.leadKey}:${row.type}:${row.at}`,
      kind: row.type,
      source: 'ghl',
      leadKey: row.leadKey,
      short: row.short,
      title: row.title,
      body: [row.typeLabel, row.label, row.preview].filter(Boolean).join(' · ').slice(0, 280),
      typeLabel: row.typeLabel || TYPE_LABELS[row.type] || row.type,
      label: row.label || '',
      preview: row.preview || '',
      at: row.at,
      callHref: row.callHref || '',
      openHref,
      callOpensLeadConnector: !!row.callOpensLeadConnector,
      handled: false,
      read: false,
    };
  });
}

async function markLeadDone(member, network, leadKey) {
  if (!canUseGhlAlerts(member, network) || !isEnabled(member)) {
    return { ok: false, error: 'Turn on GHL alerts first.' };
  }
  const wid = String(network.ownerWorkspaceId || '').trim();
  const key = String(leadKey || '').trim();
  if (!wid || !key) return { ok: false, error: 'Lead required.' };
  const lead = await dbService.getLead(key, wid);
  if (!lead) return { ok: false, error: 'Lead not found.' };
  await dbService.updateLead(lead.key || key, { inboundHandledAt: new Date().toISOString() }, wid);
  return { ok: true };
}

function memberAppUrl(network, member, path = '') {
  const token = createMemberPortalToken({ networkId: network.id, memberId: member.id });
  const base = getPublicBaseUrl();
  const suffix = path ? (String(path).startsWith('/') ? path : `/${path}`) : '';
  return `${base}/m/${encodeURIComponent(token)}${suffix}`;
}

/**
 * Fire-and-forget phone push + keep in-app activity for Reviews members who opted in.
 * Never throws.
 */
function notifyEnabledMembers({ workspaceId, lead, event } = {}) {
  const wid = String(workspaceId || (lead && lead.workspaceId) || '').trim();
  const type = String((event && event.type) || '').trim().toLowerCase();
  if (!wid || !lead || !GHL_ACTIVITY_TYPES.has(type)) {
    return Promise.resolve({ sent: 0, members: 0 });
  }
  return (async () => {
    const network = await store.getNetworkForWorkspace(wid);
    if (!network) return { sent: 0, members: 0 };
    const members = (await store.listMembers(network.id)).filter(
      (m) => canUseGhlAlerts(m, network) && isEnabled(m),
    );
    if (!members.length) return { sent: 0, members: 0 };

    const memberActivity = require('./memberActivity');
    const push = require('./pushNotifications');
    const who = String(lead.title || lead.name || '').trim()
      || String(lead.phone || '').trim()
      || 'Unknown contact';
    const typeLabel = TYPE_LABELS[type] || type;
    const label = String((event && event.label) || '').trim();
    const preview = String((event && event.preview) || '').replace(/\s+/g, ' ').trim();
    const body = [label, preview].filter(Boolean).join(' · ').slice(0, 200)
      || (type === 'sms' ? 'Tap to reply in Lead Connector.' : 'Tap to call back.');

    let sent = 0;
    for (const member of members) {
      const href = memberAppUrl(network, member);
      memberActivity.add(network.id, member.id, {
        kind: type,
        title: `${typeLabel}: ${who}`.slice(0, 140),
        body,
        href,
      });
      try {
        const pkg = await memberAppointmentLink.findPackageForMember(wid, member, network);
        if (!pkg || pkg.portalEnabled === false) continue;
        const result = await push.sendPortalPush(
          { packageId: pkg.id, workspaceId: wid },
          {
            title: `${typeLabel}: ${who}`.slice(0, 120),
            body,
            url: href,
            tag: `member-ghl-${type}-${String(lead.key || '').slice(0, 40)}`,
          },
        );
        sent += (result && result.sent) || 0;
      } catch (err) {
        console.warn('[memberGhlAlerts] push failed:', err && err.message);
      }
    }
    return { sent, members: members.length };
  })().catch((err) => {
    console.warn('[memberGhlAlerts] notify failed:', err && err.message);
    return { sent: 0, members: 0 };
  });
}

module.exports = {
  canUseGhlAlerts,
  isEnabled,
  setEnabled,
  listPendingForMember,
  markLeadDone,
  notifyEnabledMembers,
  ghlLinkContext,
};
