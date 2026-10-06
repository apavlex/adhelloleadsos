/**
 * Custom GHL cadence tools for MCP clients and the in-app chat: list, draft-and-save, and the
 * GHL workflow setup prompt. Launching and stopping are launch_cadence / stop_cadence in mcpProspecting.
 */
const { z } = require('zod/v3');
const { zodToJsonSchema } = require('zod-to-json-schema');
const dbService = require('../database');
const workspaceService = require('../workspaceService');
const notify = require('../networkNotify');
const cc = require('../customCadences');

const CHANNEL_KEYS = Object.keys(cc.CHANNELS);
const TOKEN_LIST = Object.keys(cc.MERGE_TOKENS).map((t) => `{{${t}}}`).join(', ');

function toolError(message, code = 'CADENCE_ERROR') {
  const err = new Error(message);
  err.code = code;
  return err;
}

function pageUrl(ctx) {
  const base = (ctx && ctx.baseUrl) || notify.baseUrlFromReq(null) || '';
  return `${String(base).replace(/\/+$/, '')}/sequences#custom-cadences`;
}

async function requireManager(ctx) {
  if (ctx && ctx.canManage === true) return;
  const ws = await dbService.getWorkspace(ctx.workspaceId);
  const role = workspaceService.roleForEmail(ws, ctx.userEmail || '');
  if (!workspaceService.canManageTeam(role)) {
    throw toolError('Only workspace owners and admins can create or edit cadences.', 'FORBIDDEN');
  }
}

function present(c, leadCount) {
  return {
    id: c.id,
    name: c.name,
    goal: c.goal,
    ghl_tag: cc.tagNameFor(c),
    ghl_workflow_ready: !!c.ghlSetupAt,
    leads_on_it: leadCount || 0,
    summary: cc.stepSummary(c),
    steps: c.steps.map((s) => ({
      day: s.dayOffset,
      channel: s.channel,
      ...(s.subject ? { subject: s.subject } : {}),
      message: s.message,
    })),
  };
}

function resolveCadence(ws, ref) {
  const list = cc.listCadences(ws);
  const wanted = String(ref || '').trim().toLowerCase();
  if (!wanted) throw toolError('Say which cadence (name or id).', 'CADENCE_REQUIRED');
  const hit =
    list.find((c) => c.id.toLowerCase() === wanted) ||
    list.find((c) => c.name.toLowerCase() === wanted) ||
    list.find((c) => cc.tagNameFor(c) === wanted) ||
    list.filter((c) => c.name.toLowerCase().includes(wanted));
  if (Array.isArray(hit)) {
    if (hit.length === 1) return hit[0];
    if (!hit.length) throw toolError(`No cadence matches "${ref}". Cadences: ${list.map((c) => c.name).join(', ') || 'none yet'}.`, 'NOT_FOUND');
    throw toolError(`"${ref}" matches several cadences: ${hit.map((c) => c.name).join(', ')}. Use the exact name.`, 'AMBIGUOUS');
  }
  return hit;
}

async function listCustomCadences(ctx) {
  const ws = await dbService.getWorkspace(ctx.workspaceId);
  const leads = await dbService.getAllLeads(ctx.workspaceId);
  const counts = {};
  for (const lead of leads || []) {
    const g = lead && lead.ghlCadence;
    if (g && g.status === 'active') counts[g.cadenceId] = (counts[g.cadenceId] || 0) + 1;
  }
  const cadences = cc.listCadences(ws).map((c) => present(c, counts[c.id]));
  return { count: cadences.length, cadences, cadences_page: pageUrl(ctx) };
}

async function saveCustomCadence(ctx, input) {
  await requireManager(ctx);
  const ws = await dbService.getWorkspace(ctx.workspaceId);
  const existing = input.cadence ? resolveCadence(ws, input.cadence) : null;
  const res = await cc.saveCadence(ctx.workspaceId, {
    id: existing ? existing.id : '',
    name: input.name || (existing && existing.name) || '',
    goal: input.goal != null ? input.goal : existing ? existing.goal : '',
    steps: input.steps.map((s) => ({ dayOffset: s.day, channel: s.channel, subject: s.subject || '', message: s.message })),
  });
  if (!res.ok) throw toolError(res.error, 'INVALID_CADENCE');
  const c = res.cadence;
  const needsGhl = !c.ghlSetupAt;
  return {
    message: `${existing ? 'Updated' : 'Saved'} "${c.name}" (${cc.stepSummary(c)}).`,
    cadence: present(c),
    next_steps: needsGhl
      ? `Open the Cadences page, copy the GHL workflow prompt for "${c.name}" and build that workflow in GHL (trigger: tag ${cc.tagNameFor(c)} added), then mark it ready. Then put leads on it with launch_cadence (or Pipeline: select leads → Launch cadence).`
      : 'GHL workflow is still marked ready because the steps did not change.',
    ...(existing && needsGhl && existing.ghlSetupAt ? { ghl_workflow_outdated: true } : {}),
    cadences_page: pageUrl(ctx),
  };
}

async function getCadenceGhlPrompt(ctx, input) {
  const ws = await dbService.getWorkspace(ctx.workspaceId);
  const c = resolveCadence(ws, input.cadence);
  return { cadence: c.name, ghl_tag: cc.tagNameFor(c), ghl_workflow_ready: !!c.ghlSetupAt, prompt: cc.buildGhlPrompt(c) };
}

const STEP = z.object({
  day: z.number().int().min(0).max(90).describe('Days after launch (0 = the day the lead is tagged).'),
  channel: z.enum(CHANNEL_KEYS).describe('sms, email, call (a call task for the rep) or voicemail (ringless voicemail drop).'),
  subject: z.string().max(160).optional().describe('Email subject; email steps only.'),
  message: z.string().min(1).max(1600).describe(`Message text, or talking points for call steps. Merge fields: ${TOKEN_LIST}.`),
});

const CADENCE_TOOLS = [
  {
    name: 'list_custom_cadences',
    description:
      'List this workspace\'s custom cadences (they run in GHL): name, goal, GHL tag, whether the GHL workflow is set up, how many leads are on it, and every step.',
    schema: z.object({}),
    run: listCustomCadences,
  },
  {
    name: 'save_custom_cadence',
    description:
      'Create a custom cadence, or replace an existing one\'s steps when `cadence` names it. Each cadence gets its own GHL tag; a GHL workflow on that tag sends the steps. ' +
      'Draft the steps in chat first and save only after the user approves them. SMS under 320 characters; 3–8 steps over 1–3 weeks is typical. Owners/admins only.',
    schema: z.object({
      cadence: z.string().optional().describe('Existing cadence name or id to update; omit to create a new one.'),
      name: z.string().max(60).optional().describe('Cadence name, e.g. "Territory seat invite". Required when creating.'),
      goal: z.string().max(160).optional().describe('One line, e.g. "Book a 15-minute call".'),
      steps: z.array(STEP).min(1).max(12),
    }),
    run: saveCustomCadence,
  },
  {
    name: 'get_cadence_ghl_prompt',
    description:
      'Get the GHL workflow setup prompt for a custom cadence (trigger tag, waits, each step, stop rules) to paste into GHL\'s workflow AI or follow by hand.',
    schema: z.object({ cadence: z.string().min(1).describe('Cadence name or id.') }),
    run: getCadenceGhlPrompt,
  },
];

const BY_NAME = Object.fromEntries(CADENCE_TOOLS.map((t) => [t.name, t]));
const CADENCE_TOOL_NAMES = CADENCE_TOOLS.map((t) => t.name);

async function executeCadenceTool(ctx, name, input) {
  const tool = BY_NAME[name];
  if (!tool) throw toolError(`Unknown tool: ${name}`, 'UNKNOWN_TOOL');
  const parsed = tool.schema.safeParse(input || {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw toolError(`${issue.path.join('.') || 'input'}: ${issue.message}`, 'INVALID_ARGUMENTS');
  }
  return tool.run(ctx, parsed.data);
}

function openAiFunctionTools() {
  return CADENCE_TOOLS.map((tool) => {
    const { $schema, ...parameters } = zodToJsonSchema(tool.schema, { target: 'openApi3' });
    return { type: 'function', function: { name: tool.name, description: tool.description, parameters } };
  });
}

module.exports = {
  resolveCadence,
  CADENCE_TOOLS,
  CADENCE_TOOL_NAMES,
  READ_ONLY_CADENCE_TOOLS: ['list_custom_cadences', 'get_cadence_ghl_prompt'],
  executeCadenceTool,
  openAiFunctionTools,
};
