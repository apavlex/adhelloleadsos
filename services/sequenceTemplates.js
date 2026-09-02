/**
 * Built-in outreach cadences (day offset from sequence anchor = day 1 anchor at step 0).
 * Email/SMS steps auto-send via GHL when the scheduler fires due steps.
 * Personalization: {{business_name}}, {{domain}}, {{city}}, {{score}}, {{tier}}, {{top_finding}},
 * {{competitor_with_meta_desc}}, {{report_link}}, {{calendly_or_book}}
 */

const DAY_MS = 86400000;

/** Cadences that include hosted audit links / AdHello-style outreach — agency workspaces only. */
const AUDIT_CADENCE_TEMPLATE_IDS = new Set([
  'audit_local_14',
  'audit_hot_5',
  'audit_reengage_7',
  'auto_outreach_7',
]);

function isAuditCadenceTemplate(templateId) {
  const id = String(templateId || '').trim();
  if (!id) return false;
  if (AUDIT_CADENCE_TEMPLATE_IDS.has(id)) return true;
  return /^(audit_|auto_outreach)/i.test(id);
}

const DEFAULT_SEQUENCE_TEMPLATES = [
  {
    id: 'audit_local_14',
    persona: 'Audit',
    name: 'Local service · 14-day audit hook (8 touches)',
    description:
      'Cold call + hosted link → PDF email → LinkedIn or second call → bump → value → voicemail → breakup → final text. Pauses automatically when status shows engagement.',
    steps: [
      {
        dayOffset: 0,
        channel: 'call',
        title: 'Day 1 — Cold call + text (opener)',
        hint: 'Call first. Voicemail (~15s): Hi, it is [name] — I ran a quick scan on {{domain}} and noticed {{top_finding}}. I will text you the report. Then text hosted link immediately: {{report_link}} (contractors read texts faster than email).',
      },
      {
        dayOffset: 1,
        channel: 'email',
        title: 'Day 2 — Deliver the PDF',
        hint: 'Subject: Your website audit, {{business_name}}. Max 3 sentences: top finding ({{top_finding}}), score {{score}}/100 ({{tier}}), link {{calendly_or_book}}. Attach PDF from report page — no hard pitch yet.',
      },
      {
        dayOffset: 3,
        channel: 'linkedin',
        title: 'Day 4 — LinkedIn connect or second call',
        hint: 'If they are on LinkedIn: connection note referencing the audit. If not: call at a different time block than Day 1.',
      },
      {
        dayOffset: 5,
        channel: 'email',
        title: 'Day 6 — “Did you see this?” bump',
        hint: 'Forward Day 2 thread with one line: Wanted to make sure this did not get buried — even fixing the meta description takes ~10 minutes and helps clicks.',
      },
      {
        dayOffset: 7,
        channel: 'email',
        title: 'Day 8 — Value email (no ask)',
        hint: 'Useful only: competitor angle ({{competitor_with_meta_desc}}), one annotated screenshot, or a quick tip. No calendar ask — builds trust.',
      },
      {
        dayOffset: 9,
        channel: 'call',
        title: 'Day 10 — Third call + voicemail',
        hint: 'New angle: I will stop bugging you after this — if the audit was not useful, tell me why so I can improve it. Self-deprecation + feedback often gets callbacks.',
      },
      {
        dayOffset: 11,
        channel: 'email',
        title: 'Day 12 — Permission to close the file',
        hint: 'Breakup email: Should I close your file or is this just bad timing? Expect “follow up in [month]” replies — log for re-engagement.',
      },
      {
        dayOffset: 13,
        channel: 'sms',
        title: 'Day 14 — Final text',
        hint: 'Closing your file today — if you ever want a fresh audit: {{report_link}} Good luck with the season.',
      },
    ],
  },
  {
    id: 'audit_hot_5',
    persona: 'Audit',
    name: 'Hot lead · 5-day fast lane (4 touches)',
    description: 'After a click or reply — faster touches; calendar link in every step.',
    steps: [
      {
        dayOffset: 0,
        channel: 'email',
        title: 'Day 1 — Fast personal follow-up',
        hint: 'Reference {{top_finding}} and score {{score}}/100. CTA: {{calendly_or_book}}. Link live report: {{report_link}}',
      },
      { dayOffset: 1, channel: 'call', title: 'Day 2 — Call', hint: 'Confirm they saw the audit; offer 15 min same week.' },
      { dayOffset: 3, channel: 'email', title: 'Day 4 — Calendar + proof', hint: 'Short ROI angle + {{calendly_or_book}}' },
      { dayOffset: 4, channel: 'sms', title: 'Day 5 — Text check-in', hint: 'One line + {{calendly_or_book}}' },
    ],
  },
  {
    id: 'auto_outreach_7',
    persona: 'Audit',
    name: 'Auto outreach · 7-day email + SMS (4 touches)',
    description:
      'Hands-off prospecting cadence — email and SMS only via GHL. Day 0 email, day 1 SMS, day 3 email, day 5 SMS. No auto-call steps.',
    steps: [
      {
        dayOffset: 0,
        channel: 'email',
        title: 'Day 1 — Audit hook email',
        hint: 'Subject: Quick scan for {{business_name}}. Top finding: {{top_finding}}. Score {{score}}/100 ({{tier}}). Report: {{report_link}}',
      },
      {
        dayOffset: 1,
        channel: 'sms',
        title: 'Day 2 — Text the report link',
        hint: 'Hi — sent your site scan for {{business_name}}: {{report_link}}. Reply if you want a quick walkthrough.',
      },
      {
        dayOffset: 3,
        channel: 'email',
        title: 'Day 4 — Bump + calendar',
        hint: 'Short bump referencing {{top_finding}}. CTA: {{calendly_or_book}}. Link: {{report_link}}',
      },
      {
        dayOffset: 5,
        channel: 'sms',
        title: 'Day 6 — Final text check-in',
        hint: 'Last nudge — still happy to walk through the audit: {{report_link}} or book: {{calendly_or_book}}',
      },
    ],
  },
  {
    id: 'audit_reengage_7',
    persona: 'Audit',
    name: 'Re-engagement · 7 days (3 touches)',
    description: 'Lead with score change or stale audit — change beats status.',
    steps: [
      {
        dayOffset: 0,
        channel: 'email',
        title: 'Day 1 — Re-audit opener',
        hint: 'Subject: Re-ran your site — something changed. Body: score {{score}}/100 ({{tier}}), {{top_finding}}. Link {{report_link}}',
      },
      { dayOffset: 3, channel: 'call', title: 'Day 4 — Call', hint: 'Reference delta vs last crawl if you logged it; otherwise {{top_finding}}.' },
      { dayOffset: 6, channel: 'email', title: 'Day 7 — Soft close', hint: 'Offer fresh audit next quarter + {{calendly_or_book}}' },
    ],
  },
  {
    id: 'clay_standard',
    persona: 'Clay',
    name: 'Clay · warm trial nurture',
    description: 'Email → LinkedIn → call → DM → breakup',
    steps: [
      { dayOffset: 0, channel: 'email', title: 'Day 0 — First email', hint: 'Reference 1 concrete gap; CTA = 15-min fit call.' },
      { dayOffset: 2, channel: 'linkedin', title: 'Day 2 — LinkedIn connect', hint: 'Short note, no pitch; tie to their city or category.' },
      { dayOffset: 4, channel: 'task', title: 'Day 4 — Call task', hint: 'Dial or book a live CQI-style discovery.' },
      { dayOffset: 7, channel: 'linkedin', title: 'Day 7 — Value-add DM', hint: 'Share one insight or asset; soft ask.' },
      { dayOffset: 14, channel: 'email', title: 'Day 14 — Breakup', hint: 'Polite close-the-loop; door open.' },
    ],
  },
  {
    id: 'paul_standard',
    persona: 'Paul',
    name: 'Paul · founder-to-founder',
    description: 'Direct email cadence with peer tone',
    steps: [
      { dayOffset: 0, channel: 'email', title: 'Day 0 — Peer intro', hint: 'Short credibility line + one observation.' },
      { dayOffset: 3, channel: 'email', title: 'Day 3 — Follow-up', hint: 'Different angle; mention outcome not features.' },
      { dayOffset: 7, channel: 'task', title: 'Day 7 — Quick call', hint: '15 min — pipeline or ops motion.' },
      { dayOffset: 12, channel: 'email', title: 'Day 12 — Breakup', hint: 'Assume timing; leave opt-in.' },
    ],
  },
  {
    id: 'bob_standard',
    persona: 'Bob',
    name: 'Bob · enterprise careful',
    description: 'Longer spacing, formal tone',
    steps: [
      { dayOffset: 0, channel: 'email', title: 'Day 0 — Formal intro', hint: 'Compliance-aware; no hype.' },
      { dayOffset: 5, channel: 'linkedin', title: 'Day 5 — LinkedIn', hint: 'Connection request + value reference.' },
      { dayOffset: 10, channel: 'task', title: 'Day 10 — Discovery call', hint: 'Stakeholder map + technical fit.' },
      { dayOffset: 18, channel: 'email', title: 'Day 18 — Summary + next step', hint: 'Written recap if no reply.' },
    ],
  },
];

function listTemplates() {
  return DEFAULT_SEQUENCE_TEMPLATES.map((t) => ({
    id: t.id,
    persona: t.persona,
    name: t.name,
    description: t.description,
    stepCount: t.steps.length,
  }));
}

function getTemplate(templateId) {
  return DEFAULT_SEQUENCE_TEMPLATES.find((t) => t.id === templateId) || null;
}

function dueAtIso(anchorIso, dayOffset) {
  const anchor = Date.parse(anchorIso);
  if (Number.isNaN(anchor)) return new Date().toISOString();
  return new Date(anchor + dayOffset * DAY_MS).toISOString();
}

module.exports = {
  AUDIT_CADENCE_TEMPLATE_IDS,
  DEFAULT_SEQUENCE_TEMPLATES,
  isAuditCadenceTemplate,
  listTemplates,
  getTemplate,
  dueAtIso,
  DAY_MS,
};
