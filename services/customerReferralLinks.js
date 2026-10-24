/**
 * Unique customer referral links (advocate → friend → attributed lead).
 *
 * After a great review (or from Send → Link), each customer gets a short code:
 *   https://reviews.adhello.io/rf/<code>
 *
 * Clicks and form conversions are stored on the advocate record so the business
 * can see who brought whom and rank top referrers.
 *
 *   netcustref:<code>
 *   netcustrefidx:<networkId>:<memberId>:<customerId> → code
 */

const crypto = require('crypto');
const dbService = require('./database');
const { getReviewPublicBaseUrl } = require('../lib/publicBaseUrl');

const PREFIX = 'netcustref:';
const IDX_PREFIX = 'netcustrefidx:';
const CODE_RE = /^[a-z0-9]{6,24}$/;
const MAX_CONVERSIONS = 200;

function clean(v, max) {
  return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);
}

function newCode() {
  return crypto.randomBytes(5).toString('hex'); // 10 hex chars
}

function isCode(code) {
  return CODE_RE.test(String(code || ''));
}

function refKey(code) {
  return `${PREFIX}${code}`;
}

function idxKey(networkId, memberId, customerId) {
  return `${IDX_PREFIX}${networkId}:${memberId}:${customerId}`;
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

function normalizeConversion(raw) {
  const c = raw && typeof raw === 'object' ? raw : {};
  const status = ['pending', 'confirmed', 'rewarded'].includes(c.status) ? c.status : 'pending';
  return {
    id: clean(c.id, 40) || newCode(),
    name: clean(c.name, 120),
    phone: clean(c.phone, 40),
    email: clean(c.email, 120),
    note: clean(c.note, 500),
    leadCustomerId: clean(c.leadCustomerId, 40),
    status,
    createdAt: c.createdAt || new Date().toISOString(),
    rewardedAt: c.rewardedAt || '',
  };
}

function normalizeAdvocate(raw) {
  const a = raw && typeof raw === 'object' ? raw : {};
  const conversions = Array.isArray(a.conversions)
    ? a.conversions.map(normalizeConversion).slice(0, MAX_CONVERSIONS)
    : [];
  return {
    code: String(a.code || ''),
    networkId: String(a.networkId || ''),
    memberId: String(a.memberId || ''),
    customerId: String(a.customerId || ''),
    name: clean(a.name, 120),
    phone: clean(a.phone, 40),
    email: clean(a.email, 120),
    askId: clean(a.askId, 40),
    clicks: Math.max(0, Math.round(Number(a.clicks) || 0)),
    lastClickAt: a.lastClickAt || '',
    conversions,
    createdAt: a.createdAt || new Date().toISOString(),
    updatedAt: a.updatedAt || a.createdAt || new Date().toISOString(),
  };
}

function publicUrl(code) {
  if (!isCode(code)) return '';
  return `${getReviewPublicBaseUrl()}/rf/${encodeURIComponent(code)}`;
}

async function getByCode(code) {
  if (!isCode(code)) return null;
  const raw = await readJson(refKey(code));
  return raw ? normalizeAdvocate(raw) : null;
}

async function saveAdvocate(advocate) {
  const next = normalizeAdvocate({
    ...advocate,
    updatedAt: new Date().toISOString(),
  });
  if (!isCode(next.code)) throw new Error('customerReferralLinks: invalid code');
  await dbService.putStorageKey(refKey(next.code), next);
  if (next.networkId && next.memberId && next.customerId) {
    await dbService.putStorageKey(
      idxKey(next.networkId, next.memberId, next.customerId),
      { code: next.code },
    );
  }
  return next;
}

/**
 * Get or create a unique referral link for a customer (advocate).
 */
async function ensureAdvocateLink({
  networkId,
  memberId,
  customerId,
  name,
  phone,
  email,
  askId,
}) {
  const cid = clean(customerId, 40);
  if (!networkId || !memberId || !cid) {
    return { ok: false, error: 'Customer is required for a referral link.' };
  }
  const existingIdx = await readJson(idxKey(networkId, memberId, cid));
  if (existingIdx && existingIdx.code) {
    const existing = await getByCode(existingIdx.code);
    if (existing) {
      const patched = await saveAdvocate({
        ...existing,
        name: name || existing.name,
        phone: phone || existing.phone,
        email: email || existing.email,
        askId: askId || existing.askId,
      });
      return { ok: true, advocate: patched, url: publicUrl(patched.code), created: false };
    }
  }
  let code = newCode();
  for (let i = 0; i < 5; i += 1) {
    if (!(await getByCode(code))) break;
    code = newCode();
  }
  const now = new Date().toISOString();
  const advocate = await saveAdvocate({
    code,
    networkId,
    memberId,
    customerId: cid,
    name,
    phone,
    email,
    askId,
    clicks: 0,
    conversions: [],
    createdAt: now,
  });
  return { ok: true, advocate, url: publicUrl(advocate.code), created: true };
}

async function recordClick(code, now = Date.now()) {
  const advocate = await getByCode(code);
  if (!advocate) return null;
  return saveAdvocate({
    ...advocate,
    clicks: advocate.clicks + 1,
    lastClickAt: new Date(now).toISOString(),
  });
}

async function recordConversion(code, { name, phone, email, note, leadCustomerId } = {}) {
  const advocate = await getByCode(code);
  if (!advocate) return { ok: false, error: 'Referral link not found.' };
  if (!clean(name, 120) && !clean(phone, 40) && !clean(email, 120)) {
    return { ok: false, error: 'Add a name, phone, or email.' };
  }
  const conversion = normalizeConversion({
    id: newCode(),
    name,
    phone,
    email,
    note,
    leadCustomerId,
    status: 'pending',
    createdAt: new Date().toISOString(),
  });
  const next = await saveAdvocate({
    ...advocate,
    conversions: [conversion, ...advocate.conversions].slice(0, MAX_CONVERSIONS),
  });
  return { ok: true, advocate: next, conversion };
}

async function markConversionStatus(code, conversionId, status) {
  const advocate = await getByCode(code);
  if (!advocate) return { ok: false, error: 'not_found' };
  const want = ['pending', 'confirmed', 'rewarded'].includes(status) ? status : 'pending';
  let found = false;
  const conversions = advocate.conversions.map((c) => {
    if (c.id !== conversionId) return c;
    found = true;
    return {
      ...c,
      status: want,
      rewardedAt: want === 'rewarded' ? (c.rewardedAt || new Date().toISOString()) : c.rewardedAt,
    };
  });
  if (!found) return { ok: false, error: 'conversion_not_found' };
  const next = await saveAdvocate({ ...advocate, conversions });
  return { ok: true, advocate: next };
}

async function listForMember(networkId, memberId, { limit = 200 } = {}) {
  const keys = await dbService.listStorageKeysWithPrefix(PREFIX);
  const out = [];
  for (const key of keys) {
    const code = String(key).slice(PREFIX.length);
    if (!isCode(code)) continue;
    const advocate = await getByCode(code);
    if (!advocate) continue;
    if (advocate.networkId !== networkId || advocate.memberId !== memberId) continue;
    out.push(advocate);
    if (out.length >= limit) break;
  }
  return out;
}

function confirmedCount(advocate) {
  return (advocate.conversions || []).filter((c) => c.status === 'confirmed' || c.status === 'rewarded').length;
}

function pendingCount(advocate) {
  return (advocate.conversions || []).filter((c) => c.status === 'pending').length;
}

function referralCount(advocate) {
  return (advocate.conversions || []).length;
}

/**
 * Flat recent conversions across advocates (newest first) for Board reward actions.
 */
function listRecentConversions(advocates, { limit = 40 } = {}) {
  const rows = [];
  for (const a of Array.isArray(advocates) ? advocates : []) {
    for (const c of a.conversions || []) {
      rows.push({
        code: a.code,
        advocateCustomerId: a.customerId,
        advocateName: a.name || 'Customer',
        advocatePhone: a.phone || '',
        conversionId: c.id,
        name: c.name || 'Friend',
        phone: c.phone || '',
        email: c.email || '',
        note: c.note || '',
        leadCustomerId: c.leadCustomerId || '',
        status: c.status || 'pending',
        createdAt: c.createdAt || '',
        rewardedAt: c.rewardedAt || '',
      });
    }
  }
  rows.sort((x, y) => Date.parse(y.createdAt || 0) - Date.parse(x.createdAt || 0));
  return rows.slice(0, limit);
}

/**
 * Leaderboard + summary for the business Send → Board tab.
 */
function buildDashboard(advocates) {
  const list = Array.isArray(advocates) ? advocates.slice() : [];
  list.sort((a, b) => {
    const diff = referralCount(b) - referralCount(a);
    if (diff) return diff;
    return Date.parse(b.updatedAt || 0) - Date.parse(a.updatedAt || 0);
  });
  const ranked = list.map((a, i) => {
    const rawName = clean(a.name, 120);
    const phone = clean(a.phone, 40);
    const email = clean(a.email, 120);
    const nameLooksPhone = !rawName || /^\+?\d[\d\s().-]{5,}$/.test(rawName);
    const displayName = nameLooksPhone ? (phone || email || 'Customer') : rawName;
    const initialSrc = nameLooksPhone ? 'C' : displayName;
    const meta = nameLooksPhone
      ? (email && email !== displayName ? email : '')
      : (phone || email || '');
    return {
      rank: i + 1,
      code: a.code,
      customerId: a.customerId,
      name: displayName,
      email,
      phone,
      meta,
      url: publicUrl(a.code),
      referrals: referralCount(a),
      confirmed: confirmedCount(a),
      pending: pendingCount(a),
      clicks: a.clicks || 0,
      initial: String(initialSrc || 'C').trim().charAt(0).toUpperCase() || 'C',
    };
  });
  const totalReferrals = ranked.reduce((n, r) => n + r.referrals, 0);
  const totalClicks = ranked.reduce((n, r) => n + r.clicks, 0);
  const recent = listRecentConversions(list, { limit: 40 });
  const awaitingReward = recent.filter((r) => r.status === 'pending' || r.status === 'confirmed');
  const rewarded = recent.filter((r) => r.status === 'rewarded').slice(0, 10);
  const top = ranked.slice(0, 10);
  return {
    totalAdvocates: ranked.length,
    totalReferrals,
    totalClicks,
    awaitingRewardCount: awaitingReward.length,
    top,
    all: ranked,
    awaitingReward,
    rewarded,
    recent,
  };
}

/** Default SMS when texting a customer their unique referral link. */
const DEFAULT_SHARE_SCRIPT =
  'Hi {{name}} — thanks again! Here’s your personal referral link for {{company}}. Share it with a friend to earn {{reward}}: {{referral_link}}';

function cleanShareScript(raw) {
  return String(raw == null ? '' : raw).replace(/\r\n/g, '\n').trim().slice(0, 500);
}

function shareScriptFromMember(member) {
  return cleanShareScript(member && member.referralShareScript) || DEFAULT_SHARE_SCRIPT;
}

function fillShareScript(template, { company, name, url, reward } = {}) {
  const who = clean(name, 60) || 'there';
  const co = clean(company, 80) || 'us';
  const link = clean(url, 200);
  const prize = clean(reward, 80) || 'a giveaway or your reward';
  let out = (cleanShareScript(template) || DEFAULT_SHARE_SCRIPT)
    .replace(/\{\{\s*name\s*\}\}/gi, who)
    .replace(/\{\{\s*company\s*\}\}/gi, co)
    .replace(/\{\{\s*reward\s*\}\}/gi, prize)
    .replace(/\{\{\s*referral_link\s*\}\}/gi, link)
    .replace(/\{\{\s*link\s*\}\}/gi, link);
  if (link && !out.includes(link)) {
    out = `${out.replace(/\s+$/, '')} ${link}`.trim();
  }
  return out.slice(0, 500);
}

function shareSmsText({ company, name, url, reward, script }) {
  return fillShareScript(script || DEFAULT_SHARE_SCRIPT, { company, name, url, reward });
}

module.exports = {
  CODE_RE,
  DEFAULT_SHARE_SCRIPT,
  isCode,
  publicUrl,
  getByCode,
  ensureAdvocateLink,
  recordClick,
  recordConversion,
  markConversionStatus,
  listForMember,
  buildDashboard,
  listRecentConversions,
  referralCount,
  confirmedCount,
  pendingCount,
  shareSmsText,
  shareScriptFromMember,
  fillShareScript,
  cleanShareScript,
  normalizeAdvocate,
};
