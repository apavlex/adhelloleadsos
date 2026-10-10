/**
 * Per-customer review request tracking + one automatic SMS nudge.
 *
 * When a member texts a review link, we store an ask and put ?a=<id> on the URL.
 * Opening the page or clicking a review site marks the ask engaged.
 * ~48 hours later, if still not engaged and we have a phone, one reminder SMS goes out.
 *
 *   netreviewask:<id>
 */

const crypto = require('crypto');
const dbService = require('./database');
const store = require('./networkStore');
const ghlMessaging = require('./ghlMessaging');
const workspaceIntegrations = require('./workspaceIntegrations');
const reviewRequestScript = require('./reviewRequestScript');
const { brandView } = require('./networkBrand');
const { getReviewPageUrl } = require('../lib/publicBaseUrl');

const PREFIX = 'netreviewask:';
const ASK_ID = /^[a-z0-9]{8,40}$/;
/** Wait this long after the first ask before nudging. */
const REMIND_AFTER_MS = 48 * 60 * 60 * 1000;
/** Don't nudge asks older than this (missed while down). */
const REMIND_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_REMINDERS_PER_TICK = 40;

const DEFAULT_REMINDER_SMS =
  'Hi {{name}} — quick reminder from {{company}}: when you have a minute, leave a review: {{review_link}}';

function newAskId() {
  return `${Date.now().toString(36)}${crypto.randomBytes(4).toString('hex')}`;
}

function isAskId(id) {
  return ASK_ID.test(String(id || ''));
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

function normalizeAsk(raw) {
  const a = raw && typeof raw === 'object' ? raw : {};
  return {
    id: String(a.id || ''),
    networkId: String(a.networkId || ''),
    memberId: String(a.memberId || ''),
    customerId: String(a.customerId || ''),
    name: String(a.name || '').trim().slice(0, 120),
    phone: String(a.phone || '').trim().slice(0, 40),
    email: String(a.email || '').trim().slice(0, 120),
    channel: a.channel === 'email' ? 'email' : 'sms',
    reviewSlug: String(a.reviewSlug || '').trim(),
    imageId: String(a.imageId || '').trim(),
    reviewUrl: String(a.reviewUrl || '').trim(),
    askedAt: a.askedAt || '',
    remindAfterAt: a.remindAfterAt || '',
    remindedAt: a.remindedAt || '',
    openedAt: a.openedAt || '',
    clickedAt: a.clickedAt || '',
    clickPlatform: String(a.clickPlatform || '').trim().slice(0, 40),
    reminderMessageId: String(a.reminderMessageId || ''),
    createdAt: a.createdAt || a.askedAt || '',
    updatedAt: a.updatedAt || a.askedAt || '',
  };
}

function askKey(id) {
  return `${PREFIX}${id}`;
}

async function getAsk(id) {
  if (!isAskId(id)) return null;
  const raw = await readJson(askKey(id));
  return raw ? normalizeAsk(raw) : null;
}

async function saveAsk(ask) {
  const next = normalizeAsk({
    ...ask,
    id: ask.id || newAskId(),
    updatedAt: new Date().toISOString(),
  });
  if (!isAskId(next.id)) throw new Error('reviewAsk: invalid id');
  await dbService.putStorageKey(askKey(next.id), next);
  return next;
}

function isEngaged(ask) {
  return !!(ask && (ask.openedAt || ask.clickedAt));
}

/** Build the public review URL that carries this ask id for open/click tracking. */
function trackedReviewUrl(slug, { askId, imageId } = {}) {
  return getReviewPageUrl(slug, { askId, imageId });
}

/**
 * Create an ask and return it with a tracked reviewUrl (call before sending SMS/email).
 */
async function createAsk({
  networkId,
  memberId,
  customerId,
  name,
  phone,
  email,
  channel,
  reviewSlug,
  imageId,
  now = Date.now(),
}) {
  const id = newAskId();
  const askedAt = new Date(now).toISOString();
  const reviewUrl = trackedReviewUrl(reviewSlug, { askId: id, imageId });
  const ask = await saveAsk({
    id,
    networkId,
    memberId,
    customerId: customerId || '',
    name,
    phone,
    email,
    channel: channel === 'email' ? 'email' : 'sms',
    reviewSlug,
    imageId: imageId || '',
    reviewUrl,
    askedAt,
    remindAfterAt: new Date(now + REMIND_AFTER_MS).toISOString(),
    createdAt: askedAt,
  });
  return ask;
}

async function markOpened(askId, now = Date.now()) {
  const ask = await getAsk(askId);
  if (!ask || ask.openedAt) return ask;
  return saveAsk({ ...ask, openedAt: new Date(now).toISOString() });
}

async function markClicked(askId, platform, now = Date.now()) {
  const ask = await getAsk(askId);
  if (!ask) return null;
  const stamp = new Date(now).toISOString();
  const patch = { ...ask, clickPlatform: platform || ask.clickPlatform };
  if (!ask.openedAt) patch.openedAt = stamp;
  if (!ask.clickedAt) patch.clickedAt = stamp;
  return saveAsk(patch);
}

async function networkIntegrationEnv(network) {
  if (!network || !network.ownerWorkspaceId) return {};
  return workspaceIntegrations.loadIntegrationEnv(network.ownerWorkspaceId);
}

function dueForReminder(ask, now = Date.now()) {
  if (!ask || !ask.id) return false;
  if (ask.remindedAt || isEngaged(ask)) return false;
  if (!ask.phone || ask.phone === 'N/A') return false;
  const dueAt = Date.parse(ask.remindAfterAt || '');
  if (!Number.isFinite(dueAt) || now < dueAt) return false;
  if (now - dueAt > REMIND_LOOKBACK_MS) return false;
  return true;
}

async function listDueReminderAsks(now = Date.now()) {
  const keys = await dbService.listStorageKeysWithPrefix(PREFIX);
  const due = [];
  for (const key of keys) {
    const id = String(key).slice(PREFIX.length);
    if (!isAskId(id)) continue;
    const ask = await getAsk(id);
    if (dueForReminder(ask, now)) due.push(ask);
    if (due.length >= MAX_REMINDERS_PER_TICK * 2) break;
  }
  due.sort((a, b) => Date.parse(a.remindAfterAt) - Date.parse(b.remindAfterAt));
  return due.slice(0, MAX_REMINDERS_PER_TICK);
}

async function sendReminderForAsk(ask) {
  const network = await store.getNetwork(ask.networkId);
  const member = network ? await store.getMember(network.id, ask.memberId) : null;
  if (!network || !member || member.status !== 'active') {
    return { ok: false, error: 'member_unavailable' };
  }
  if (!member.reviewSlug) return { ok: false, error: 'no_review_slug' };

  const integrationEnv = await networkIntegrationEnv(network);
  const ready = ghlMessaging.messagingReady(integrationEnv);
  if (!ready.configured || !ready.smsReady) {
    return { ok: false, error: 'ghl_sms_not_ready' };
  }

  const link = ask.reviewUrl || trackedReviewUrl(member.reviewSlug, {
    askId: ask.id,
    imageId: ask.imageId,
  });
  const company = member.companyName || brandView(network).appName;
  const built = await reviewRequestScript.buildReviewSms({
    member,
    customerName: ask.name || 'there',
    companyName: company,
    reviewLink: link,
    useAi: false,
    scriptOverride: DEFAULT_REMINDER_SMS,
  });

  try {
    const result = await ghlMessaging.sendSmsToPerson({
      name: ask.name || 'there',
      phone: ask.phone,
      message: built.message,
      companyName: company,
      integrationEnv,
    });
    const saved = await saveAsk({
      ...ask,
      remindedAt: new Date().toISOString(),
      reminderMessageId: result.messageId || '',
      reviewUrl: link,
    });
    return { ok: true, ask: saved, message: built.message };
  } catch (err) {
    return { ok: false, error: err.message || 'sms_failed' };
  }
}

/** Cron entry: send due review nudges (at most one per ask). */
async function runReviewAskReminders(now = Date.now()) {
  const due = await listDueReminderAsks(now);
  let sent = 0;
  let skipped = 0;
  for (const ask of due) {
    // Re-read in case a click landed mid-tick
    const fresh = await getAsk(ask.id);
    if (!dueForReminder(fresh, now)) {
      skipped += 1;
      continue;
    }
    const result = await sendReminderForAsk(fresh);
    if (result.ok) sent += 1;
    else skipped += 1;
  }
  if (sent || due.length) {
    console.log(`[SCHEDULER] Review ask reminders: sent=${sent} due=${due.length} skipped=${skipped}`);
  }
  return { due: due.length, sent, skipped };
}

async function latestAskForCustomer(networkId, memberId, customerId) {
  if (!customerId) return null;
  const keys = await dbService.listStorageKeysWithPrefix(PREFIX);
  let best = null;
  for (const key of keys) {
    const ask = await getAsk(String(key).slice(PREFIX.length));
    if (!ask || ask.networkId !== networkId || ask.memberId !== memberId) continue;
    if (ask.customerId !== customerId) continue;
    if (!best || Date.parse(ask.askedAt) > Date.parse(best.askedAt)) best = ask;
  }
  return best;
}

module.exports = {
  REMIND_AFTER_MS,
  REMIND_LOOKBACK_MS,
  DEFAULT_REMINDER_SMS,
  isAskId,
  getAsk,
  saveAsk,
  createAsk,
  markOpened,
  markClicked,
  isEngaged,
  trackedReviewUrl,
  dueForReminder,
  listDueReminderAsks,
  sendReminderForAsk,
  runReviewAskReminders,
  latestAskForCustomer,
};
