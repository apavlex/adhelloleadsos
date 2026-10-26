/**
 * GHL inbound alerts inside the Reviews (member) app bell.
 * - Website form leads: every active network member (push + Waiting on a reply).
 * - Missed calls / texts: workspace owner & staff who turn on the toggle.
 * Separate from Agency OS /notifications inbound (staff CRM bell).
 */
const dbService = require('./database');
const store = require('./networkStore');
const work = require('./memberWork');
const { isOwnerMember } = require('./memberAppointmentLink');
const {
  pendingInboundItems,
  MEMBER_INBOUND_ALERT_TYPES,
  GHL_ACTIVITY_TYPES,
  TYPE_LABELS,
} = require('./inboundEvents');
const workspaceIntegrations = require('./workspaceIntegrations');
const memberAppointmentLink = require('./memberAppointmentLink');
const { getPublicBaseUrl } = require('../lib/publicBaseUrl');
const { createMemberPortalToken } = require('./networkLinkSign');

/** In-app customer profile path (member portal base is prepended in the bell UI). */
function profileOpenHref(customer) {
  if (!customer || !customer.id) return '';
  return `/customers/c/${encodeURIComponent(customer.id)}`;
}

function looksLikeEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function inboundMatchFields(row) {
  const title = String((row && row.title) || '').trim();
  const email = String((row && row.email) || '').trim() || (looksLikeEmail(title) ? title : '');
  return {
    ghlContactId: row && row.ghlContactId,
    email,
    phone: row && row.phone,
  };
}

function matchCustomerForInbound(customers, row) {
  return work.findCustomerMatch(customers, inboundMatchFields(row));
}

/** Prefer website_form for form rows; keep referral / manual / csv when already set. */
function inboundCustomerSource(existingSource, rowType) {
  const preferred = String(rowType || '').trim().toLowerCase() === 'form' ? 'website_form' : 'ghl';
  const prev = String(existingSource || '').trim().toLowerCase();
  if (!prev) return preferred;
  if (preferred === 'website_form' && prev === 'ghl') return 'website_form';
  return prev;
}

function isFormInboundRow(row) {
  return String((row && row.type) || '').trim().toLowerCase() === 'form';
}

/** After create/match: website forms become Leads with a Website form tag. */
async function finalizeInboundCustomer(network, member, list, customer, row) {
  if (!customer) return null;
  let next = customer;
  if (isFormInboundRow(row)) {
    try {
      const memberCustomerGhl = require('./memberCustomerGhl');
      const stamped = await memberCustomerGhl.stampWebsiteFormLead(network, member.id, next);
      if (stamped.ok && stamped.customer) next = stamped.customer;
    } catch (err) {
      console.warn('[memberGhlAlerts] website form stamp failed:', err && err.message);
    }
  }
  const idx = list.findIndex((c) => c && c.id === next.id);
  if (idx >= 0) list[idx] = next;
  else list.push(next);
  return next;
}

/**
 * Match or create a Reviews-app customer so Open always has an in-app profile.
 * Never returns a CRM /focus or /pipeline path.
 */
async function ensureCustomerForInbound(network, member, customers, row) {
  const list = Array.isArray(customers) ? customers : [];
  const fields = inboundMatchFields(row);
  const existing = matchCustomerForInbound(list, row);
  if (existing) {
    // Patch GHL id / phone / email onto an existing match so Calls & texts can link.
    const nextSource = inboundCustomerSource(existing.source, row && row.type);
    const needGhl = fields.ghlContactId && !existing.ghlContactId;
    const needPhone = fields.phone && !existing.phone;
    const needEmail = fields.email && !existing.email;
    const needSource = nextSource !== existing.source;
    if (!needGhl && !needPhone && !needEmail && !needSource) {
      return finalizeInboundCustomer(network, member, list, existing, row);
    }
    const saved = await work.saveCustomer(
      network.id,
      member.id,
      {
        name: existing.name,
        phone: needPhone ? fields.phone : existing.phone,
        email: needEmail ? fields.email : existing.email,
        address: existing.address,
        notes: existing.notes,
      },
      {
        id: existing.id,
        ghlContactId: needGhl ? fields.ghlContactId : existing.ghlContactId,
        source: nextSource,
        tags: existing.tags,
        isReferralPartner: existing.isReferralPartner,
      },
    );
    if (saved.ok && saved.customer) {
      return finalizeInboundCustomer(network, member, list, saved.customer, row);
    }
    return finalizeInboundCustomer(network, member, list, existing, row);
  }

  const title = String((row && row.title) || '').trim();
  const name = looksLikeEmail(title)
    ? title.split('@')[0].replace(/[._]+/g, ' ').trim() || 'Contact'
    : (title || fields.phone || fields.email || 'Contact');
  if (!fields.ghlContactId && !fields.phone && !fields.email && !title) return null;

  const saved = await work.saveCustomer(
    network.id,
    member.id,
    {
      name: String(name).slice(0, 120) || 'Contact',
      phone: fields.phone || '',
      email: fields.email || '',
    },
    {
      ghlContactId: fields.ghlContactId || undefined,
      source: inboundCustomerSource('', row && row.type),
    },
  );
  if (!saved.ok || !saved.customer) return null;
  return finalizeInboundCustomer(network, member, list, saved.customer, row);
}

/** Active member on a workspace-backed network (receives website form lead alerts). */
function isActiveNetworkMember(member, network) {
  if (!member || !network || !String(network.ownerWorkspaceId || '').trim()) return false;
  if (member.status === 'paused') return false;
  return true;
}

/** Owner / workspace staff may opt into missed-call & text alerts. */
function canUseGhlAlerts(member, network) {
  if (!isActiveNetworkMember(member, network)) return false;
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

function allowInboundTypeForMember(type, member, network) {
  const t = String(type || '').trim().toLowerCase();
  if (!MEMBER_INBOUND_ALERT_TYPES.has(t)) return false;
  if (!isActiveNetworkMember(member, network)) return false;
  // Website forms fan out to the whole business network.
  if (t === 'form') return true;
  // Missed calls / texts stay behind the owner/staff toggle.
  return canUseGhlAlerts(member, network) && isEnabled(member);
}

/**
 * Pending GHL inbound for the Reviews bell.
 * Forms: every active network member. Calls/texts: owner/staff with toggle on.
 */
async function listPendingForMember(member, network, opts = {}) {
  if (!isActiveNetworkMember(member, network)) return [];
  const wid = String(network.ownerWorkspaceId || '').trim();
  if (!wid) return [];
  // Website Lead Connector forms often create a GHL contact without a Form
  // Submitted webhook. Pull recent contacts so Reviews still gets the ping.
  if (!opts.skipFormSync) {
    try {
      const ghlFormLeadSync = require('./ghlFormLeadSync');
      await ghlFormLeadSync.syncRecentFormLeads(wid, {
        force: !!opts.forceFormSync,
        maxAgeMs: opts.formSyncMaxAgeMs,
        notifyMaxAgeMs: opts.formNotifyMaxAgeMs,
      });
    } catch (err) {
      console.warn('[memberGhlAlerts] form lead sync failed:', err && err.message);
    }
  }
  const leads = await dbService.getAllLeads(wid);
  const ghl = await ghlLinkContext(wid);
  const rows = pendingInboundItems(leads, {
    ...ghl,
    now: opts.now,
    days: opts.days,
    limit: opts.limit || 25,
  }).filter((row) => row && allowInboundTypeForMember(row.type, member, network));

  const customers = await work.listCustomers(network.id, member.id);
  const out = [];
  for (const row of rows) {
    // eslint-disable-next-line no-await-in-loop
    const customer = await ensureCustomerForInbound(network, member, customers, row);
    // Open is ONLY the Reviews-app profile. Never /focus, /pipeline, or GHL —
    // those paths hit the leads workspace login when opened from /m/:token.
    const openHref = customer ? profileOpenHref(customer) : '/customers';
    out.push({
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
      customerId: customer ? customer.id : '',
      ghlHref: row.ghlHref || '',
      callOpensLeadConnector: !!row.callOpensLeadConnector,
      handled: false,
      read: false,
    });
  }
  return out;
}

async function markLeadDone(member, network, leadKey) {
  if (!isActiveNetworkMember(member, network)) {
    return { ok: false, error: 'Member required.' };
  }
  const wid = String(network.ownerWorkspaceId || '').trim();
  const raw = String(leadKey || '').trim();
  if (!wid || !raw) return { ok: false, error: 'Lead required.' };
  // Same resolution path as Agency OS /today/inbound/done — short keys and
  // storage keys both resolve before the handled stamp is written.
  const storageKey = (await dbService.resolveLeadStorageKey(raw, wid)) || raw;
  const lead = await dbService.getLead(storageKey, wid);
  if (!lead) return { ok: false, error: 'Lead not found.' };
  await dbService.updateLead(lead.key || storageKey, { inboundHandledAt: new Date().toISOString() }, wid);
  return { ok: true, leadKey: lead.key || storageKey };
}

/** Clear every pending GHL inbound row shown under Waiting on a reply. */
async function markAllPendingDone(member, network, opts = {}) {
  if (!isActiveNetworkMember(member, network)) {
    return { ok: false, error: 'Member required.', updated: 0 };
  }
  const pending = await listPendingForMember(member, network, opts);
  const keys = [...new Set(pending.map((row) => String(row && row.leadKey || '').trim()).filter(Boolean))];
  let updated = 0;
  for (const key of keys) {
    // eslint-disable-next-line no-await-in-loop
    const done = await markLeadDone(member, network, key);
    if (done && done.ok) updated += 1;
  }
  return { ok: true, updated };
}

function memberAppUrl(network, member, path = '') {
  const token = createMemberPortalToken({ networkId: network.id, memberId: member.id });
  const base = getPublicBaseUrl();
  const suffix = path ? (String(path).startsWith('/') ? path : `/${path}`) : '';
  return `${base}/m/${encodeURIComponent(token)}${suffix}`;
}

/**
 * Fire-and-forget phone push + in-app activity.
 * Forms → every active network member. Calls/texts → opted-in owners/staff.
 * Never throws.
 */
function notifyEnabledMembers({ workspaceId, lead, event } = {}) {
  const wid = String(workspaceId || (lead && lead.workspaceId) || '').trim();
  const type = String((event && event.type) || '').trim().toLowerCase();
  if (!wid || !lead || !MEMBER_INBOUND_ALERT_TYPES.has(type)) {
    return Promise.resolve({ sent: 0, members: 0 });
  }
  return (async () => {
    const network = await store.getNetworkForWorkspace(wid);
    if (!network) return { sent: 0, members: 0 };
    const members = (await store.listMembers(network.id)).filter(
      (m) => allowInboundTypeForMember(type, m, network),
    );
    if (!members.length) return { sent: 0, members: 0 };

    const memberActivity = require('./memberActivity');
    const push = require('./pushNotifications');
    const { websiteFormLabel } = require('./websiteFormLabel');
    const who = String(lead.title || lead.name || '').trim()
      || String(lead.phone || '').trim()
      || 'Unknown contact';
    const typeLabel = TYPE_LABELS[type] || type;
    const rawLabel = String((event && event.label) || lead.inboundFormName || '').trim();
    const preview = String((event && event.preview) || '').replace(/\s+/g, ' ').trim();

    const customersByMember = new Map();
    let sent = 0;
    for (const member of members) {
      let customers = customersByMember.get(member.id);
      if (!customers) {
        customers = await work.listCustomers(network.id, member.id);
        customersByMember.set(member.id, customers);
      }
      // Always create/match a Reviews profile so the tap opens the lead card.
      // eslint-disable-next-line no-await-in-loop
      const customer = await ensureCustomerForInbound(network, member, customers, {
        title: who,
        ghlContactId: lead.ghlContactId,
        email: lead.email,
        phone: lead.phone,
        type,
      });
      const path = customer ? profileOpenHref(customer) : '/customers';
      const href = memberAppUrl(network, member, path);
      // eslint-disable-next-line no-await-in-loop
      const pkg = await memberAppointmentLink.findPackageForMember(wid, member, network).catch(() => null);
      const formLabel = type === 'form'
        ? websiteFormLabel({
          formName: lead.inboundFormName,
          label: rawLabel,
          websiteUrl: (pkg && pkg.websiteUrl) || lead.website || '',
          businessName: (pkg && pkg.businessName) || '',
          companyName: member.companyName || '',
        })
        : rawLabel;
      const title = type === 'form'
        ? `New website lead: ${who}`.slice(0, 120)
        : `${typeLabel}: ${who}`.slice(0, 120);
      const body = type === 'form'
        ? [formLabel, preview].filter(Boolean).join(' · ').slice(0, 200) || 'Open to call them.'
        : ([rawLabel, preview].filter(Boolean).join(' · ').slice(0, 200)
          || (type === 'sms' ? 'Tap to reply in Lead Connector.' : 'Tap to call back.'));
      memberActivity.add(network.id, member.id, {
        kind: type,
        title: title.slice(0, 140),
        body,
        href,
      });
      try {
        const result = await push.sendMemberPush(
          {
            networkId: network.id,
            memberId: member.id,
            packageId: pkg && pkg.portalEnabled !== false ? pkg.id : undefined,
            workspaceId: wid,
          },
          {
            title,
            body,
            url: href,
            // Stable tag so ContactCreate + Form sync replace instead of stacking.
            tag: `member-ghl-${type}-${String(lead.ghlContactId || lead.key || '').slice(0, 48)}`,
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
  isActiveNetworkMember,
  allowInboundTypeForMember,
  inboundCustomerSource,
  isEnabled,
  setEnabled,
  listPendingForMember,
  markLeadDone,
  markAllPendingDone,
  notifyEnabledMembers,
  ghlLinkContext,
  GHL_ACTIVITY_TYPES,
};
