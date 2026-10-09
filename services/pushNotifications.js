/**
 * Web Push for the installed app (iPhone/Android home screen) and desktop browsers.
 * VAPID keys come from VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY, or are generated once and kept in the database.
 */

const crypto = require('crypto');
const webpush = require('web-push');
const dbService = require('./database');

const SUB_PREFIX = 'pushsub:';
/** Contractor portal devices (no AdHello login) — scoped by packageId. */
const PORTAL_SUB_PREFIX = 'portalpush:';
const VAPID_KV_KEY = 'sys:vapid_keys';

let configured = null;

function vapidKeys() {
  const envPublic = String(process.env.VAPID_PUBLIC_KEY || '').replace(/["'\s]/g, '');
  const envPrivate = String(process.env.VAPID_PRIVATE_KEY || '').replace(/["'\s]/g, '');
  if (envPublic && envPrivate) return { publicKey: envPublic, privateKey: envPrivate };
  const raw = dbService.getKvSync(VAPID_KV_KEY);
  if (raw) {
    try {
      const saved = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (saved && saved.publicKey && saved.privateKey) return saved;
    } catch {
      /* regenerate below */
    }
  }
  const generated = webpush.generateVAPIDKeys();
  dbService.setKvSync(VAPID_KV_KEY, generated);
  return generated;
}

function ensureConfigured() {
  if (configured) return configured;
  const keys = vapidKeys();
  const subject = String(process.env.VAPID_SUBJECT || 'mailto:support@adhello.ai').trim();
  webpush.setVapidDetails(subject, keys.publicKey, keys.privateKey);
  configured = keys;
  return keys;
}

function publicKey() {
  return ensureConfigured().publicKey;
}

function subKey(endpoint) {
  return SUB_PREFIX + crypto.createHash('sha256').update(String(endpoint)).digest('hex').slice(0, 32);
}

function normEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function readSub(key) {
  const raw = dbService.getKvSync(key);
  if (!raw) return null;
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
}

function validSubscription(sub) {
  return !!(
    sub &&
    typeof sub.endpoint === 'string' &&
    /^https:\/\//.test(sub.endpoint) &&
    sub.keys &&
    typeof sub.keys.p256dh === 'string' &&
    typeof sub.keys.auth === 'string'
  );
}

function saveSubscription({ subscription, userEmail, workspaceId, userAgent }) {
  if (!validSubscription(subscription)) return { ok: false, error: 'Invalid push subscription.' };
  const email = normEmail(userEmail);
  if (!email) return { ok: false, error: 'Sign in to turn on push alerts.' };
  const key = subKey(subscription.endpoint);
  const existing = readSub(key);
  const workspaceIds = new Set(existing && existing.userEmail === email ? existing.workspaceIds || [] : []);
  if (workspaceId) workspaceIds.add(String(workspaceId));
  const now = new Date().toISOString();
  dbService.setKvSync(key, {
    endpoint: subscription.endpoint,
    keys: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth },
    userEmail: email,
    emailFrag: dbService._emailKeyFragment(email),
    workspaceIds: [...workspaceIds],
    userAgent: String(userAgent || '').slice(0, 200),
    createdAt: (existing && existing.createdAt) || now,
    updatedAt: now,
  });
  return { ok: true };
}

function removeSubscription(endpoint, userEmail) {
  const key = subKey(endpoint);
  const existing = readSub(key);
  if (existing && (!userEmail || existing.userEmail === normEmail(userEmail))) dbService.deleteKvSync(key);
}

function listSubscriptions() {
  return dbService
    .listKvKeysSync(SUB_PREFIX)
    .map((key) => {
      const sub = readSub(key);
      return sub ? { key, ...sub } : null;
    })
    .filter(Boolean);
}

function matchingSubscriptions({ userEmail, workspaceId, allowEmail } = {}) {
  const email = normEmail(userEmail);
  const wid = workspaceId ? String(workspaceId) : '';
  return listSubscriptions().filter((sub) => {
    if (email && sub.userEmail !== email) return false;
    if (wid && !(sub.workspaceIds || []).includes(wid)) return false;
    if (typeof allowEmail === 'function' && !allowEmail(sub.userEmail)) return false;
    return !!(email || wid);
  });
}

function portalSubKey(endpoint) {
  return PORTAL_SUB_PREFIX + crypto.createHash('sha256').update(String(endpoint)).digest('hex').slice(0, 32);
}

function savePortalSubscription({ subscription, workspaceId, packageId, userAgent }) {
  if (!validSubscription(subscription)) return { ok: false, error: 'Invalid push subscription.' };
  const wid = String(workspaceId || '').trim();
  const pkgId = String(packageId || '').trim();
  if (!wid || !pkgId) return { ok: false, error: 'Portal package is required.' };
  const key = portalSubKey(subscription.endpoint);
  const existing = readSub(key);
  const now = new Date().toISOString();
  dbService.setKvSync(key, {
    kind: 'contractor_portal',
    endpoint: subscription.endpoint,
    keys: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth },
    workspaceId: wid,
    packageId: pkgId,
    userAgent: String(userAgent || '').slice(0, 200),
    createdAt: (existing && existing.createdAt) || now,
    updatedAt: now,
  });
  return { ok: true };
}

function removePortalSubscription(endpoint, packageId) {
  const key = portalSubKey(endpoint);
  const existing = readSub(key);
  if (!existing) return;
  if (packageId && existing.packageId && existing.packageId !== String(packageId)) return;
  dbService.deleteKvSync(key);
}

function matchingPortalSubscriptions({ packageId, workspaceId } = {}) {
  const pkgId = String(packageId || '').trim();
  const wid = String(workspaceId || '').trim();
  if (!pkgId && !wid) return [];
  return dbService
    .listKvKeysSync(PORTAL_SUB_PREFIX)
    .map((key) => {
      const sub = readSub(key);
      return sub ? { key, ...sub } : null;
    })
    .filter(Boolean)
    .filter((sub) => {
      if (pkgId && sub.packageId !== pkgId) return false;
      if (wid && sub.workspaceId !== wid) return false;
      return true;
    });
}

async function deliverPush(subs, payload) {
  if (!subs.length) return { sent: 0 };
  ensureConfigured();
  const body = JSON.stringify({
    title: String(payload.title || 'AdHello').slice(0, 120),
    body: String(payload.body || '').slice(0, 300),
    url: String(payload.url || '/today'),
    tag: payload.tag ? String(payload.tag).slice(0, 120) : undefined,
  });
  let sent = 0;
  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, body, { TTL: 60 * 60 * 6 });
        sent += 1;
      } catch (err) {
        const code = err && err.statusCode;
        if (code === 404 || code === 410) dbService.deleteKvSync(sub.key);
        else console.warn('[PUSH] Send failed:', code || '', (err && err.message) || err);
      }
    }),
  );
  return { sent };
}

/** Never throws; drops subscriptions the push service reports as gone. */
async function sendPush(target, payload) {
  return deliverPush(matchingSubscriptions(target), payload);
}

/** Push to contractor portal devices subscribed for a package. */
async function sendPortalPush({ packageId, workspaceId } = {}, payload) {
  return deliverPush(matchingPortalSubscriptions({ packageId, workspaceId }), payload);
}

/**
 * Fire-and-forget alert when a new lead is delivered to a contractor package.
 * url should be the contractor portal leads page (/p/:token/leads).
 */
function notifyContractorNewLead({
  workspaceId,
  packageId,
  businessName,
  leadName,
  formName,
  preview,
  url,
} = {}) {
  const pkgId = String(packageId || '').trim();
  if (!pkgId) return Promise.resolve({ sent: 0 });
  const who = String(leadName || 'New lead').trim().slice(0, 80);
  const biz = String(businessName || 'your business').trim().slice(0, 80);
  const detail = [formName, preview].filter(Boolean).join(' — ').slice(0, 200);
  const payload = {
    title: `New lead for ${biz}`,
    body: detail || `${who} just came in. Open your portal to call them.`,
    url: String(url || '/today'),
    tag: `portal-lead-${pkgId}-${Date.now()}`,
  };
  return sendPortalPush({ packageId: pkgId, workspaceId }, payload).catch((e) => {
    console.warn('[PUSH] contractor lead notify failed:', e && e.message);
    return { sent: 0 };
  });
}

function searchLabel(job) {
  const what = job.keyword || job.query || 'Search';
  const where = [job.city, job.state].filter(Boolean).join(', ');
  return where ? `"${what}" in ${where}` : `"${what}"`;
}

function notifyJobFinished(job) {
  if (!job || !job.workspaceId) return Promise.resolve({ sent: 0 });
  const failed = job.status === 'failed';
  const count = job.resultCount || 0;
  const payload = failed
    ? { title: 'Search failed', body: `${searchLabel(job)}: ${job.error || 'Search failed'}`, url: '/history' }
    : {
        title: 'Search finished',
        body: `${searchLabel(job)} · ${count} lead${count === 1 ? '' : 's'} found`,
        url: job.searchKey ? `/search/${encodeURIComponent(job.searchKey)}` : '/history',
      };
  payload.tag = `search-${job.finishedAt || Date.now()}`;
  const target = job.createdBy ? { userEmail: job.createdBy, workspaceId: job.workspaceId } : { workspaceId: job.workspaceId };
  return sendPush(target, payload).catch(() => ({ sent: 0 }));
}

module.exports = {
  publicKey,
  saveSubscription,
  removeSubscription,
  listSubscriptions,
  matchingSubscriptions,
  savePortalSubscription,
  removePortalSubscription,
  matchingPortalSubscriptions,
  sendPush,
  sendPortalPush,
  notifyContractorNewLead,
  notifyJobFinished,
};
