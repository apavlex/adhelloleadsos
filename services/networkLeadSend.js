/**
 * Leads Network → Send lead to Reviews-app teammates (multi-select or all).
 * Reuses network referrals so teammates get SMS / in-app / push and can accept
 * the same way as a partner referral.
 */

const store = require('./networkStore');
const networkReferrals = require('./networkReferrals');
const trades = require('./networkTrades');

function memberLabel(member) {
  if (!member) return 'Teammate';
  return String(member.companyName || member.contactName || member.email || 'Teammate').trim() || 'Teammate';
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

  let tradeSlug = pickTradeSlug(network);
  if (!Array.isArray(network.trades) || !network.trades.includes(tradeSlug)) {
    const nextTrades = [...(network.trades || []), tradeSlug];
    await store.saveNetwork({ ...network, trades: nextTrades });
    network.trades = nextTrades;
  }

  const by = String(opts.by || 'operator').trim() || 'operator';
  const baseUrl = opts.baseUrl || '';
  const note = String(lead.note || '').trim().slice(0, 1000) || 'Lead from Leads Network';
  const delivered = [];
  const skipped = [];

  for (const target of selected) {
    try {
      const result = await networkReferrals.sendReferral({
        network,
        fromMemberId: 'operator',
        by,
        toMemberId: target.id,
        baseUrl,
        input: {
          tradeSlug,
          name,
          phone: lead.phone || '',
          email: lead.email || '',
          city: lead.city || '',
          zip: lead.zip || '',
          address: lead.address || '',
          note,
          consent: true,
        },
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

module.exports = {
  listLeadTeammates,
  sendLeadToTeammates,
  pickTradeSlug,
  memberLabel,
};
