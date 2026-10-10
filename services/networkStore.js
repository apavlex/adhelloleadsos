/**
 * KV storage for referral networks.
 *
 *   network:<networkId>            network record (owned by one operator workspace)
 *   wsnetwork:<workspaceId>        { networkId, role } for the workspace
 *   netzone:<networkId>:<zoneId>   zone with its seat map
 *   netmember:<networkId>:<id>     member company, linked to an operator lead
 *   netref:<networkId>:<id>        referral record
 *   netbrandimg:<networkId>:<kind> uploaded logo / hero image (base64)
 *   netapp:<networkId>:<id>        business a member invited, waiting for approval
 *   netfeedback:<networkId>:<id>   private feedback left on a member's review page
 *   netreviewstats:<networkId>:<memberId>  star taps + review link clicks
 *   netreviewslug:<slug>           { networkId, memberId } for /rv/:slug
 */

const crypto = require('crypto');
const dbService = require('./database');
const { normalizeTradeSlugs, normalizeCustomTrades, catalogFor, ORIGINAL_TRADE_SLUGS } = require('./networkTrades');
const { normalizeZone, normalizeSeatLimit } = require('./referralExchange');
const { normalizeBrand } = require('./networkBrand');
const { PLATFORMS: REVIEW_LINK_PLATFORMS, MAX_OTHER_LINKS: MAX_OTHER_REVIEW_LINKS } = require('./reviewPage');

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
  const customTrades = normalizeCustomTrades(net.customTrades);
  const trades = normalizeTradeSlugs(net.trades, catalogFor({ customTrades }));
  return {
    id: String(net.id || ''),
    name: cleanText(net.name, 120) || 'Referral network',
    ownerWorkspaceId: String(net.ownerWorkspaceId || ''),
    ownerEmail: cleanText(net.ownerEmail, 200).toLowerCase(),
    trades: trades.length ? trades : ORIGINAL_TRADE_SLUGS.slice(),
    customTrades: customTrades.map(({ slug, name, keyword }) => ({ slug, name, keyword })),
    brand: normalizeBrand(net.brand),
    autoGhlSubaccount: net.autoGhlSubaccount !== false,
    seatLimit: normalizeSeatLimit(net.seatLimit),
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
    /** Optional link to an agency appointment package (contractor portal in the member app). */
    appointmentPackageId: cleanText(m.appointmentPackageId, 80),
    companyName: cleanText(m.companyName, 160) || 'Member',
    contactName: cleanText(m.contactName, 120),
    phone: cleanText(m.phone, 40),
    email: cleanText(m.email, 200),
    trades: normalizeTradeSlugs(m.trades),
    zoneIds: [...new Set((Array.isArray(m.zoneIds) ? m.zoneIds : []).map((id) => String(id || '').trim()).filter(Boolean))],
    status: m.status === 'paused' ? 'paused' : 'active',
    ghlLocationId: cleanText(m.ghlLocationId, 80),
    ghlSubaccountUrl: cleanText(m.ghlSubaccountUrl, 400),
    ghlError: cleanText(m.ghlError, 300),
    ghlAttemptedAt: m.ghlAttemptedAt || '',
    reviewSlug: cleanSlug(m.reviewSlug),
    reviewLinks: normalizeReviewLinks(m.reviewLinks),
    /** Member-editable AI/GHL review-request SMS script ({{name}}, {{company}}, {{review_link}}). */
    reviewSmsScript: cleanText(m.reviewSmsScript, 800),
    reviewEmailSubject: cleanText(m.reviewEmailSubject, 180),
    reviewEmailScript: cleanText(m.reviewEmailScript, 4000),
    invitedByMemberId: cleanText(m.invitedByMemberId, 40),
    joinedAt: m.joinedAt || new Date().toISOString(),
    updatedAt: m.updatedAt || m.joinedAt || new Date().toISOString(),
  };
}

function cleanSlug(value) {
  return String(value == null ? '' : value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '');
}

function cleanReviewUrl(value) {
  const raw = String(value == null ? '' : value).trim().slice(0, 500);
  if (!raw) return '';
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(withScheme);
    if (!/^https?:$/.test(url.protocol) || !url.hostname.includes('.')) return '';
    return url.toString();
  } catch {
    return '';
  }
}

function normalizeReviewLinks(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  REVIEW_LINK_PLATFORMS.forEach((p) => { out[p.key] = cleanReviewUrl(r[p.key]); });
  const other = [];
  (Array.isArray(r.other) ? r.other : []).forEach((row) => {
    const label = cleanText(row && row.label, 40);
    const url = cleanReviewUrl(row && row.url);
    if (!label || !url) return;
    // A custom row named after a built-in site fills that site's slot instead.
    const builtIn = REVIEW_LINK_PLATFORMS.find((p) => p.label.toLowerCase() === label.toLowerCase());
    if (builtIn && !out[builtIn.key]) out[builtIn.key] = url;
    else other.push({ label, url });
  });
  out.other = other.slice(0, MAX_OTHER_REVIEW_LINKS);
  return out;
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

async function deleteMember(networkId, member) {
  if (!member || !member.id) return;
  await dbService.deleteStorageKey(`netmember:${networkId}:${member.id}`);
  if (member.reviewSlug) {
    const slug = await resolveReviewSlug(member.reviewSlug);
    if (slug && slug.networkId === networkId && slug.memberId === member.id) {
      await dbService.deleteStorageKey(`netreviewslug:${member.reviewSlug}`);
    }
  }
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

/** Every member in every network as { networkId, member }, for the lost-link lookup. */
async function listAllMembers() {
  const keys = await dbService.listStorageKeysWithPrefix('netmember:');
  const out = [];
  for (const key of keys) {
    const networkId = String(key).split(':')[1] || '';
    const raw = await readJson(key);
    if (networkId && raw) out.push({ networkId, member: normalizeMember(raw) });
  }
  return out;
}

// ── Brand images ─────────────────────────────────────────────────────────────

async function getBrandImage(networkId, kind) {
  const row = await readJson(`netbrandimg:${networkId}:${kind}`);
  if (!row || !row.data) return null;
  return { contentType: String(row.contentType || 'image/png'), buffer: Buffer.from(String(row.data), 'base64'), updatedAt: row.updatedAt || '' };
}

async function saveBrandImage(networkId, kind, { contentType, buffer }) {
  const updatedAt = new Date().toISOString();
  await dbService.putStorageKey(`netbrandimg:${networkId}:${kind}`, {
    contentType,
    data: Buffer.from(buffer).toString('base64'),
    updatedAt,
  });
  return updatedAt;
}

async function deleteBrandImage(networkId, kind) {
  await dbService.deleteStorageKey(`netbrandimg:${networkId}:${kind}`);
}

// ── Applications (member invites) ────────────────────────────────────────────

const APPLICATION_STATUSES = new Set(['pending', 'approved', 'rejected']);

function normalizeApplication(raw) {
  const a = raw && typeof raw === 'object' ? raw : {};
  return {
    id: String(a.id || ''),
    companyName: cleanText(a.companyName, 160),
    contactName: cleanText(a.contactName, 120),
    phone: cleanText(a.phone, 40),
    email: cleanText(a.email, 200).toLowerCase(),
    tradeSlug: cleanText(a.tradeSlug, 60),
    city: cleanText(a.city, 80),
    note: cleanText(a.note, 500),
    invitedByMemberId: cleanText(a.invitedByMemberId, 40),
    status: APPLICATION_STATUSES.has(a.status) ? a.status : 'pending',
    memberId: cleanText(a.memberId, 40),
    createdAt: a.createdAt || new Date().toISOString(),
    decidedAt: a.decidedAt || '',
  };
}

async function listApplications(networkId) {
  const rows = await readAll(`netapp:${networkId}:`);
  return rows.map(normalizeApplication).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

async function getApplication(networkId, id) {
  const raw = await readJson(`netapp:${networkId}:${id}`);
  return raw ? normalizeApplication(raw) : null;
}

async function saveApplication(networkId, application) {
  const next = normalizeApplication({ ...application, id: application.id || newId() });
  await dbService.putStorageKey(`netapp:${networkId}:${next.id}`, next);
  return next;
}

// ── Review page: slugs, feedback, stats ──────────────────────────────────────

async function resolveReviewSlug(slug) {
  const clean = cleanSlug(slug);
  if (!clean) return null;
  const row = await readJson(`netreviewslug:${clean}`);
  return row && row.networkId && row.memberId ? { networkId: String(row.networkId), memberId: String(row.memberId), slug: clean } : null;
}

/**
 * Give the member a review slug (globally unique, since /rv/:slug has no
 * network in it). Keeps an existing slug unless `wanted` asks for a new one.
 */
async function ensureReviewSlug(networkId, member, wanted) {
  const desired = cleanSlug(wanted) || member.reviewSlug || cleanSlug(member.companyName) || 'reviews';
  if (member.reviewSlug && member.reviewSlug === desired) return member;
  let slug = desired;
  for (let i = 2; i < 200; i += 1) {
    const taken = await resolveReviewSlug(slug);
    if (!taken || (taken.networkId === networkId && taken.memberId === member.id)) break;
    slug = `${desired.slice(0, 44)}-${i}`;
  }
  await dbService.putStorageKey(`netreviewslug:${slug}`, { networkId, memberId: member.id });
  if (member.reviewSlug && member.reviewSlug !== slug) {
    await dbService.deleteStorageKey(`netreviewslug:${member.reviewSlug}`);
  }
  return saveMember(networkId, { ...member, reviewSlug: slug });
}

async function saveFeedback(networkId, feedback) {
  const next = {
    id: feedback.id || newId(),
    memberId: String(feedback.memberId || ''),
    rating: Math.max(1, Math.min(5, parseInt(feedback.rating, 10) || 0)) || 0,
    name: cleanText(feedback.name, 120),
    phone: cleanText(feedback.phone, 40),
    email: cleanText(feedback.email, 200),
    message: cleanText(feedback.message, 1500),
    createdAt: feedback.createdAt || new Date().toISOString(),
  };
  await dbService.putStorageKey(`netfeedback:${networkId}:${next.id}`, next);
  return next;
}

async function listFeedback(networkId, memberId) {
  const rows = await readAll(`netfeedback:${networkId}:`);
  return rows
    .filter((row) => !memberId || row.memberId === memberId)
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}

const REVIEW_PLATFORMS = [...REVIEW_LINK_PLATFORMS.map((p) => p.key), 'other'];

function normalizeReviewStats(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const stars = {};
  for (let i = 1; i <= 5; i += 1) stars[i] = Math.max(0, parseInt(r.stars && r.stars[i], 10) || 0);
  const clicks = {};
  REVIEW_PLATFORMS.forEach((p) => { clicks[p] = Math.max(0, parseInt(r.clicks && r.clicks[p], 10) || 0); });
  return { stars, clicks, views: Math.max(0, parseInt(r.views, 10) || 0) };
}

async function getReviewStats(networkId, memberId) {
  return normalizeReviewStats(await readJson(`netreviewstats:${networkId}:${memberId}`));
}

async function bumpReviewStats(networkId, memberId, { star, click, view } = {}) {
  const stats = await getReviewStats(networkId, memberId);
  const s = parseInt(star, 10);
  if (s >= 1 && s <= 5) stats.stars[s] += 1;
  if (click && REVIEW_PLATFORMS.includes(click)) stats.clicks[click] += 1;
  if (view) stats.views += 1;
  await dbService.putStorageKey(`netreviewstats:${networkId}:${memberId}`, stats);
  return stats;
}

module.exports = {
  newId,
  normalizeNetwork,
  normalizeMember,
  normalizeApplication,
  normalizeReviewLinks,
  cleanSlug,
  listAllMembers,
  getBrandImage,
  saveBrandImage,
  deleteBrandImage,
  listApplications,
  getApplication,
  saveApplication,
  resolveReviewSlug,
  ensureReviewSlug,
  saveFeedback,
  listFeedback,
  getReviewStats,
  bumpReviewStats,
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
  deleteMember,
  listReferrals,
  getReferral,
  saveReferral,
};
