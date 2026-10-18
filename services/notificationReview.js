/**
 * Per-user "reviewed notifications up to" checkpoint.
 * Used so the bell can show only items newer than the last review,
 * and Mark reviewed stops the same phone alerts from feeling like they repeat
 * when switching workspaces (clears the review watermark + OS tray via the client).
 */
const dbService = require('./database');

const PREFIX = 'notif_review:';

function normEmail(email) {
  return String(email || '')
    .trim()
    .toLowerCase();
}

function kvKey(email) {
  const frag = dbService._emailKeyFragment(normEmail(email));
  return frag ? PREFIX + frag : '';
}

function getReviewedAt(email) {
  const key = kvKey(email);
  if (!key) return null;
  const raw = dbService.getKvSync(key);
  if (!raw) return null;
  try {
    const row = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const at = row && row.reviewedAt ? String(row.reviewedAt) : '';
    return Date.parse(at) > 0 ? at : null;
  } catch {
    return null;
  }
}

function getReviewedMs(email) {
  const at = getReviewedAt(email);
  const ms = at ? Date.parse(at) : 0;
  return Number.isFinite(ms) ? ms : 0;
}

/** @returns {{ reviewedAt: string }} */
function markReviewed(email, atMs) {
  const em = normEmail(email);
  const key = kvKey(em);
  if (!key) throw new Error('Sign in to mark notifications reviewed.');
  const ms = Number.isFinite(atMs) && atMs > 0 ? Math.min(atMs, Date.now()) : Date.now();
  const reviewedAt = new Date(ms).toISOString();
  dbService.setKvSync(key, { email: em, reviewedAt, updatedAt: new Date().toISOString() });
  return { reviewedAt };
}

function isNewerThanReview(email, isoAt) {
  const ms = Date.parse(String(isoAt || ''));
  if (!Number.isFinite(ms)) return true;
  return ms > getReviewedMs(email);
}

module.exports = {
  getReviewedAt,
  getReviewedMs,
  markReviewed,
  isNewerThanReview,
  PREFIX,
};
