/**
 * Reviews-app 7-day onboarding drip (reviews.adhello.io free signup).
 * Separate from Agency OS leader onboarding — only Reviews portal habits.
 */

const { DateTime } = require('luxon');
const dbService = require('./database');
const networkNotify = require('./networkNotify');
const store = require('./networkStore');
const { getReviewPublicBaseUrl } = require('../lib/publicBaseUrl');
const {
  DEFAULT_SEND_HOUR,
  DEFAULT_STEPS,
  renderTemplate,
  firstNameFrom,
} = require('./reviewsOnboardingConfig');

const TZ_DEFAULT = 'America/Los_Angeles';

function enrollmentKey(networkId, memberId) {
  return `reviewsOnboarding:${networkId}:${memberId}`;
}

async function readEnrollment(networkId, memberId) {
  const raw = await dbService.peekStorageKey(enrollmentKey(networkId, memberId));
  if (!raw) return null;
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
}

async function saveEnrollment(enr) {
  await dbService.putStorageKey(enrollmentKey(enr.networkId, enr.memberId), enr);
  return enr;
}

function stepDueAt(enrolledAtIso, index, tz, sendHour) {
  const start = DateTime.fromISO(enrolledAtIso, { zone: 'utc' });
  if (index <= 0) return start.toJSDate();
  return start.setZone(tz).startOf('day').plus({ days: index }).set({ hour: sendHour }).toJSDate();
}

function nextAction(enr, now, tz = TZ_DEFAULT, sendHour = DEFAULT_SEND_HOUR) {
  const steps = DEFAULT_STEPS;
  const idx = enr.nextIndex || 0;
  if (idx >= steps.length) return { type: 'done' };
  const due = stepDueAt(enr.enrolledAt, idx, tz, sendHour);
  if (now < due) return { type: 'wait', index: idx, dueAt: due };
  if (idx > 0) {
    const nowLocal = DateTime.fromJSDate(now, { zone: 'utc' }).setZone(tz);
    if (nowLocal.hour < sendHour) return { type: 'wait', index: idx, dueAt: due };
    if (enr.lastSentAt) {
      const lastDay = DateTime.fromISO(enr.lastSentAt, { zone: 'utc' }).setZone(tz).toISODate();
      if (lastDay >= nowLocal.toISODate()) return { type: 'wait', index: idx, dueAt: due };
    }
  }
  return { type: 'send', index: idx };
}

async function resolveLinks(network, member, baseUrl) {
  const base = String(baseUrl || getReviewPublicBaseUrl() || '').replace(/\/+$/, '');
  const appLink = await networkNotify.memberPortalShortLink(base, network, member).catch(() => base);
  const reviewLink = await networkNotify
    .memberPortalShortLink(base, network, member, '/review')
    .catch(() => `${appLink}/review`);
  return { appLink, reviewLink };
}

async function sendStep({ network, member, step, vars }) {
  const subject = renderTemplate(step.subject, vars);
  const email = renderTemplate(step.body, vars);
  const first = vars.first_name || 'there';
  const sms = `Hey ${first} — Reviews Day ${vars.day}: ${step.title}. ${vars.review_link || vars.app_link}`;
  return networkNotify.messageMember(network, member, { sms, subject, email });
}

/**
 * Enroll a new Reviews-app member. Day 1 is skipped if welcome SMS/email already went out
 * (freeAppSignup sends welcome separately); we start at Day 2 next morning unless startAtDay0.
 */
async function enrollMember({ network, member, baseUrl, skipDay1 = true }) {
  if (!network || !network.id || !member || !member.id) return null;
  const existing = await readEnrollment(network.id, member.id);
  if (existing && existing.status === 'active') return existing;

  const nowIso = new Date().toISOString();
  const enr = {
    networkId: network.id,
    memberId: member.id,
    email: String(member.email || '').trim().toLowerCase(),
    name: String(member.contactName || member.companyName || '').trim(),
    baseUrl: String(baseUrl || getReviewPublicBaseUrl() || '').replace(/\/+$/, ''),
    enrolledAt: nowIso,
    status: 'active',
    nextIndex: skipDay1 ? 1 : 0,
    sent: skipDay1 ? { r1: { at: nowIso, welcome: true } } : {},
    lastSentAt: skipDay1 ? nowIso : '',
    lastError: '',
    updatedAt: nowIso,
  };
  await saveEnrollment(enr);

  if (!skipDay1) {
    await processEnrollment(enr, network, member, new Date());
  }
  return enr;
}

async function processEnrollment(enr, network, member, now = new Date()) {
  const tz = TZ_DEFAULT;
  let changed = false;
  for (let guard = 0; guard < DEFAULT_STEPS.length + 1; guard++) {
    const action = nextAction(enr, now, tz, DEFAULT_SEND_HOUR);
    if (action.type === 'done') {
      enr.status = 'done';
      enr.completedAt = enr.completedAt || now.toISOString();
      changed = true;
      break;
    }
    if (action.type === 'wait') break;

    const step = DEFAULT_STEPS[action.index];
    const { appLink, reviewLink } = await resolveLinks(network, member, enr.baseUrl);
    const vars = {
      first_name: firstNameFrom(enr.name || member.contactName, enr.email || member.email),
      day: action.index + 1,
      total_days: DEFAULT_STEPS.length,
      app_link: appLink,
      review_link: reviewLink,
      step_title: step.title,
    };

    try {
      await sendStep({ network, member, step, vars });
      enr.sent = enr.sent || {};
      enr.sent[step.id] = { at: now.toISOString() };
      enr.lastSentAt = now.toISOString();
      enr.lastError = '';
      enr.nextIndex = action.index + 1;
      changed = true;
    } catch (e) {
      enr.lastError = String((e && e.message) || 'Send failed').slice(0, 300);
      changed = true;
      break;
    }
  }
  if (changed) {
    enr.updatedAt = now.toISOString();
    await saveEnrollment(enr);
  }
  return enr;
}

async function runReviewsOnboardingDrips(now = new Date()) {
  const keys = await dbService.listStorageKeysWithPrefix('reviewsOnboarding:');
  let sent = 0;
  for (const key of keys) {
    let enr;
    try {
      const raw = await dbService.peekStorageKey(key);
      enr = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : null;
    } catch {
      enr = null;
    }
    if (!enr || enr.status !== 'active') continue;

    let network;
    let member;
    try {
      network = await store.getNetwork(enr.networkId);
      member = network ? await store.getMember(enr.networkId, enr.memberId) : null;
    } catch {
      network = null;
      member = null;
    }
    if (!network || !member || member.status === 'removed') {
      enr.status = 'stopped';
      enr.lastError = 'Member no longer active.';
      enr.updatedAt = now.toISOString();
      await saveEnrollment(enr);
      continue;
    }

    try {
      const before = enr.lastSentAt;
      const after = await processEnrollment(enr, network, member, now);
      if (after.lastSentAt && after.lastSentAt !== before) sent += 1;
    } catch (e) {
      console.error('[REVIEWS-ONBOARDING] drip failed for', enr.memberId, e.message);
    }
  }
  return { sent };
}

module.exports = {
  enrollMember,
  runReviewsOnboardingDrips,
  readEnrollment,
  nextAction,
  DEFAULT_STEPS,
};
