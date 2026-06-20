/**
 * Daily Action Plan Tracker — activity catalog (monthly checkbox grid).
 */

const DEFAULT_ACTION_PLAN_CATEGORIES = [
  {
    id: 'arms_reach',
    label: "ARM'S REACH",
    activities: [
      { id: 'facebook_post', label: 'Facebook Post (1/Quarter)', gen: true },
      { id: 'ask_referral', label: 'Ask For 1 Referral', gen: true },
    ],
  },
  {
    id: 'perfect_prospecting',
    label: 'PERFECT PROSPECTING PLAN',
    activities: [
      { id: 'cold_emails', label: 'Send 10 Cold Emails', gen: true },
      { id: 'facebook_dms', label: 'Send 10 Facebook DMs', gen: true },
      { id: 'instagram_dms', label: 'Send 10 Instagram DMs', gen: true },
      { id: 'call_businesses', label: 'Call 10 Businesses', gen: true },
    ],
  },
  {
    id: 'computers_reach',
    label: "COMPUTER'S REACH",
    activities: [
      { id: 'upwork_bids', label: 'Bid On 5 Upwork Postings', gen: true },
    ],
  },
];

const ACTION_PLAN_CATEGORIES = DEFAULT_ACTION_PLAN_CATEGORIES;

const ALL_ACTIVITY_IDS = DEFAULT_ACTION_PLAN_CATEGORIES.flatMap((c) =>
  c.activities.map((a) => a.id),
);

function slugifyId(label, used, fallbackPrefix) {
  const usedSet = used instanceof Set ? used : new Set(used || []);
  let base = String(label || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
  if (!base) base = fallbackPrefix || 'item';
  let id = base;
  let n = 2;
  while (usedSet.has(id)) {
    id = `${base}_${n}`;
    n += 1;
  }
  usedSet.add(id);
  return id;
}

function normalizeCatalog(raw) {
  const input = raw && typeof raw === 'object' ? raw : {};
  const clientGoalRaw = parseInt(input.clientGoal, 10);
  const clientGoal = Number.isFinite(clientGoalRaw) && clientGoalRaw > 0 ? clientGoalRaw : 5;
  const catsIn = Array.isArray(input.categories) ? input.categories : DEFAULT_ACTION_PLAN_CATEGORIES;
  const usedCatIds = new Set();
  const usedActIds = new Set();
  const categories = [];

  catsIn.forEach((cat, catIdx) => {
    if (!cat || typeof cat !== 'object') return;
    const label = String(cat.label || '').trim();
    if (!label) return;

    let catId = String(cat.id || '').trim();
    if (!catId || usedCatIds.has(catId)) {
      catId = slugifyId(label, usedCatIds, `category_${catIdx + 1}`);
    } else {
      usedCatIds.add(catId);
    }

    const actsIn = Array.isArray(cat.activities) ? cat.activities : [];
    const activities = [];
    actsIn.forEach((act, actIdx) => {
      if (!act || typeof act !== 'object') return;
      const actLabel = String(act.label || '').trim();
      if (!actLabel) return;
      let actId = String(act.id || '').trim();
      if (!actId || usedActIds.has(actId)) {
        actId = slugifyId(actLabel, usedActIds, `activity_${catIdx + 1}_${actIdx + 1}`);
      } else {
        usedActIds.add(actId);
      }
      activities.push({
        id: actId,
        label: actLabel.slice(0, 120),
        gen: act.gen !== false,
      });
    });

    categories.push({
      id: catId,
      label: label.slice(0, 80),
      activities,
    });
  });

  if (!categories.length) {
    return normalizeCatalog({ categories: DEFAULT_ACTION_PLAN_CATEGORIES, clientGoal });
  }

  return { categories, clientGoal };
}

function listAllActivities(categories) {
  const cats = categories || DEFAULT_ACTION_PLAN_CATEGORIES;
  return cats.flatMap((c) =>
    (c.activities || []).map((a) => ({ ...a, categoryId: c.id, categoryLabel: c.label })),
  );
}

function allActivityIds(categories) {
  return listAllActivities(categories).map((a) => a.id);
}

module.exports = {
  ACTION_PLAN_CATEGORIES,
  DEFAULT_ACTION_PLAN_CATEGORIES,
  ALL_ACTIVITY_IDS,
  normalizeCatalog,
  slugifyId,
  listAllActivities,
  allActivityIds,
};
