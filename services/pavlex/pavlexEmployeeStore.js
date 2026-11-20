/**
 * Workspace-owned custom chat employees (Grokbots / specialists).
 * Stored in KV so owners can add bots without a deploy.
 */
const dbService = require('../database');
const { normalizeEmployeeId, DEFAULT_EMPLOYEE_ID } = require('./pavlexEmployeesCore');

const MAX_CUSTOM = 40;

function storeKey(workspaceId) {
  return `pavlexemployees:${String(workspaceId || '').trim()}`;
}

function readList(workspaceId) {
  const wid = String(workspaceId || '').trim();
  if (!wid) return [];
  const raw = typeof dbService.getKvSync === 'function' ? dbService.getKvSync(storeKey(wid)) : null;
  if (!raw) return [];
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const items = Array.isArray(parsed) ? parsed : parsed && Array.isArray(parsed.items) ? parsed.items : [];
    return items.filter((e) => e && typeof e.id === 'string');
  } catch {
    return [];
  }
}

function writeList(workspaceId, items) {
  const wid = String(workspaceId || '').trim();
  if (!wid || typeof dbService.setKvSync !== 'function') return;
  dbService.setKvSync(storeKey(wid), JSON.stringify({ v: 1, items }));
}

function sanitizeEmployee(input, { allowBuiltInIds = false } = {}) {
  const raw = input && typeof input === 'object' ? input : {};
  let id = normalizeEmployeeId(raw.id || raw.name);
  if (!id || id === DEFAULT_EMPLOYEE_ID) {
    id = String(raw.id || raw.name || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40);
  }
  if (!id) {
    const err = new Error('Employee id is required.');
    err.status = 400;
    throw err;
  }
  if (!allowBuiltInIds && (id === 'alex' || id === 'grokbot')) {
    const err = new Error('Choose a different id — alex and grokbot are reserved.');
    err.status = 400;
    throw err;
  }
  const name = String(raw.name || '').trim().slice(0, 60);
  if (!name) {
    const err = new Error('Employee name is required.');
    err.status = 400;
    throw err;
  }
  const family = String(raw.family || '').trim().toLowerCase() === 'grok' ? 'grok' : 'default';
  const suggestions = Array.isArray(raw.suggestions)
    ? raw.suggestions
        .filter((s) => s && (s.prompt || s.prefill) && s.label)
        .slice(0, 12)
        .map((s) => ({
          icon: String(s.icon || 'script').slice(0, 24),
          label: String(s.label).slice(0, 120),
          prompt: s.prompt ? String(s.prompt).slice(0, 600) : undefined,
          prefill: s.prefill ? String(s.prefill).slice(0, 600) : undefined,
          caret: Number.isFinite(Number(s.caret)) ? Number(s.caret) : undefined,
        }))
    : [];
  const preferredOpenRouterModels = Array.isArray(raw.preferredOpenRouterModels)
    ? raw.preferredOpenRouterModels.map((m) => String(m || '').trim()).filter(Boolean).slice(0, 6)
    : family === 'grok'
      ? ['x-ai/grok-4', 'x-ai/grok-4-fast', 'x-ai/grok-3-mini']
      : [];
  const preferredXaiModels = Array.isArray(raw.preferredXaiModels)
    ? raw.preferredXaiModels.map((m) => String(m || '').trim()).filter(Boolean).slice(0, 6)
    : family === 'grok'
      ? ['grok-4', 'grok-3-mini']
      : [];

  return {
    id,
    name,
    title: String(raw.title || 'Specialist').trim().slice(0, 80) || 'Specialist',
    blurb: String(raw.blurb || '').trim().slice(0, 240),
    greeting: String(raw.greeting || `I'm ${name}.`).trim().slice(0, 80),
    emptyLead: String(raw.emptyLead || raw.blurb || 'Help with CRM work').trim().slice(0, 160),
    placeholder: String(raw.placeholder || `Message ${name}…`).trim().slice(0, 80),
    color: String(raw.color || (family === 'grok' ? '#0ea5e9' : '#111827')).trim().slice(0, 32),
    avatarKind: family === 'grok' || String(raw.avatarKind || '') === 'grok' ? 'grok' : 'alex',
    family,
    preferredOpenRouterModels,
    preferredXaiModels,
    suggestions,
    identityPrompt: String(raw.identityPrompt || raw.prompt || '')
      .trim()
      .slice(0, 4000) ||
      `You are ${name}, a specialized AdHello chat employee. Use CRM MCP tools for leads and pipeline work.`,
    source: 'workspace',
    updatedAt: new Date().toISOString(),
  };
}

function listWorkspaceEmployees(workspaceId) {
  return readList(workspaceId).map((e) => ({ ...e, source: 'workspace' }));
}

function upsertWorkspaceEmployee(workspaceId, input) {
  const emp = sanitizeEmployee(input);
  const items = readList(workspaceId);
  const idx = items.findIndex((e) => e.id === emp.id);
  if (idx >= 0) items[idx] = emp;
  else {
    if (items.length >= MAX_CUSTOM) {
      const err = new Error(`You can keep up to ${MAX_CUSTOM} custom employees.`);
      err.status = 400;
      throw err;
    }
    items.push(emp);
  }
  writeList(workspaceId, items);
  return emp;
}

function deleteWorkspaceEmployee(workspaceId, employeeId) {
  const id = String(employeeId || '').trim().toLowerCase();
  const items = readList(workspaceId);
  const next = items.filter((e) => e.id !== id);
  if (next.length === items.length) return false;
  writeList(workspaceId, next);
  return true;
}

module.exports = {
  MAX_CUSTOM,
  listWorkspaceEmployees,
  upsertWorkspaceEmployee,
  deleteWorkspaceEmployee,
  sanitizeEmployee,
};
