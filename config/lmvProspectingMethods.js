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
    icon: 'flame',
    title: "Arm's Reach",
    temperature: 'hot',
    temperatureLabel: 'Hot',
    description: 'Warm outreach to people you already know. Fastest path to your first client.',
    actionLabel: 'Generate scripts',
    actionHref: '/sales/personas#arms-reach',
  },
  {
    id: 'computers_reach',
    icon: 'monitor',
    title: "Computer's Reach (Upwork)",
    temperature: 'warm',
    temperatureLabel: 'Warm',
    description: 'Find clients looking for marketing help right now on Upwork.',
    actionLabel: 'Generate proposal',
    actionHref: '/sales/personas#computers-reach',
  },
  {
    id: 'cars_reach',
    icon: 'car',
    title: "Car's Reach (Networking)",
    temperature: 'warm',
    temperatureLabel: 'Warm',
    description: 'BNI, chambers of commerce, and local networking events.',
    actionLabel: 'Generate pitch',
    actionHref: '/sales/personas',
  },
  {
    id: 'cold_email',
    icon: 'mail',
    title: 'Cold Email',
    temperature: 'cold',
    temperatureLabel: 'Cold',
    contactHint: 'Has email',
    description: 'Personalized outreach to decision-makers using the LMV methodology.',
    actionLabel: 'Start emailing',
    actionHref: '/prospecting?tab=pipeline&reach=email#tableView',
  },
  {
    id: 'cold_calling',
    icon: 'phone',
    title: 'Cold Calling',
    temperature: 'cold',
    temperatureLabel: 'Cold',
    contactHint: 'Has phone',
    description: 'Direct phone outreach to local business owners.',
    actionLabel: 'Start calling',
    actionHref: '/prospecting?tab=pipeline&reach=phone#tableView',
  },
  {
    id: 'double_tap',
    icon: 'layers',
    title: 'Double Tap',
    temperature: 'cold',
    temperatureLabel: 'Cold',
    contactHint: 'Email + phone + social',
    description: 'Multi-channel approach: DMs + email sequence for higher response rates.',
    actionLabel: 'Start tapping',
    actionHref: '/prospecting?tab=pipeline&reach=double_tap#tableView',
  },
];

module.exports = {
  OUTREACH_LIST_TAG_NAMES,
  LMV_PROSPECTING_METHODS,
};
