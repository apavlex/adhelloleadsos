/**
 * Daily Action Plan Tracker — activity catalog (monthly checkbox grid).
 */

const ACTION_PLAN_CATEGORIES = [
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

const ALL_ACTIVITY_IDS = ACTION_PLAN_CATEGORIES.flatMap((c) =>
  c.activities.map((a) => a.id),
);

function listAllActivities() {
  return ACTION_PLAN_CATEGORIES.flatMap((c) =>
    c.activities.map((a) => ({ ...a, categoryId: c.id, categoryLabel: c.label })),
  );
}

module.exports = {
  ACTION_PLAN_CATEGORIES,
  ALL_ACTIVITY_IDS,
  listAllActivities,
};
