/**
 * Send and update network referrals: validation + routing from
 * referralExchange, persistence in networkStore, side effects in networkNotify.
 * Shared by the operator UI and the no-login member links.
 */

const store = require('./networkStore');
const ex = require('./referralExchange');
const notify = require('./networkNotify');

async function sendReferral({ network, input, fromMemberId, by, baseUrl }) {
  const built = ex.buildReferral({ ...input, fromMemberId: fromMemberId || 'operator', by });
  if (!built.ok) return built;
  if (!network.trades.includes(built.referral.tradeSlug)) return { ok: false, error: 'That trade is not in this network.' };

  const [zones, members, referrals] = await Promise.all([
    store.listZones(network.id),
    store.listMembers(network.id),
    store.listReferrals(network.id),
  ]);
  const zone = built.referral.zoneId
    ? zones.find((z) => z.id === built.referral.zoneId) || null
    : ex.resolveZone(zones, { city: built.referral.homeowner.city, zip: built.referral.homeowner.zip });
  const route = ex.routeReferral(zone, built.referral.tradeSlug, {
    members,
    fromMemberId: built.referral.fromMemberId,
    referrals,
  });
  const routed = ex.applyRouting({ ...built.referral, zoneId: zone ? zone.id : '' }, route);
  const referral = await store.saveReferral(network.id, { ...routed, id: store.newId() });

  const sender = members.find((m) => m.id === referral.fromMemberId) || null;
  const recipient = members.find((m) => m.id === referral.toMemberId) || null;
  const effects = await afterRouting({ network, referral, recipient, sender, baseUrl });
  return { ok: true, referral, zone, route, ...effects };
}

async function afterRouting({ network, referral, recipient, sender, baseUrl }) {
  const out = { notified: null };
  if (sender) await notify.syncPartnerCounter(network, sender, 'received').catch(() => {});
  if (recipient && referral.status === 'sent') {
    await notify.syncPartnerCounter(network, recipient, 'sent').catch(() => {});
    out.notified = await notify.notifyReferralRecipient({ network, referral, member: recipient, baseUrl })
      .catch((err) => ({ ok: false, error: err.message }));
  } else if (referral.status === 'unrouted') {
    await notify.createOperatorTask({ network, referral, reason: 'unrouted' });
  }
  return out;
}

/**
 * Apply an action. When `actorMemberId` is set (member link), the member must
 * be the current recipient and may not assign.
 */
async function actOnReferral({ network, referralId, action, opts = {}, actorMemberId, baseUrl }) {
  const current = await store.getReferral(network.id, referralId);
  if (!current) return { ok: false, error: 'Referral not found.' };
  if (actorMemberId) {
    if (current.toMemberId !== actorMemberId) return { ok: false, error: 'This referral was moved to another member.' };
    if (action === 'assign') return { ok: false, error: 'Only the network operator can reassign referrals.' };
  }
  const members = await store.listMembers(network.id);
  if (action === 'assign') {
    const target = members.find((m) => m.id === opts.toMemberId);
    if (!target) return { ok: false, error: 'Pick a member to assign.' };
    if (target.status !== 'active') return { ok: false, error: `${target.companyName} is paused.` };
  }
  const applied = ex.applyReferralAction(current, action, opts);
  if (!applied.ok) return applied;
  const referral = await store.saveReferral(network.id, applied.referral);
  const out = { ok: true, referral, notified: null };

  if (action === 'assign') {
    const recipient = members.find((m) => m.id === referral.toMemberId);
    await notify.syncPartnerCounter(network, recipient, 'sent').catch(() => {});
    out.notified = await notify.notifyReferralRecipient({ network, referral, member: recipient, baseUrl })
      .catch((err) => ({ ok: false, error: err.message }));
  } else if (action === 'decline') {
    const member = members.find((m) => m.id === current.toMemberId);
    await notify.createOperatorTask({ network, referral, reason: 'declined', member });
  }
  return out;
}

/**
 * Members keep the trades and zones they asked for even when a seat was full.
 * After the partner limit changes, seat whoever is waiting, earliest member first.
 * @returns {Promise<string[]>} names of members who gained a seat
 */
async function reseatWaitingMembers(network) {
  let zones = await store.listZones(network.id);
  const members = (await store.listMembers(network.id))
    .slice()
    .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
  const before = new Set(members.flatMap((m) => ex.seatsForMember(zones, m.id).map((s) => `${m.id}|${s.zoneId}|${s.tradeSlug}`)));
  const changedIds = new Set();
  for (const member of members) {
    const plan = ex.planMemberSeats(zones, member.id, { trades: member.trades, zoneIds: member.zoneIds }, undefined, network.seatLimit);
    if (!plan.changed.length) continue;
    const byId = Object.fromEntries(plan.changed.map((z) => [z.id, z]));
    zones = zones.map((z) => byId[z.id] || z);
    plan.changed.forEach((z) => changedIds.add(z.id));
  }
  for (const zone of zones) if (changedIds.has(zone.id)) await store.saveZone(network.id, zone);
  return members
    .filter((m) => ex.seatsForMember(zones, m.id).some((s) => !before.has(`${m.id}|${s.zoneId}|${s.tradeSlug}`)))
    .map((m) => m.companyName);
}

/** Save a member and rebuild their seats. Conflicting seats are skipped and reported. */
async function saveMemberWithSeats(network, member, { trades, zoneIds }) {
  const zones = await store.listZones(network.id);
  const validZoneIds = (zoneIds || []).filter((id) => zones.some((z) => z.id === id));
  const saved = await store.saveMember(network.id, {
    ...member,
    trades: (trades || []).filter((slug) => network.trades.includes(slug)),
    zoneIds: validZoneIds,
  });
  const plan = ex.planMemberSeats(zones, saved.id, { trades: saved.trades, zoneIds: saved.zoneIds }, undefined, network.seatLimit);
  for (const zone of plan.changed) await store.saveZone(network.id, zone);
  return { member: saved, conflicts: plan.conflicts };
}

module.exports = {
  sendReferral,
  actOnReferral,
  saveMemberWithSeats,
  reseatWaitingMembers,
};
