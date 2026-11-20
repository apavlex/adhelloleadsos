/**
 * In-app chat employees — multiple AI personas that share CRM tools.
 * Sources (later wins on same id): built-ins → chat-employees/*.json → workspace customs.
 */

const fs = require('fs');
const path = require('path');
const { DEFAULT_EMPLOYEE_ID, normalizeEmployeeId } = require('./pavlexEmployeesCore');

const BUILTIN_EMPLOYEES = [
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
    family: 'default',
    preferredOpenRouterModels: [],
    preferredXaiModels: [],
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
    source: 'builtin',
  },
  {
    id: 'grokbot',
    name: 'Grokbot',
    title: 'Outreach & research specialist',
    blurb: 'Sharp copy, candid research, and fast lead intel — powered by Grok (xAI or OpenRouter).',
    greeting: "I'm Grokbot.",
    emptyLead: 'Research leads, roast weak copy, and draft outreach that sounds human',
    placeholder: 'Message Grokbot… or tap the mic',
    color: '#0ea5e9',
    avatarKind: 'grok',
    family: 'grok',
    preferredOpenRouterModels: ['x-ai/grok-4', 'x-ai/grok-4-fast', 'x-ai/grok-3-mini'],
    preferredXaiModels: ['grok-4', 'grok-3-mini'],
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
    source: 'builtin',
  },
];

const DIR_CANDIDATES = [
  path.join(process.cwd(), 'chat-employees'),
  path.join(__dirname, '..', '..', 'chat-employees'),
];

function coerceEmployee(raw, source) {
  if (!raw || typeof raw !== 'object') return null;
  const id = normalizeEmployeeId(raw.id);
  if (!id) return null;
  const name = String(raw.name || '').trim();
  if (!name) return null;
  const family =
    String(raw.family || '').trim().toLowerCase() === 'grok' ||
    String(raw.avatarKind || '').trim() === 'grok' ||
    id === 'grokbot' ||
    id.includes('grok')
      ? 'grok'
      : 'default';
  return {
    id,
    name,
    title: String(raw.title || 'Specialist').trim().slice(0, 80),
    blurb: String(raw.blurb || '').trim().slice(0, 240),
    greeting: String(raw.greeting || `I'm ${name}.`).trim().slice(0, 80),
    emptyLead: String(raw.emptyLead || raw.blurb || 'Help with CRM work').trim().slice(0, 160),
    placeholder: String(raw.placeholder || `Message ${name}…`).trim().slice(0, 80),
    color: String(raw.color || (family === 'grok' ? '#0ea5e9' : '#111827')).trim().slice(0, 32),
    avatarKind: family === 'grok' ? 'grok' : String(raw.avatarKind || 'alex') === 'grok' ? 'grok' : 'alex',
    family,
    preferredOpenRouterModels: Array.isArray(raw.preferredOpenRouterModels)
      ? raw.preferredOpenRouterModels.map((m) => String(m || '').trim()).filter(Boolean)
      : family === 'grok'
        ? ['x-ai/grok-4', 'x-ai/grok-4-fast', 'x-ai/grok-3-mini']
        : [],
    preferredXaiModels: Array.isArray(raw.preferredXaiModels)
      ? raw.preferredXaiModels.map((m) => String(m || '').trim()).filter(Boolean)
      : family === 'grok'
        ? ['grok-4', 'grok-3-mini']
        : [],
    suggestions: Array.isArray(raw.suggestions) ? raw.suggestions : [],
    identityPrompt: String(raw.identityPrompt || '').trim(),
    source,
  };
}

function loadDirectoryEmployees() {
  const out = [];
  for (const dir of DIR_CANDIDATES) {
    let names;
    try {
      names = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!/\.json$/i.test(name) || name.startsWith('.')) continue;
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
        const emp = coerceEmployee(raw, 'directory');
        if (emp && emp.identityPrompt) out.push(emp);
      } catch (err) {
        console.warn('[pavlexEmployees] skip', name, err && err.message);
      }
    }
    if (out.length) break;
  }
  return out;
}

let cachedDirectory = null;

function directoryEmployees() {
  if (!cachedDirectory) cachedDirectory = loadDirectoryEmployees();
  return cachedDirectory;
}

function mergeEmployees(workspaceId) {
  const byId = new Map();
  for (const e of BUILTIN_EMPLOYEES) byId.set(e.id, e);
  for (const e of directoryEmployees()) byId.set(e.id, e);
  if (workspaceId) {
    try {
      const store = require('./pavlexEmployeeStore');
      for (const e of store.listWorkspaceEmployees(workspaceId)) {
        const coerced = coerceEmployee(e, 'workspace');
        if (coerced && coerced.identityPrompt) byId.set(coerced.id, coerced);
      }
    } catch (_) {
      /* store optional during early boot */
    }
  }
  return [...byId.values()];
}

function resolveEmployeeId(raw, workspaceId) {
  const id = normalizeEmployeeId(raw);
  const list = mergeEmployees(workspaceId);
  if (list.some((e) => e.id === id)) return id;
  return DEFAULT_EMPLOYEE_ID;
}

function getEmployee(id, workspaceId) {
  const resolved = resolveEmployeeId(id, workspaceId);
  return mergeEmployees(workspaceId).find((e) => e.id === resolved) || BUILTIN_EMPLOYEES[0];
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
    family: e.family || 'default',
    source: e.source || 'builtin',
    suggestions: e.suggestions || [],
    preferredOpenRouterModels: [...(e.preferredOpenRouterModels || [])],
    preferredXaiModels: [...(e.preferredXaiModels || [])],
  };
}

function listEmployees(workspaceId) {
  return mergeEmployees(workspaceId).map(publicEmployee);
}

function employeeForClient(id, workspaceId) {
  return publicEmployee(getEmployee(id, workspaceId));
}

/** @deprecated use listEmployees — kept for older imports */
const EMPLOYEES = BUILTIN_EMPLOYEES;
const EMPLOYEE_BY_ID = Object.fromEntries(BUILTIN_EMPLOYEES.map((e) => [e.id, e]));

module.exports = {
  DEFAULT_EMPLOYEE_ID,
  EMPLOYEES,
  EMPLOYEE_BY_ID,
  BUILTIN_EMPLOYEES,
  normalizeEmployeeId,
  resolveEmployeeId,
  getEmployee,
  listEmployees,
  employeeForClient,
  publicEmployee,
  directoryEmployees,
  mergeEmployees,
};
