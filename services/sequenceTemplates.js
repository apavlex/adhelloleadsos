/**
 * Built-in outreach cadences (day offset from sequence anchor = day 0).
 * Sending / LinkedIn / tasks are surfaced as reminders in lead logs — wire email providers separately.
 */

const DAY_MS = 86400000;

const DEFAULT_SEQUENCE_TEMPLATES = [
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
  DEFAULT_SEQUENCE_TEMPLATES,
  listTemplates,
  getTemplate,
  dueAtIso,
  DAY_MS,
};
