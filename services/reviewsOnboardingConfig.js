/**
 * Reviews-app (reviews.adhello.io) 7-day onboarding — separate from Agency OS
 * leader onboarding. Steps are Reviews portal habits, not CRM prospecting.
 */

const DEFAULT_SEND_HOUR = 9;

const SIGN_OFF = '\n\n— The AdHello Reviews team';

const DEFAULT_STEPS = [
  {
    id: 'r1',
    title: 'Finish your Reviews setup',
    subject: 'Day 1: Finish setting up your Reviews app',
    body:
      'Hi {{first_name}},\n\nWelcome to the Reviews app! On Home you’ll see a short setup checklist:\n\n' +
      '1) Fill out your profile\n2) Add Google/Yelp review links\n3) Upload a banner photo\n' +
      '4) Turn on phone alerts\n5) Add the app to your Home Screen\n\n' +
      'Open the app and knock those out: {{app_link}}\n\n' +
      'Your review page: {{review_link}}' +
      SIGN_OFF,
  },
  {
    id: 'r2',
    title: 'Add the app to your Home Screen',
    subject: 'Day 2: Open Reviews like an app',
    body:
      'Hi {{first_name}},\n\nToday: pin the Reviews app to your phone Home Screen so it’s one tap away on every job.\n\n' +
      'On iPhone: open {{app_link}} → Share → Add to Home Screen.\n\n' +
      'Still finishing setup? The checklist on Home walks you through profile, review links, banner, and alerts.\n\n' +
      'Your review page stays here: {{review_link}}' +
      SIGN_OFF,
  },
  {
    id: 'r3',
    title: 'Add a customer',
    subject: 'Day 3: Save a customer in Reviews',
    body:
      'Hi {{first_name}},\n\nToday: add one customer (name + phone) in the app so you can request reviews after the job.\n\n' +
      'Open the app: {{app_link}}' +
      SIGN_OFF,
  },
  {
    id: 'r4',
    title: 'Log a job',
    subject: 'Day 4: Log a finished job',
    body:
      'Hi {{first_name}},\n\nToday: log a completed job or visit. That’s the best moment to ask for a review.\n\n' +
      'App: {{app_link}}\nReview ask link: {{review_link}}' +
      SIGN_OFF,
  },
  {
    id: 'r5',
    title: 'Share your review page',
    subject: 'Day 5: Put your review page where customers see it',
    body:
      'Hi {{first_name}},\n\nToday: share your public review page — text it, email it, or print the QR for your truck or invoice.\n\n' +
      '{{review_link}}' +
      SIGN_OFF,
  },
  {
    id: 'r6',
    title: 'Ask after every job',
    subject: 'Day 6: Make “ask for a review” a habit',
    body:
      'Hi {{first_name}},\n\nToday: after your next job, send the review link before you leave the driveway.\n\n' +
      'Review link: {{review_link}}\nApp: {{app_link}}' +
      SIGN_OFF,
  },
  {
    id: 'r7',
    title: 'Check your progress',
    subject: 'Day 7: See your review momentum',
    body:
      'Hi {{first_name}},\n\nLast day of the starter plan! Open the app, check new reviews, and keep asking after every job.\n\n' +
      'App: {{app_link}}\nYour review page: {{review_link}}' +
      SIGN_OFF,
  },
];

function renderTemplate(template, vars) {
  const v = vars || {};
  return String(template || '').replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_m, key) => {
    const val = v[String(key).toLowerCase()];
    return val == null ? '' : String(val);
  });
}

function firstNameFrom(name, email) {
  const n = String(name || '').trim();
  if (n && !n.includes('@')) return n.split(/\s+/)[0];
  const local = String(email || '').split('@')[0] || '';
  if (!local) return 'there';
  return local.charAt(0).toUpperCase() + local.slice(1);
}

module.exports = {
  DEFAULT_SEND_HOUR,
  DEFAULT_STEPS,
  renderTemplate,
  firstNameFrom,
};
