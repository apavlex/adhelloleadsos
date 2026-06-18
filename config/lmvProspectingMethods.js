/**
 * LMV prospecting methods — six outreach approaches shown on the pipeline.
 */

const OUTREACH_LIST_TAG_NAMES = {
  call: 'Call List',
  email: 'Email List',
  doubleTap: 'Double Tap List',
};

const LMV_PROSPECTING_METHODS = [
  {
    id: 'arms_reach',
    icon: '🔥',
    title: "Arm's Reach",
    temperature: 'hot',
    temperatureLabel: 'HOT 🔥',
    description: 'Warm outreach to people you already know. Fastest path to your first client.',
    actionLabel: 'Generate Scripts',
    actionHref: '/scripts',
    actionStyle: 'gradient',
  },
  {
    id: 'computers_reach',
    icon: '💻',
    title: "Computer's Reach (Upwork)",
    temperature: 'warm',
    temperatureLabel: 'WARM',
    description: 'Find clients looking for marketing help right now on Upwork.',
    actionLabel: 'Generate Proposal',
    actionHref: '/scripts',
    actionStyle: 'gradient',
  },
  {
    id: 'cars_reach',
    icon: '🚗',
    title: "Car's Reach (Networking)",
    temperature: 'warm',
    temperatureLabel: 'WARM',
    description: 'BNI, chambers of commerce, and local networking events.',
    actionLabel: 'Generate Pitch',
    actionHref: '/scripts',
    actionStyle: 'gradient',
  },
  {
    id: 'cold_email',
    icon: '📧',
    title: 'Cold Email',
    temperature: 'cold',
    temperatureLabel: 'COLD',
    listBadge: '1 LIST',
    description: 'Personalized outreach to decision-makers using the LMV methodology.',
    actionLabel: 'Start Emailing',
    actionKind: 'email_list',
    actionStyle: 'solid',
  },
  {
    id: 'cold_calling',
    icon: '📞',
    title: 'Cold Calling',
    temperature: 'cold',
    temperatureLabel: 'COLD',
    listBadge: '2 LISTS',
    description: 'Direct phone outreach to local business owners.',
    actionLabel: 'Start Calling',
    actionKind: 'call_list',
    actionStyle: 'solid',
  },
  {
    id: 'double_tap',
    icon: '☝️',
    title: 'Double Tap',
    temperature: 'cold',
    temperatureLabel: 'COLD',
    description: 'Multi-channel approach: DMs + email sequence for higher response rates.',
    actionLabel: 'Start Tapping',
    actionKind: 'double_tap_list',
    actionStyle: 'solid',
  },
];

module.exports = {
  OUTREACH_LIST_TAG_NAMES,
  LMV_PROSPECTING_METHODS,
};
