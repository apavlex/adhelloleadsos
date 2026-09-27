/**
 * KV storage for referral networks.
 *
 *   network:<networkId>            network record (owned by one operator workspace)
 *   wsnetwork:<workspaceId>        { networkId, role } for the workspace
 *   netzone:<networkId>:<zoneId>   zone with its seat map
 *   netmember:<networkId>:<id>     member company, linked to an operator lead
 *   netref:<networkId>:<id>        referral record
 */

const crypto = require('crypto');
const dbService = require('./database');
const { normalizeTradeSlugs, DEFAULT_TRADES } = require('./networkTrades');
const { normalizeZone } = require('./referralExchange');

// Hex/base36 only: kv listing uses SQL LIKE, where "_" is a wildcard.
function newId() {
  return `${Date.now().toString(36)}${crypto.randomBytes(4).toString('hex')}`;
}

async function readJson(key) {
  const raw = await dbService.peekStorageKey(key);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

async function readAll(prefix) {
  const keys = await dbService.listStorageKeysWithPrefix(prefix);
  const rows = [];
  for (const key of keys) {
    const row = await readJson(key);
    if (row) rows.push(row);
  }
  return rows;
}

function cleanText(value, max) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max || 200);
}

// ── Network ──────────────────────────────────────────────────────────────────

function normalizeNetwork(raw) {
  const net = raw && typeof raw === 'object' ? raw : {};
  const trades = normalizeTradeSlugs(net.trades);
  return {
    id: String(net.id || ''),
    name: cleanText(net.name, 120) || 'Referral network',
    ownerWorkspaceId: String(net.ownerWorkspaceId || ''),
    ownerEmail: cleanText(net.ownerEmail, 200).toLowerCase(),
    trades: trades.length ? trades : DEFAULT_TRADES.map((trade) => trade.slug),
    createdAt: net.createdAt || new Date().toISOString(),
    updatedAt: net.updatedAt || net.createdAt || new Date().toISOString(),
  };
}

async function getNetwork(networkId) {
  const id = String(networkId || '').trim();
  if (!id) return null;
  const raw = await readJson(`network:${id}`);
  return raw ? normalizeNetwork(raw) : null;
}

async function saveNetwork(network) {
  const net = normalizeNetwork({ ...network, updatedAt: new Date().toISOString() });
  if (!net.id) throw new Error('saveNetwork: id required');
  await dbService.putStorageKey(`network:${net.id}`, net);
  return net;
}

async function getNetworkForWorkspace(workspaceId) {
  const wid = String(workspaceId || '').trim();
  if (!wid) return null;
  const link = await readJson(`wsnetwork:${wid}`);
  return link && link.networkId ? getNetwork(link.networkId) : null;
}

async function getOrCreateNetworkForWorkspace(workspaceId, { name, ownerEmail } = {}) {
  const wid = String(workspaceId || '').trim();
  if (!wid) throw new Error('getOrCreateNetworkForWorkspace: workspaceId required');
  const existing = await getNetworkForWorkspace(wid);
  if (existing) {
    if (!existing.ownerEmail && ownerEmail) return saveNetwork({ ...existing, ownerEmail });
    return existing;
  }
  const now = new Date().toISOString();
  const network = await saveNetwork({
    id: newId(),
    name: name || 'Referral network',
    ownerWorkspaceId: wid,
    ownerEmail: ownerEmail || '',
    createdAt: now,
  });
  await dbService.putStorageKey(`wsnetwork:${wid}`, { networkId: network.id, role: 'operator' });
  return network;
}

// ── Zones ────────────────────────────────────────────────────────────────────

async function listZones(networkId) {
  const rows = await readAll(`netzone:${networkId}:`);
  return rows.map(normalizeZone).sort((a, b) => a.name.localeCompare(b.name));
}

async function getZone(networkId, zoneId) {
  const raw = await readJson(`netzone:${networkId}:${zoneId}`);
  return raw ? normalizeZone(raw) : null;
}

async function saveZone(networkId, zone) {
  const next = normalizeZone({
    ...zone,
    id: zone.id || newId(),
    createdAt: zone.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  await dbService.putStorageKey(`netzone:${networkId}:${next.id}`, next);
  return next;
}

async function deleteZone(networkId, zoneId) {
  await dbService.deleteStorageKey(`netzone:${networkId}:${zoneId}`);
}

// ── Members ──────────────────────────────────────────────────────────────────

function normalizeMember(raw) {
  const m = raw && typeof raw === 'object' ? raw : {};
  return {
    id: String(m.id || ''),
    leadKey: String(m.leadKey || ''),
    companyName: cleanText(m.companyName, 160) || 'Member',
    contactName: cleanText(m.contactName, 120),
    phone: cleanText(m.phone, 40),
    email: cleanText(m.email, 200),
    trades: normalizeTradeSlugs(m.trades),
    zoneIds: [...new Set((Array.isArray(m.zoneIds) ? m.zoneIds : []).map((id) => String(id || '').trim()).filter(Boolean))],
    status: m.status === 'paused' ? 'paused' : 'active',
    joinedAt: m.joinedAt || new Date().toISOString(),
    updatedAt: m.updatedAt || m.joinedAt || new Date().toISOString(),
  };
}

async function listMembers(networkId) {
  const rows = await readAll(`netmember:${networkId}:`);
  return rows.map(normalizeMember).sort((a, b) => a.companyName.localeCompare(b.companyName));
}

async function getMember(networkId, memberId) {
  const raw = await readJson(`netmember:${networkId}:${memberId}`);
  return raw ? normalizeMember(raw) : null;
}

async function findMemberByLeadKey(networkId, leadKey) {
  const key = String(leadKey || '').trim();
  if (!key) return null;
  const members = await listMembers(networkId);
  return members.find((member) => member.leadKey === key) || null;
}

async function saveMember(networkId, member) {
  const next = normalizeMember({
    ...member,
    id: member.id || newId(),
    updatedAt: new Date().toISOString(),
  });
  await dbService.putStorageKey(`netmember:${networkId}:${next.id}`, next);
  return next;
}

// ── Referrals ────────────────────────────────────────────────────────────────

async function listReferrals(networkId) {
  const rows = await readAll(`netref:${networkId}:`);
  return rows.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}

async function getReferral(networkId, referralId) {
  return readJson(`netref:${networkId}:${referralId}`);
}

async function saveReferral(networkId, referral) {
  const next = { ...referral, id: referral.id || newId(), updatedAt: new Date().toISOString() };
  await dbService.putStorageKey(`netref:${networkId}:${next.id}`, next);
  return next;
}

module.exports = {
  newId,
  normalizeNetwork,
  normalizeMember,
  getNetwork,
  saveNetwork,
  getNetworkForWorkspace,
  getOrCreateNetworkForWorkspace,
  listZones,
  getZone,
  saveZone,
  deleteZone,
  listMembers,
  getMember,
  findMemberByLeadKey,
  saveMember,
  listReferrals,
  getReferral,
  saveReferral,
};
