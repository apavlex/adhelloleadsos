/**
 * Reviews-app setup checklist shown on Home after signup.
 * Complements the 7-day email drip (reviewsOnboardingDrip) with in-app steps.
 */

const reviewPage = require('./reviewPage');
const push = require('./pushNotifications');

function isFreemiumMember(member) {
  const plan = String((member && member.plan) || '');
  return plan === 'app_free' || plan === 'app_flooring';
}

const STEPS = [
  {
    id: 'profile',
    title: 'Fill out your profile',
    hint: 'Business name, your name, and a phone or email',
    href: '/profile',
    cta: 'Open profile',
  },
  {
    id: 'review_links',
    title: 'Add review links',
    hint: 'Google and/or Yelp so customers land on the right page',
    href: '/review/settings',
    cta: 'Add links',
  },
  {
    id: 'banner',
    title: 'Update your banner image',
    hint: 'A van, job site, or storefront photo for your Home screen',
    href: '/',
    cta: 'Upload on Home',
    hash: '#ma-onboarding-banner',
  },
  {
    id: 'notifications',
    title: 'Turn on phone alerts',
    hint: 'Get a popup when leads, referrals, or news arrive',
    href: '/',
    cta: 'Turn on alerts',
    action: 'notifications',
  },
  {
    id: 'home_screen',
    title: 'Add to your phone Home Screen',
    hint: 'Save the app icon so Reviews is one tap away',
    href: '/',
    cta: 'Save as app',
    action: 'install',
  },
];

/** Only show the Home setup card to members who joined recently (first-time users). */
const SHOW_DAYS = 14;

function normalizeMeta(raw) {
  const m = raw && typeof raw === 'object' ? raw : {};
  const marked = m.marked && typeof m.marked === 'object' ? m.marked : {};
  const outMarked = {};
  STEPS.forEach((s) => {
    if (marked[s.id]) outMarked[s.id] = String(marked[s.id]).slice(0, 40);
  });
  return {
    dismissedAt: String(m.dismissedAt || '').trim().slice(0, 40),
    firstOpenedAt: String(m.firstOpenedAt || '').trim().slice(0, 40),
    marked: outMarked,
  };
}

function isNewFirstTimeMember(member) {
  const joinedMs = Date.parse((member && member.joinedAt) || '') || 0;
  if (!joinedMs) return false;
  const ageDays = (Date.now() - joinedMs) / (24 * 60 * 60 * 1000);
  // Only recent signups / first-time openers — hide from long-time partners.
  return ageDays <= SHOW_DAYS;
}

function profileComplete(member) {
  if (!member) return false;
  const company = String(member.companyName || '').trim();
  const contact = String(member.contactName || '').trim();
  const phone = String(member.phone || '').trim();
  const email = String(member.email || '').trim();
  if (!company || company === 'Member') return false;
  if (!contact) return false;
  return !!(phone || email);
}

function reviewLinksComplete(member) {
  return reviewPage.countLinks(member && member.reviewLinks) > 0;
}

function bannerComplete(member, { networkHeroUrl } = {}) {
  if (member && member.heroUpdatedAt) return true;
  // Paid network members share the network hero — count that once set.
  if (!isFreemiumMember(member) && networkHeroUrl) return true;
  return false;
}

function notificationsComplete(member, meta) {
  if (meta && meta.marked && meta.marked.notifications) return true;
  if (!member || !member.id) return false;
  try {
    return push.matchingMemberSubscriptions({
      networkId: member._networkId || '',
      memberId: member.id,
    }).length > 0;
  } catch {
    return false;
  }
}

function homeScreenComplete(meta) {
  return !!(meta && meta.marked && meta.marked.home_screen);
}

function isStepDone(stepId, member, meta, opts = {}) {
  switch (stepId) {
    case 'profile':
      return profileComplete(member);
    case 'review_links':
      return reviewLinksComplete(member);
    case 'banner':
      return bannerComplete(member, opts);
    case 'notifications':
      return notificationsComplete(
        { ...member, _networkId: opts.networkId },
        meta,
      );
    case 'home_screen':
      return homeScreenComplete(meta);
    default:
      return !!(meta && meta.marked && meta.marked[stepId]);
  }
}

function buildChecklist({
  member,
  network,
  base = '',
  networkHeroUrl = '',
  meta: metaIn,
} = {}) {
  const meta = normalizeMeta(metaIn || (member && member.setupChecklist));
  const networkId = network && network.id;
  const steps = STEPS.map((s) => {
    const done = isStepDone(s.id, member, meta, { networkId, networkHeroUrl });
    let href = `${base}${s.href || '/'}`;
    if (s.hash) href += s.hash;
    return {
      id: s.id,
      title: s.title,
      hint: s.hint,
      cta: s.cta,
      href,
      action: s.action || '',
      done,
    };
  });
  const doneCount = steps.filter((s) => s.done).length;
  const total = steps.length;
  const allDone = doneCount >= total;
  const dismissed = !!meta.dismissedAt;
  const firstTime = isNewFirstTimeMember(member);
  // New first-time openers only — not long-time flooring/free partners.
  const show = !dismissed && !allDone && firstTime;

  return {
    show,
    dismissed,
    allDone,
    doneCount,
    total,
    progressLabel: `${doneCount} of ${total}`,
    steps,
    meta,
    next: steps.find((s) => !s.done) || null,
    firstTime,
  };
}

/** Stamp first Home open so we can tell first-time openers from returning users. */
function markFirstOpened(metaIn) {
  const meta = normalizeMeta(metaIn);
  if (!meta.firstOpenedAt) meta.firstOpenedAt = new Date().toISOString();
  return meta;
}

function markStep(metaIn, stepId) {
  const meta = normalizeMeta(metaIn);
  const id = String(stepId || '').trim();
  if (!STEPS.some((s) => s.id === id)) return meta;
  meta.marked[id] = new Date().toISOString();
  return meta;
}

function dismiss(metaIn) {
  const meta = normalizeMeta(metaIn);
  meta.dismissedAt = new Date().toISOString();
  return meta;
}

module.exports = {
  STEPS,
  SHOW_DAYS,
  normalizeMeta,
  profileComplete,
  reviewLinksComplete,
  bannerComplete,
  isNewFirstTimeMember,
  buildChecklist,
  markFirstOpened,
  markStep,
  dismiss,
};
