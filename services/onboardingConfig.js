/**
 * Per-workspace teammate onboarding: invite email + daily activation steps.
 * The same steps drive the in-app activation checklist and the daily GHL emails.
 */

const MAX_STEPS = 14;
const DEFAULT_SEND_HOUR = 9;

const ACTIVATION_EVENTS = [
  { key: '', label: 'Manual — teammate clicks Mark done' },
  { key: 'search_saved', label: 'Runs a lead search' },
  { key: 'csv_import', label: 'Imports a CSV' },
  { key: 'manual_lead_added', label: 'Adds a lead manually' },
  { key: 'autopilot_scheduled', label: 'Schedules a lead run' },
  { key: 'sequence_started', label: 'Starts a cadence' },
  { key: 'outreach_logged', label: 'Logs outreach' },
  { key: 'pipeline_advanced', label: 'Moves a lead forward in the pipeline' },
  { key: 'analytics_visit', label: 'Opens reports' },
];
const EVENT_KEYS = new Set(ACTIVATION_EVENTS.map((e) => e.key));

const SUGGESTED_LINKS = [
  { href: '/today', label: 'Today' },
  { href: '/', label: 'Find leads (search)' },
  { href: '/prospecting?tab=pipeline', label: 'Pipeline' },
  { href: '/prospecting?tab=queue', label: 'Working queue' },
  { href: '/sequences', label: 'Cadences' },
  { href: '/sales/workflow', label: 'Sales workflow' },
  { href: '/reports', label: 'Reports' },
  { href: '/tasks', label: 'Tasks' },
  { href: '/team-history', label: 'Team history' },
];

const PLACEHOLDERS = [
  { key: 'first_name', label: "Teammate's first name" },
  { key: 'workspace_name', label: 'Workspace name' },
  { key: 'inviter_name', label: 'Who sent the invite' },
  { key: 'invite_link', label: 'Accept-invite link (invite email only)' },
  { key: 'app_link', label: 'Link to the app' },
  { key: 'day', label: 'Day number' },
  { key: 'total_days', label: 'Number of days' },
  { key: 'step_title', label: "Today's step title" },
  { key: 'step_hint', label: "Today's step hint" },
  { key: 'step_link', label: "Link to today's step" },
];

const SIGN_OFF = '\n\n— The {{workspace_name}} team';

const DEFAULT_INVITE = {
  subject: "You're invited to {{workspace_name}} on Agency OS",
  body:
    'Hi {{first_name}},\n\n' +
    "{{inviter_name}} added you to the {{workspace_name}} workspace — it's where we find leads, run outreach, and track every deal.\n\n" +
    'Accept your invite and sign in with Google using this email address:\n{{invite_link}}\n\n' +
    "The link expires in 14 days. Once you're in, you'll get one short email a day for {{total_days}} days showing exactly what to do next." +
    SIGN_OFF,
};

const DEFAULT_STEPS = [
  {
    id: 'd1',
    title: 'First search',
    hint: 'Run a Maps + Apify lead pull',
    href: '/',
    event: 'search_saved',
    subject: 'Day 1: Run your first lead search',
    body:
      "Hi {{first_name}},\n\nWelcome aboard! Today's one habit: {{step_title}}.\n\n" +
      'Pick a service and a city, then run a search. In a few minutes you will have a list of real businesses to work — with phones, websites, and review data.\n\n' +
      'Start here: {{step_link}}' +
      SIGN_OFF,
  },
  {
    id: 'd2',
    title: 'Import CSV',
    hint: 'Drop enriched or exported leads',
    href: '/prospecting?tab=pipeline',
    event: 'csv_import',
    subject: 'Day 2: Bring in the leads you already have',
    body:
      "Hi {{first_name}},\n\nToday's habit: {{step_title}}.\n\n" +
      'Got a spreadsheet of past customers, trade-show contacts, or an export from another tool? Drop the CSV in and it lands in the pipeline next to your search results.\n\n' +
      'Import here: {{step_link}}' +
      SIGN_OFF,
  },
  {
    id: 'd3',
    title: 'Schedule lead runs',
    hint: 'Daily / weekly scrape while you sleep',
    href: '/prospecting?tab=queue',
    event: 'autopilot_scheduled',
    subject: 'Day 3: Let fresh leads show up on their own',
    body:
      "Hi {{first_name}},\n\nToday's habit: {{step_title}}.\n\n" +
      'Turn a search you like into a daily or weekly run. New businesses appear in your queue automatically, so you never start the day with an empty list.\n\n' +
      'Set it up: {{step_link}}' +
      SIGN_OFF,
  },
  {
    id: 'd4',
    title: 'Start a cadence',
    hint: 'Default is the 14-day audit hook (8 touches) — Cadences page or voicemail disposition auto-starts it',
    href: '/sequences',
    event: 'sequence_started',
    subject: 'Day 4: Put follow-up on autopilot',
    body:
      "Hi {{first_name}},\n\nToday's habit: {{step_title}}.\n\n" +
      'Most deals close on the 5th touch or later. Start a cadence on one lead and the app schedules every call, text, and email for you.\n\n' +
      'Start one: {{step_link}}' +
      SIGN_OFF,
  },
  {
    id: 'd5',
    title: 'Log outreach',
    hint: 'Streak + discipline in the tracker',
    href: '/prospecting?tab=queue',
    event: 'outreach_logged',
    subject: 'Day 5: Log your outreach and start a streak',
    body:
      "Hi {{first_name}},\n\nToday's habit: {{step_title}}.\n\n" +
      'Call or message a few leads from your queue and log each touch. Your daily streak builds momentum — and the whole team can see who was contacted.\n\n' +
      'Open your queue: {{step_link}}' +
      SIGN_OFF,
  },
  {
    id: 'd6',
    title: 'Advance the pipeline',
    hint: 'Move a card past New (stage 1)',
    href: '/sales/workflow',
    event: 'pipeline_advanced',
    subject: 'Day 6: Move a deal forward',
    body:
      "Hi {{first_name}},\n\nToday's habit: {{step_title}}.\n\n" +
      'Take one lead you have talked to and move it to the next stage. Keeping the board current is how everyone knows what is closing this week.\n\n' +
      'Open the pipeline: {{step_link}}' +
      SIGN_OFF,
  },
  {
    id: 'd7',
    title: 'Review reports',
    hint: 'See traffic + conversion momentum',
    href: '/reports',
    event: 'analytics_visit',
    subject: 'Day 7: See what your week added up to',
    body:
      "Hi {{first_name}},\n\nLast one! Today's habit: {{step_title}}.\n\n" +
      'Open reports to see the leads, touches, and pipeline movement from your first week. Keep these daily habits going and the numbers compound.\n\n' +
      'View reports: {{step_link}}' +
      SIGN_OFF,
  },
];

const DEFAULT_ONBOARDING = {
  enabled: true,
  sendInviteEmail: true,
  skipCompleted: true,
  sendHour: DEFAULT_SEND_HOUR,
  invite: DEFAULT_INVITE,
  steps: DEFAULT_STEPS,
};

function clip(v, max) {
  return String(v == null ? '' : v).trim().slice(0, max);
}

function clampHour(v) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return DEFAULT_SEND_HOUR;
  return Math.min(23, Math.max(0, n));
}

function normalizeHref(raw) {
  const s = clip(raw, 500);
  if (!s) return '/today';
  if (s.startsWith('/') && !s.startsWith('//')) return s;
  if (/^https?:\/\//i.test(s)) return s;
  return '/today';
}

function newStepId() {
  return `s_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function normalizeStep(raw, usedIds) {
  if (!raw || typeof raw !== 'object') return null;
  const title = clip(raw.title || raw.label, 120);
  if (!title) return null;
  let id = clip(raw.id, 24).toLowerCase();
  if (!/^[a-z0-9_]+$/.test(id) || usedIds.has(id)) id = newStepId();
  usedIds.add(id);
  const event = EVENT_KEYS.has(String(raw.event || '')) ? String(raw.event || '') : '';
  return {
    id,
    title,
    hint: clip(raw.hint, 300),
    href: normalizeHref(raw.href),
    event,
    subject: clip(raw.subject, 200) || `Day {{day}}: ${title}`,
    body: clip(raw.body, 6000),
  };
}

function normalizeOnboarding(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const usedIds = new Set();
  let steps = (Array.isArray(src.steps) ? src.steps : [])
    .slice(0, MAX_STEPS)
    .map((s) => normalizeStep(s, usedIds))
    .filter(Boolean);
  if (!steps.length) steps = DEFAULT_STEPS.map((s) => ({ ...s }));
  const invite = src.invite && typeof src.invite === 'object' ? src.invite : {};
  return {
    enabled: src.enabled !== false,
    sendInviteEmail: src.sendInviteEmail !== false,
    skipCompleted: src.skipCompleted !== false,
    sendHour: src.sendHour == null ? DEFAULT_SEND_HOUR : clampHour(src.sendHour),
    invite: {
      subject: clip(invite.subject, 200) || DEFAULT_INVITE.subject,
      body: clip(invite.body, 6000) || DEFAULT_INVITE.body,
    },
    steps,
    updatedAt: src.updatedAt || null,
  };
}

function onboardingForWorkspace(ws) {
  return normalizeOnboarding(ws && ws.onboarding);
}

function stepLabel(step, index) {
  return `Day ${index + 1} — ${step.title}`;
}

function renderTemplate(template, vars) {
  const v = vars || {};
  return String(template || '').replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (m, key) => {
    const val = v[key.toLowerCase()];
    return val == null ? '' : String(val);
  });
}

module.exports = {
  MAX_STEPS,
  DEFAULT_SEND_HOUR,
  ACTIVATION_EVENTS,
  EVENT_KEYS,
  SUGGESTED_LINKS,
  PLACEHOLDERS,
  DEFAULT_INVITE,
  DEFAULT_STEPS,
  DEFAULT_ONBOARDING,
  normalizeOnboarding,
  onboardingForWorkspace,
  normalizeStep,
  stepLabel,
  renderTemplate,
};
