/**
 * After a 4–5★ review path: notify the business, wait for manual confirm,
 * then text/email the customer a referral reward offer they configured.
 *
 * Paid plans only (not app_free) — same gate as network referrals.
 * Do not require freeAppSignup at module load (circular with networkStore).
 */

const DEFAULT_SCRIPT =
  'Thanks for the {{stars}}★ review, {{name}}! If you refer a friend or family member who books with {{company}}, you get {{reward}}. Reply with their name and number and we’ll take care of them.';

const REWARD_TYPES = new Set(['gift_card', 'discount', 'prize', 'custom']);

function clean(v, max) {
  return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);
}

function normalizeSettings(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const minStars = Number(s.minStars) === 5 ? 5 : 4;
  const type = REWARD_TYPES.has(String(s.rewardType || ''))
    ? String(s.rewardType)
    : 'gift_card';
  return {
    enabled: s.enabled === true || s.enabled === '1' || s.enabled === 'on',
    minStars,
    rewardType: type,
    rewardLabel: clean(s.rewardLabel, 80),
    rewardScript: clean(s.rewardScript, 500) || DEFAULT_SCRIPT,
  };
}

function settingsFromMember(member) {
  return normalizeSettings(member && member.reviewReward);
}

function settingsFromBody(body) {
  const b = body || {};
  return normalizeSettings({
    enabled: b.rewardEnabled === '1' || b.rewardEnabled === 'on' || b.enabled === '1',
    minStars: b.rewardMinStars || b.minStars,
    rewardType: b.rewardType,
    rewardLabel: b.rewardLabel,
    rewardScript: b.rewardScript,
  });
}

/** Referral rewards + customer-referral offers are monthly-plan only. */
function isPaidMember(member) {
  return !require('./freeAppSignup').isAppFreeMember(member);
}

function qualifies(settings, rating, member) {
  if (member && !isPaidMember(member)) return false;
  const s = normalizeSettings(settings);
  const r = Number(rating) || 0;
  return !!(s.enabled && s.rewardLabel && r >= s.minStars && r <= 5);
}

function fillScript(template, { name, company, stars, reward }) {
  const src = clean(template, 500) || DEFAULT_SCRIPT;
  return src
    .replace(/\{\{\s*name\s*\}\}/gi, clean(name, 60) || 'there')
    .replace(/\{\{\s*company\s*\}\}/gi, clean(company, 80) || 'us')
    .replace(/\{\{\s*stars\s*\}\}/gi, String(stars || 5))
    .replace(/\{\{\s*reward\s*\}\}/gi, clean(reward, 80) || 'a thank-you gift');
}

function buildCustomerMessage(settings, { name, company, stars }) {
  const s = normalizeSettings(settings);
  return fillScript(s.rewardScript, {
    name,
    company,
    stars,
    reward: s.rewardLabel,
  });
}

module.exports = {
  DEFAULT_SCRIPT,
  normalizeSettings,
  settingsFromMember,
  settingsFromBody,
  isPaidMember,
  qualifies,
  fillScript,
  buildCustomerMessage,
};
