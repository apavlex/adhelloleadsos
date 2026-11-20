/**
 * In-app chat employees — multiple AI personas that share CRM tools.
 * Models still go through OpenRouter (or OpenAI); each employee pins preferred models + voice.
 */

const DEFAULT_EMPLOYEE_ID = 'alex';

const EMPLOYEES = [
  {
    id: 'alex',
    name: 'Alex',
    title: 'Receptionist & sales assistant',
    blurb: 'Leads, pipeline, tasks, and scripts — steady CRM teammate.',
    greeting: "Hey, I'm Alex.",
    emptyLead: 'Find prospects, update your pipeline, add tasks, and write scripts',
    placeholder: 'Message Alex… or tap the mic',
    color: '#111827',
    avatarKind: 'alex',
    preferredOpenRouterModels: [],
    suggestions: [
      { icon: 'users', label: 'Find referral partners for my business', prompt: 'Find referral partners for my business' },
      { icon: 'search', label: 'Find 20 interior designers in Camas, WA and save them to a Referral Partners folder', prompt: 'Find 20 interior designers in Camas, WA and save them to a Referral Partners folder' },
      { icon: 'bookmark', label: 'Show my bookmarked leads', prompt: 'Show my bookmarked leads' },
      { icon: 'today', label: 'What should I work on today?', prompt: 'What should I work on today?' },
      { icon: 'task', label: 'Create a task to call back … tomorrow', prefill: 'Create a task to call back  tomorrow', caret: 29 },
      { icon: 'tag', label: 'Tag the top 10 plumbers as Hot', prompt: 'Tag the top 10 plumbers as Hot' },
      { icon: 'sync', label: 'Sync my bookmarked leads to GHL', prompt: 'Sync my bookmarked leads to GHL' },
      { icon: 'script', label: 'Write an opening script for property managers', prompt: 'Write an opening script for property managers' },
    ],
    identityPrompt: `You are Alex, the AI receptionist and sales assistant. You have access to this user's CRM via MCP tools. Your name is Alex; if memory or earlier messages call you Pavlex, that was your old name — always introduce yourself as Alex.

Tone: direct, pragmatic, concise. You are the default teammate for CRM work.`,
  },
  {
    id: 'grokbot',
    name: 'Grokbot',
    title: 'Outreach & research specialist',
    blurb: 'Sharp copy, candid research, and fast lead intel — powered by Grok via OpenRouter.',
    greeting: "I'm Grokbot.",
    emptyLead: 'Research leads, roast weak copy, and draft outreach that sounds human',
    placeholder: 'Message Grokbot… or tap the mic',
    color: '#0ea5e9',
    avatarKind: 'grok',
    // Prefer Grok on OpenRouter; falls back to the normal tool-capable chain if unavailable.
    preferredOpenRouterModels: ['x-ai/grok-4', 'x-ai/grok-4-fast', 'x-ai/grok-3-mini'],
    suggestions: [
      { icon: 'script', label: 'Rewrite this opener so it does not sound like AI', prompt: 'Rewrite a cold SMS opener for a local contractor that does not sound like AI. Keep it under 320 characters and use {{name}} / {{company}}.' },
      { icon: 'search', label: 'Research this business before I call', prompt: 'Research the open lead (or ask which one) and give me a 5-bullet call brief: what they do, likely pain, angle, risk flags, and first question.' },
      { icon: 'users', label: 'Find referral partners and explain why each trade fits', prompt: 'Find referral partners for my business and explain in one line why each trade would send me work.' },
      { icon: 'today', label: 'Who should I call first and why?', prompt: 'Who should I call first today and why? Be blunt.' },
      { icon: 'tag', label: 'Score these leads and tag the winners', prompt: 'Score the leads I have open or selected and tag the strongest ones Hot.' },
      { icon: 'bookmark', label: 'Pick the best bookmarked leads to work', prompt: 'Show my bookmarked leads and pick the top 5 worth calling first with a one-line reason each.' },
      { icon: 'task', label: 'Draft a follow-up SMS after a no-answer', prompt: 'Draft a short no-answer follow-up SMS for the current lead. Keep it human and under 320 characters.' },
      { icon: 'sync', label: 'Push my hottest leads to GHL', prompt: 'Sync my Hot-tagged or bookmarked leads to GHL.' },
    ],
    identityPrompt: `You are Grokbot, a specialized employee on this AdHello workspace — outreach, research, and candid coaching. You still have the same CRM MCP tools as Alex and must use them for leads, folders, scripts, tasks, and pipeline work.

Personality: witty, blunt when useful, never cruel to the user's customers. Prefer short punchy answers, strong first lines, and concrete next steps. Introduce yourself as Grokbot (not Alex, not Grok the consumer app).

Specialties: cold outreach copy that sounds human, pre-call research briefs, ranking who to call, and calling out weak scripts. You are not the default receptionist — if they need a calm CRM walkthrough, still help, but stay in character.`,
  },
];

const EMPLOYEE_BY_ID = Object.fromEntries(EMPLOYEES.map((e) => [e.id, e]));

function normalizeEmployeeId(raw) {
  const id = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '');
  if (id === 'grok' || id === 'grok-bot') return 'grokbot';
  if (EMPLOYEE_BY_ID[id]) return id;
  return DEFAULT_EMPLOYEE_ID;
}

function getEmployee(id) {
  return EMPLOYEE_BY_ID[normalizeEmployeeId(id)];
}

function listEmployees() {
  return EMPLOYEES.map((e) => publicEmployee(e));
}

function publicEmployee(e) {
  return {
    id: e.id,
    name: e.name,
    title: e.title,
    blurb: e.blurb,
    greeting: e.greeting,
    emptyLead: e.emptyLead,
    placeholder: e.placeholder,
    color: e.color,
    avatarKind: e.avatarKind,
    suggestions: e.suggestions,
    preferredOpenRouterModels: [...(e.preferredOpenRouterModels || [])],
  };
}

function employeeForClient(id) {
  return publicEmployee(getEmployee(id));
}

module.exports = {
  DEFAULT_EMPLOYEE_ID,
  EMPLOYEES,
  EMPLOYEE_BY_ID,
  normalizeEmployeeId,
  getEmployee,
  listEmployees,
  employeeForClient,
  publicEmployee,
};
