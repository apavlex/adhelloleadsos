/**
 * Reviews-app setup checklist shown on Home after signup.
 * Complements the 7-day email drip (reviewsOnboardingDrip) with in-app steps.
 * Branding (name, image, colors) comes before Add to Home Screen.
 */

const reviewPage = require('./reviewPage');
const push = require('./pushNotifications');
const networkBrand = require('./networkBrand');

function isFreemiumMember(member) {
  const plan = String((member && member.plan) || '');
  return plan === 'app_free' || plan === 'app_flooring';
}

/** Accent swatches offered in the branding sheet (plus custom hex). */
const BRAND_ACCENT_PRESETS = [
  '#FFDB3A',
  '#0EA5E9',
  '#10B981',
  '#F59E0B',
  '#EF4444',
  '#8B5CF6',
  '#111827',
];

const STEPS = [
  {
    id: 'profile',
    title: 'Fill out your profile',
    hint: 'Business name, your name, and a phone or email',
    href: '/profile',
    cta: 'Open profile',
  },
  {
    id: 'branding',
    title: 'Brand your app',
    hint: 'Name, logo/photo, and colors — before you save it to your phone',
    href: '/',
    cta: 'Set branding',
    action: 'branding',
  },
  {
    id: 'review_links',
    title: 'Add review links',
    hint: 'Google and/or Yelp so customers land on the right page',
    href: '/review/settings',
    cta: 'Add links',
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
    hint: 'Save the branded app icon so Reviews is one tap away',
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
  const ids = new Set(STEPS.map((s) => s.id).concat(['banner']));
  ids.forEach((id) => {
    if (marked[id]) outMarked[id] = String(marked[id]).slice(0, 40);
  });
  // Legacy banner mark counts as branding progress.
  if (!outMarked.branding && outMarked.banner) outMarked.branding = outMarked.banner;
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

function brandingComplete(member, meta, opts = {}) {
  if (meta && meta.marked && meta.marked.branding) return true;
  // Paid / partner apps inherit workspace white-label — no personal brand kit.
  if (!isFreemiumMember(member)) return true;
  if (member && member.brandSavedAt) return true;
  const name = String((member && (member.brandAppName || member.companyName)) || '').trim();
  const accent = networkBrand.normalizeHex(member && member.brandAccent);
  const hasImage = !!(
    (member && member.heroUpdatedAt) ||
    (member && member.profilePhotoUpdatedAt) ||
    opts.hasProfilePhoto ||
    opts.hasHero
  );
  return !!(name && name !== 'Member' && accent && hasImage);
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
    case 'branding':
      return brandingComplete(member, meta, opts);
    case 'review_links':
      return reviewLinksComplete(member);
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
  hasProfilePhoto = false,
  hasHero = false,
} = {}) {
  const meta = normalizeMeta(metaIn || (member && member.setupChecklist));
  const networkId = network && network.id;
  const brandingDone = brandingComplete(member, meta, {
    networkHeroUrl,
    hasProfilePhoto,
    hasHero: hasHero || !!(member && member.heroUpdatedAt),
  });
  const steps = STEPS.map((s) => {
    const done = isStepDone(s.id, member, meta, {
      networkId,
      networkHeroUrl,
      hasProfilePhoto,
      hasHero,
    });
    let href = `${base}${s.href || '/'}`;
    if (s.hash) href += s.hash;
    const installLocked = s.id === 'home_screen' && !done && !brandingDone;
    return {
      id: s.id,
      title: s.title,
      hint: installLocked
        ? 'Finish branding (name, image, colors) first'
        : s.hint,
      cta: installLocked ? 'Brand first' : s.cta,
      href,
      action: installLocked ? 'branding' : (s.action || ''),
      done,
      installLocked,
    };
  });
  const doneCount = steps.filter((s) => s.done).length;
  const total = steps.length;
  const allDone = doneCount >= total;
  const dismissed = !!meta.dismissedAt;
  const firstTime = isNewFirstTimeMember(member);
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
    brandingComplete: brandingDone,
    installLocked: show && !brandingDone,
    accentPresets: BRAND_ACCENT_PRESETS.slice(),
    brandDefaults: {
      appName: String((member && (member.brandAppName || member.companyName)) || '').trim(),
      accent:
        networkBrand.normalizeHex(member && member.brandAccent) ||
        networkBrand.DEFAULT_ACCENT,
    },
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
  if (!STEPS.some((s) => s.id === id) && id !== 'banner') return meta;
  meta.marked[id] = new Date().toISOString();
  if (id === 'banner') meta.marked.branding = meta.marked[id];
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
  BRAND_ACCENT_PRESETS,
  normalizeMeta,
  profileComplete,
  reviewLinksComplete,
  brandingComplete,
  isNewFirstTimeMember,
  isFreemiumMember,
  buildChecklist,
  markFirstOpened,
  markStep,
  dismiss,
};
