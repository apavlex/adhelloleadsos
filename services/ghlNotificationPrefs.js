/**
 * Per-user pause/resume for GHL call & text notifications in Agency OS.
 * When paused: no phone push for missed calls / voicemails / texts, and the
 * bell inbound list hides those rows. Form/ad lead inbound is unchanged.
 * Default is resumed (on) — same as today's always-on GHL alerts.
 */
const dbService = require('./database');
const { GHL_ACTIVITY_TYPES } = require('./inboundEvents');

const PREFIX = 'ghl_notif_pref:';

/** Event types muted when the user pauses GHL notifications. */
const PAUSABLE_TYPES = new Set([
  ...GHL_ACTIVITY_TYPES,
  'missed_call_text_sent',
]);

function normEmail(email) {
  return String(email || '')
    .trim()
    .toLowerCase();
}

function kvKey(email) {
  const frag = dbService._emailKeyFragment(normEmail(email));
  return frag ? PREFIX + frag : '';
}

function read(email) {
  const key = kvKey(email);
  if (!key) return null;
  const raw = dbService.getKvSync(key);
  if (!raw) return null;
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
}

/** @returns {boolean} true when the user has paused GHL call/text alerts */
function isPaused(email) {
  const row = read(email);
  return !!(row && row.paused === true);
}

function isEnabled(email) {
  return !isPaused(email);
}

/**
 * @param {string} email
 * @param {boolean} paused
 * @returns {{ paused: boolean, enabled: boolean }}
 */
function setPaused(email, paused) {
  const em = normEmail(email);
  const key = kvKey(em);
  if (!key) throw new Error('Sign in to change GHL notification settings.');
  const now = new Date().toISOString();
  const existing = read(em) || {};
  dbService.setKvSync(key, {
    email: em,
    paused: !!paused,
    createdAt: existing.createdAt || now,
    updatedAt: now,
  });
  return { paused: !!paused, enabled: !paused };
}

function setEnabled(email, enabled) {
  return setPaused(email, !enabled);
}

function isPausableType(type) {
  return PAUSABLE_TYPES.has(String(type || '').trim().toLowerCase());
}

/** allowEmail helper for push: skip users who paused pausable GHL event types. */
function allowPushEmail(email, eventType, baseAllow) {
  if (typeof baseAllow === 'function' && !baseAllow(email)) return false;
  if (isPausableType(eventType) && isPaused(email)) return false;
  return true;
}

module.exports = {
  PREFIX,
  PAUSABLE_TYPES,
  isPaused,
  isEnabled,
  setPaused,
  setEnabled,
  isPausableType,
  allowPushEmail,
};
