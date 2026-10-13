/**
 * Add Opportunity → free referral to workspace teammates (Team & assign),
 * without requiring an Appointments package / paid lead sale.
 */
const networkStore = require('./networkStore');
const networkReferrals = require('./networkReferrals');
const ownerReferralApp = require('./ownerReferralApp');
const workspaceService = require('./workspaceService');
const { getPublicBaseUrl } = require('../lib/publicBaseUrl');

function normEmail(email) {
  return String(email || '')
    .trim()
    .toLowerCase();
}

function displayNameForMember(meta, email) {
  const name = String((meta && (meta.name || meta.displayName || meta.contactName)) || '').trim();
  if (name) return name;
  const local = String(email || '').split('@')[0] || 'Teammate';
  return local.replace(/[._]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Workspace Team seats (excluding the actor) as free-referral push targets.
 * @returns {{ id: string, email: string, name: string, role: string, kind: 'teammate' }[]}
 */
function listTeammateTargets(workspace, actorEmail) {
  const actor = normEmail(actorEmail);
  const members = (workspace && workspace.members) || {};
  const out = [];
  const seen = new Set();

  for (const [rawEmail, meta] of Object.entries(members)) {
    const email = normEmail(rawEmail);
    if (!email || !meta || !meta.role) continue;
    if (actor && email === actor) continue;
    if (seen.has(email)) continue;
    const role = String(workspaceService.roleForEmail(workspace, email) || meta.role || 'viewer').toLowerCase();
    // Owners share the Get-the-app owner seat — free referrals go to staff/SDR/manager teammates.
    if (role === 'owner') continue;
    seen.add(email);
    const id = ownerReferralApp.staffMemberIdForEmail(email);
    if (!id) continue;
    out.push({
      id,
      email,
      name: displayNameForMember(meta, email),
      role,
      kind: 'teammate',
    });
  }

  out.sort((a, b) => a.name.localeCompare(b.name) || a.email.localeCompare(b.email));
  return out;
}

/**
 * Ensure a network member row exists for a workspace teammate email.
 */
async function ensureTeammateMember(network, workspace, email) {
  const em = normEmail(email);
  if (!em) return null;
  const asOwner = ownerReferralApp.isWorkspaceOwnerLogin(workspace, network, em);
  const id = asOwner ? ownerReferralApp.OWNER_MEMBER_ID : ownerReferralApp.staffMemberIdForEmail(em);
  let member = await networkStore.getMember(network.id, id);
  if (!member) {
    const members = await networkStore.listMembers(network.id);
    member = members.find((m) => normEmail(m.email) === em) || null;
  }
  const meta = (workspace.members && (workspace.members[em] || workspace.members[email])) || {};
  const contactName = displayNameForMember(meta, em);
  const companyName =
    (workspace && workspace.name && String(workspace.name).trim()) ||
    (network && network.name && String(network.name).trim()) ||
    'Workspace';

  if (!member) {
    return networkStore.saveMember(network.id, {
      id,
      companyName,
      contactName,
      email: em,
      status: 'active',
      workspaceStaff: !asOwner,
      joinedAt: new Date().toISOString(),
    });
  }

  const patch = {};
  if (member.status === 'paused') patch.status = 'active';
  if (!asOwner) patch.workspaceStaff = true;
  if (em && member.email !== em) patch.email = em;
  if (contactName && member.contactName !== contactName) patch.contactName = contactName;
  if (Object.keys(patch).length) {
    return networkStore.saveMember(network.id, { ...member, ...patch });
  }
  return member;
}

function pickTradeSlug(network) {
  const trades = Array.isArray(network && network.trades) ? network.trades.filter(Boolean) : [];
  return trades[0] || 'general';
}

/**
 * Send free referrals (not appointment packages) to workspace teammates.
 * @param {{
 *   workspace: object,
 *   workspaceId: string,
 *   memberIds?: string[],
 *   emails?: string[],
 *   lead: { name: string, phone?: string, email?: string, note?: string, city?: string, address?: string },
 *   actorEmail: string,
 *   baseUrl?: string,
 * }} opts
 */
async function deliverToTeammates(opts) {
  const workspace = opts.workspace || {};
  const workspaceId = opts.workspaceId || workspace.id;
  const actorEmail = normEmail(opts.actorEmail);
  const lead = opts.lead || {};
  const name = String(lead.name || lead.title || '').trim();
  if (!name) return { ok: false, error: 'Lead name is required.', delivered: [], skipped: [] };
  if (!String(lead.phone || '').trim() && !String(lead.email || '').trim()) {
    return {
      ok: false,
      error: 'Add a phone or email so teammates can follow up on this referral.',
      delivered: [],
      skipped: [],
    };
  }

  const network = await networkStore.getOrCreateNetworkForWorkspace(workspaceId, {
    name: (workspace.name && String(workspace.name).trim()) || 'Referral network',
    ownerEmail: actorEmail,
  });

  // Ensure trade catalog has at least one slug for buildReferral.
  let tradeSlug = pickTradeSlug(network);
  if (!network.trades.includes(tradeSlug)) {
    const trades = [...(network.trades || []), tradeSlug];
    await networkStore.saveNetwork({ ...network, trades });
    network.trades = trades;
  }

  const targets = listTeammateTargets(workspace, actorEmail);
  const byId = new Map(targets.map((t) => [t.id, t]));
  const byEmail = new Map(targets.map((t) => [t.email, t]));

  const wantedIds = Array.isArray(opts.memberIds)
    ? opts.memberIds.map((id) => String(id || '').trim()).filter(Boolean)
    : [];
  const wantedEmails = Array.isArray(opts.emails)
    ? opts.emails.map(normEmail).filter(Boolean)
    : [];

  const selected = [];
  const seen = new Set();
  for (const id of wantedIds) {
    const t = byId.get(id);
    if (t && !seen.has(t.id)) {
      seen.add(t.id);
      selected.push(t);
    }
  }
  for (const email of wantedEmails) {
    const t = byEmail.get(email);
    if (t && !seen.has(t.id)) {
      seen.add(t.id);
      selected.push(t);
    }
  }

  if (!selected.length) {
    return { ok: false, error: 'Pick at least one teammate.', delivered: [], skipped: [] };
  }

  const fromMemberId = ownerReferralApp.isWorkspaceOwnerLogin(workspace, network, actorEmail)
    ? ownerReferralApp.OWNER_MEMBER_ID
    : ownerReferralApp.staffMemberIdForEmail(actorEmail) || 'operator';

  // Ensure sender row exists when we use a staff/owner id.
  if (fromMemberId && fromMemberId !== 'operator') {
    await ensureTeammateMember(network, workspace, actorEmail);
  }

  const baseUrl = opts.baseUrl || getPublicBaseUrl() || '';
  const delivered = [];
  const skipped = [];

  for (const target of selected) {
    try {
      const member = await ensureTeammateMember(network, workspace, target.email);
      if (!member || member.status !== 'active') {
        skipped.push({ id: target.id, email: target.email, error: 'Teammate is not active.' });
        continue;
      }
      if (member.id === fromMemberId) {
        skipped.push({ id: target.id, email: target.email, error: 'Cannot send to yourself.' });
        continue;
      }
      const result = await networkReferrals.sendReferral({
        network,
        fromMemberId,
        by: actorEmail || 'workspace',
        toMemberId: member.id,
        input: {
          tradeSlug,
          name,
          phone: lead.phone || '',
          email: lead.email || '',
          city: lead.city || '',
          address: lead.address || '',
          note: String(lead.note || lead.preview || 'Free referral from workspace').slice(0, 1000),
          consent: true,
        },
        baseUrl,
      });
      if (!result.ok) {
        skipped.push({ id: target.id, email: target.email, error: result.error || 'Send failed.' });
        continue;
      }
      delivered.push({
        id: target.id,
        email: target.email,
        name: target.name,
        referralId: result.referral && result.referral.id,
      });
    } catch (err) {
      skipped.push({ id: target.id, email: target.email, error: (err && err.message) || 'Send failed.' });
    }
  }

  if (!delivered.length) {
    return {
      ok: false,
      error: (skipped[0] && skipped[0].error) || 'Could not send to teammates.',
      delivered,
      skipped,
      count: 0,
    };
  }

  return { ok: true, delivered, skipped, count: delivered.length };
}

module.exports = {
  listTeammateTargets,
  ensureTeammateMember,
  deliverToTeammates,
  pickTradeSlug,
};
