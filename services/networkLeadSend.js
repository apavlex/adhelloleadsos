/**
 * Leads Network → Send lead to Reviews-app users.
 * Same-network teammates (multi-select / all) plus cross-workspace directory
 * for owners/admins/managers: deliver into each recipient’s own network so
 * their Reviews app gets SMS / in-app / push + accept flow.
 */

const store = require('./networkStore');
const networkReferrals = require('./networkReferrals');
const trades = require('./networkTrades');
const dbService = require('./database');
const workspaceBootstrap = require('./workspaceBootstrap');
const workspaceService = require('./workspaceService');

function memberLabel(member) {
  if (!member) return 'Teammate';
  return String(member.companyName || member.contactName || member.email || 'Teammate').trim() || 'Teammate';
}

function recipientKey(networkId, memberId) {
  return `${String(networkId || '').trim()}:${String(memberId || '').trim()}`;
}

function parseRecipientKey(raw) {
  const s = String(raw || '').trim();
  const i = s.indexOf(':');
  if (i <= 0) return null;
  const networkId = s.slice(0, i).trim();
  const memberId = s.slice(i + 1).trim();
  if (!networkId || !memberId) return null;
  return { networkId, memberId, key: recipientKey(networkId, memberId) };
}

/**
 * Active network members who can receive a lead in their Reviews app.
 * @returns {{ id: string, name: string, email: string, contactName: string }[]}
 */
function listLeadTeammates(members) {
  const list = Array.isArray(members) ? members : [];
  return list
    .filter((m) => m && m.id && m.status === 'active')
    .map((m) => ({
      id: m.id,
      name: memberLabel(m),
      email: String(m.email || '').trim(),
      contactName: String(m.contactName || '').trim(),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function pickTradeSlug(network) {
  const catalog = trades.tradesForNetwork(network) || [];
  if (catalog.length) return catalog[0].slug;
  const raw = Array.isArray(network && network.trades) ? network.trades.filter(Boolean) : [];
  return raw[0] || 'general';
}

/**
 * Workspaces where this user is owner/admin/manager (can assign work).
 * @param {string} userEmail
 * @returns {Promise<{ id: string, name: string, role: string }[]>}
 */
async function listManageableWorkspaces(userEmail) {
  const email = String(userEmail || '').trim();
  if (!email) return [];
  const ids = await workspaceBootstrap.collectWorkspaceIdsForEmail(email);
  const out = [];
  for (const id of ids) {
    // eslint-disable-next-line no-await-in-loop
    const ws = await dbService.getWorkspace(id);
    if (!ws || !workspaceBootstrap.userCanAccessWorkspace(ws, email)) continue;
    const role = workspaceService.roleForEmail(ws, email);
    if (!workspaceService.canAssignWork(role)) continue;
    out.push({
      id,
      name: String(ws.name || ws.slug || id).trim() || id,
      role,
    });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/**
 * Reviews-app recipients across every workspace this admin/manager can manage.
 * @param {{ userEmail: string, q?: string, limit?: number }} opts
 * @returns {Promise<{ key: string, networkId: string, memberId: string, name: string, contactName: string, email: string, workspaceId: string, workspaceName: string }[]>}
 */
async function listDirectoryRecipients(opts = {}) {
  const workspaces = await listManageableWorkspaces(opts.userEmail);
  const q = String(opts.q || '').trim().toLowerCase();
  const limit = Math.min(400, Math.max(20, parseInt(opts.limit, 10) || 200));
  const rows = [];
  const seen = new Set();

  for (const ws of workspaces) {
    // eslint-disable-next-line no-await-in-loop
    const network = await store.getNetworkForWorkspace(ws.id);
    if (!network || !network.id) continue;
    // eslint-disable-next-line no-await-in-loop
    const members = await store.listMembers(network.id);
    for (const m of members) {
      if (!m || !m.id || m.status !== 'active') continue;
      const key = recipientKey(network.id, m.id);
      if (seen.has(key)) continue;
      seen.add(key);
      const name = memberLabel(m);
      const contactName = String(m.contactName || '').trim();
      const email = String(m.email || '').trim();
      if (q) {
        const hay = `${name} ${contactName} ${email} ${ws.name}`.toLowerCase();
        if (!hay.includes(q)) continue;
      }
      rows.push({
        key,
        networkId: network.id,
        memberId: m.id,
        name,
        contactName,
        email,
        workspaceId: ws.id,
        workspaceName: ws.name,
      });
    }
  }

  rows.sort((a, b) => {
    const byName = a.name.localeCompare(b.name);
    if (byName) return byName;
    return a.workspaceName.localeCompare(b.workspaceName);
  });
  return rows.slice(0, limit);
}

async function ensureTradeSlug(network) {
  let tradeSlug = pickTradeSlug(network);
  if (!Array.isArray(network.trades) || !network.trades.includes(tradeSlug)) {
    const nextTrades = [...(network.trades || []), tradeSlug];
    await store.saveNetwork({ ...network, trades: nextTrades });
    network.trades = nextTrades;
  }
  return tradeSlug;
}

async function deliverToMember({ network, member, lead, by, baseUrl, note }) {
  const tradeSlug = await ensureTradeSlug(network);
  const result = await networkReferrals.sendReferral({
    network,
    fromMemberId: 'operator',
    by,
    toMemberId: member.id,
    baseUrl,
    input: {
      tradeSlug,
      name: lead.name,
      phone: lead.phone || '',
      email: lead.email || '',
      city: lead.city || '',
      zip: lead.zip || '',
      address: lead.address || '',
      note,
      consent: true,
    },
  });
  return result;
}

/**
 * @param {{
 *   network: object,
 *   members?: object[],
 *   memberIds?: string[],
 *   sendAll?: boolean,
 *   lead: { name: string, phone?: string, email?: string, note?: string, city?: string, zip?: string, address?: string },
 *   by?: string,
 *   baseUrl?: string,
 * }} opts
 */
async function sendLeadToTeammates(opts) {
  const network = opts.network;
  if (!network || !network.id) {
    return { ok: false, error: 'Network not found.', delivered: [], skipped: [], count: 0 };
  }
  const lead = opts.lead || {};
  const name = String(lead.name || '').trim();
  if (!name) return { ok: false, error: 'Add the lead’s name.', delivered: [], skipped: [], count: 0 };
  if (!String(lead.phone || '').trim() && !String(lead.email || '').trim()) {
    return {
      ok: false,
      error: 'Add a phone or email so teammates can follow up.',
      delivered: [],
      skipped: [],
      count: 0,
    };
  }

  const members = Array.isArray(opts.members) ? opts.members : await store.listMembers(network.id);
  const teammates = listLeadTeammates(members);
  if (!teammates.length) {
    return {
      ok: false,
      error: 'No active teammates yet. Add members on Referral Leads first.',
      delivered: [],
      skipped: [],
      count: 0,
    };
  }

  let selected;
  if (opts.sendAll) {
    selected = teammates.slice();
  } else {
    const wanted = new Set(
      (Array.isArray(opts.memberIds) ? opts.memberIds : [])
        .map((id) => String(id || '').trim())
        .filter(Boolean),
    );
    selected = teammates.filter((t) => wanted.has(t.id));
  }

  if (!selected.length) {
    return { ok: false, error: 'Pick at least one teammate (or send to all).', delivered: [], skipped: [], count: 0 };
  }

  const by = String(opts.by || 'operator').trim() || 'operator';
  const baseUrl = opts.baseUrl || '';
  const note = String(lead.note || '').trim().slice(0, 1000) || 'Lead from Leads Network';
  const delivered = [];
  const skipped = [];

  for (const target of selected) {
    try {
      const member = members.find((m) => m.id === target.id) || { id: target.id, companyName: target.name };
      const result = await deliverToMember({
        network,
        member,
        lead: { ...lead, name },
        by,
        baseUrl,
        note,
      });
      if (!result.ok) {
        skipped.push({ id: target.id, name: target.name, error: result.error || 'Send failed.' });
        continue;
      }
      delivered.push({
        id: target.id,
        name: target.name,
        referralId: result.referral && result.referral.id,
        notified: !!(result.notified && result.notified.ok),
        networkId: network.id,
      });
    } catch (err) {
      skipped.push({ id: target.id, name: target.name, error: (err && err.message) || 'Send failed.' });
    }
  }

  if (!delivered.length) {
    return {
      ok: false,
      error: (skipped[0] && skipped[0].error) || 'Could not send that lead.',
      delivered,
      skipped,
      count: 0,
    };
  }

  return { ok: true, delivered, skipped, count: delivered.length };
}

/**
 * Send a lead into each recipient’s own Reviews-app network (cross-workspace).
 * Caller must only pass recipients from listDirectoryRecipients for this user.
 *
 * @param {{
 *   userEmail: string,
 *   targets: Array<string|{ networkId: string, memberId: string, key?: string }>,
 *   lead: object,
 *   by?: string,
 *   baseUrl?: string,
 * }} opts
 */
async function sendLeadAcrossWorkspaces(opts) {
  const lead = opts.lead || {};
  const name = String(lead.name || '').trim();
  if (!name) return { ok: false, error: 'Add the lead’s name.', delivered: [], skipped: [], count: 0 };
  if (!String(lead.phone || '').trim() && !String(lead.email || '').trim()) {
    return {
      ok: false,
      error: 'Add a phone or email so they can follow up.',
      delivered: [],
      skipped: [],
      count: 0,
    };
  }

  const allowed = await listDirectoryRecipients({ userEmail: opts.userEmail, limit: 500 });
  const allowedByKey = new Map(allowed.map((r) => [r.key, r]));

  const wanted = [];
  for (const raw of Array.isArray(opts.targets) ? opts.targets : []) {
    const parsed = typeof raw === 'string'
      ? parseRecipientKey(raw)
      : raw && raw.networkId && raw.memberId
        ? { networkId: String(raw.networkId).trim(), memberId: String(raw.memberId).trim(), key: recipientKey(raw.networkId, raw.memberId) }
        : null;
    if (!parsed) continue;
    const row = allowedByKey.get(parsed.key);
    if (!row) {
      wanted.push({ ...parsed, denied: true, name: parsed.memberId });
      continue;
    }
    wanted.push(row);
  }

  if (!wanted.length) {
    return { ok: false, error: 'Pick at least one Reviews-app user.', delivered: [], skipped: [], count: 0 };
  }

  const by = String(opts.by || 'operator').trim() || 'operator';
  const baseUrl = opts.baseUrl || '';
  const note = String(lead.note || '').trim().slice(0, 1000) || 'Lead from Agency OS';
  const delivered = [];
  const skipped = [];

  for (const target of wanted) {
    if (target.denied) {
      skipped.push({
        id: target.memberId,
        name: target.name || target.memberId,
        error: 'You can only send to Reviews users in workspaces you manage.',
      });
      continue;
    }
    try {
      const network = await store.getNetwork(target.networkId);
      if (!network) {
        skipped.push({ id: target.memberId, name: target.name, error: 'Network not found.' });
        continue;
      }
      const member = await store.getMember(target.networkId, target.memberId);
      if (!member || member.status !== 'active') {
        skipped.push({ id: target.memberId, name: target.name, error: 'Member is not active.' });
        continue;
      }
      const result = await deliverToMember({
        network,
        member,
        lead: { ...lead, name },
        by,
        baseUrl,
        note,
      });
      if (!result.ok) {
        skipped.push({ id: target.memberId, name: target.name, error: result.error || 'Send failed.' });
        continue;
      }
      delivered.push({
        id: target.memberId,
        name: target.name,
        workspaceName: target.workspaceName,
        networkId: target.networkId,
        referralId: result.referral && result.referral.id,
        notified: !!(result.notified && result.notified.ok),
      });
    } catch (err) {
      skipped.push({
        id: target.memberId,
        name: target.name,
        error: (err && err.message) || 'Send failed.',
      });
    }
  }

  if (!delivered.length) {
    return {
      ok: false,
      error: (skipped[0] && skipped[0].error) || 'Could not send that lead.',
      delivered,
      skipped,
      count: 0,
    };
  }

  return { ok: true, delivered, skipped, count: delivered.length };
}

module.exports = {
  listLeadTeammates,
  listManageableWorkspaces,
  listDirectoryRecipients,
  sendLeadToTeammates,
  sendLeadAcrossWorkspaces,
  pickTradeSlug,
  memberLabel,
  recipientKey,
  parseRecipientKey,
};
