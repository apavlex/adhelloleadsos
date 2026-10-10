/**
 * Ops agents (Prospect SDR, Opportunity SDR, Dispatcher, Ops bot) for MCP clients
 * and the in-app chat: list status, read insights, run a role, and change settings.
 */
const { z } = require('zod/v3');
const { zodToJsonSchema } = require('zod-to-json-schema');
const dbService = require('../database');
const workspaceService = require('../workspaceService');
const agentOps = require('../agentOps');
const { ROLE_BY_ID, normalizeRoleId, JOB_LABELS } = require('../agentOps/roles');

function toolError(message, code = 'OPS_AGENT_ERROR') {
  const err = new Error(message);
  err.code = code;
  return err;
}

async function requireManager(ctx, what) {
  if (ctx && ctx.canManage === true) return;
  const ws = await dbService.getWorkspace(ctx.workspaceId);
  if (!ws) throw toolError('Workspace not found.', 'NOT_FOUND');
  const role = workspaceService.roleForEmail(ws, ctx.userEmail || '');
  if (!workspaceService.canManageTeam(role)) {
    throw toolError(`Only workspace owners and admins can ${what}.`, 'FORBIDDEN');
  }
}

function resolveRole(ref) {
  const raw = String(ref || '').trim();
  if (!raw) throw toolError('Say which Ops agent (prospect, opportunity, dispatcher, or ops).', 'AGENT_REQUIRED');
  const id = normalizeRoleId(raw.toLowerCase().replace(/\s+/g, '_'));
  if (ROLE_BY_ID[id]) return ROLE_BY_ID[id];

  const q = raw.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const aliases = {
    prospect: ['prospect', 'prospect sdr', 'focus', 'focus sdr', 'sdr'],
    opportunity: ['opportunity', 'opportunity sdr', 'review', 'review bot', 'review sdr'],
    dispatcher: ['dispatcher', 'dispatch'],
    ops: ['ops', 'ops bot', 'health', 'ops health'],
  };
  for (const [roleId, names] of Object.entries(aliases)) {
    if (names.some((n) => n === q || q.includes(n) || n.includes(q))) {
      return ROLE_BY_ID[roleId];
    }
  }
  const titles = agentOps.listRoles().map((r) => r.title).join(', ');
  throw toolError(`No Ops agent matches "${raw}". Agents: ${titles}.`, 'AGENT_UNKNOWN');
}

function presentAgent(roleCard) {
  const insight = roleCard.insight || null;
  const items = Array.isArray(roleCard.items) ? roleCard.items.slice(0, 12) : [];
  return {
    id: roleCard.id,
    name: roleCard.title,
    blurb: roleCard.blurb,
    enabled: roleCard.enabled !== false,
    auto_tick: roleCard.autoTick !== false,
    running: !!roleCard.running,
    running_since: roleCard.runningStartedAt || null,
    last_tick_at: roleCard.lastTickAt || null,
    default_job: roleCard.defaultJob,
    job_label: roleCard.jobLabel || JOB_LABELS[roleCard.defaultJob] || roleCard.defaultJob,
    insight: insight
      ? {
          title: insight.title || '',
          body: insight.body || '',
          severity: insight.severity || 'info',
          href: insight.href || null,
          at: insight.at || null,
          counts: insight.counts || {},
        }
      : null,
    top_items: items.map((it) => ({
      kind: it.kind || 'lead',
      id: it.id || null,
      title: it.title || '',
      subtitle: it.subtitle || '',
      href: it.href || null,
      badge: it.badge || null,
    })),
    last_run: roleCard.lastRun
      ? {
          status: roleCard.lastRun.status || '',
          summary: roleCard.lastRun.summary || '',
          at: roleCard.lastRun.at || roleCard.lastRun.finishedAt || null,
          error: roleCard.lastRun.error || null,
        }
      : null,
  };
}

async function listOpsAgents(ctx) {
  const dash = agentOps.dashboardForWorkspace(ctx.workspaceId);
  const agents = (dash.roles || []).map(presentAgent);
  return {
    ops_enabled: dash.enabled !== false,
    last_tick_at: dash.lastTickAt || null,
    running: (dash.runningRoles || []).map((r) => ({ id: r.id, name: r.title })),
    count: agents.length,
    agents,
    note:
      'Ops agents auto-run about hourly. Use run_ops_agent to run one now, or update_ops_agent to enable/disable or turn auto-tick on/off.',
  };
}

async function getOpsAgent(ctx, input) {
  const role = resolveRole(input.agent);
  const dash = agentOps.dashboardForWorkspace(ctx.workspaceId);
  const card = (dash.roles || []).find((r) => r.id === role.id);
  if (!card) throw toolError(`Ops agent "${role.title}" is not available.`, 'NOT_FOUND');

  const limit = Math.min(20, Math.max(1, Number(input.limit) || 8));
  const runs = agentOps
    .listRecentRuns(ctx.workspaceId, 40)
    .filter((r) => r.roleId === role.id)
    .slice(0, limit);
  const insights = agentOps
    .listInsights(ctx.workspaceId, 24)
    .filter((i) => i.roleId === role.id)
    .slice(0, limit);

  return {
    ops_enabled: dash.enabled !== false,
    agent: presentAgent(card),
    recent_runs: runs.map((r) => ({
      status: r.status || '',
      type: r.type || '',
      summary: r.summary || '',
      at: r.at || r.finishedAt || null,
      error: r.error || null,
      counts: r.counts || {},
    })),
    recent_insights: insights.map((i) => ({
      title: i.title || '',
      body: i.body || '',
      severity: i.severity || 'info',
      href: i.href || null,
      at: i.at || null,
      counts: i.counts || {},
    })),
  };
}

async function runOpsAgent(ctx, input) {
  await requireManager(ctx, 'run Ops agents');
  const role = resolveRole(input.agent);
  const settings = agentOps.getSettings(ctx.workspaceId);
  if (settings.enabled === false) {
    throw toolError('Ops agents are disabled for this workspace. Enable them with update_ops_agent.', 'DISABLED');
  }
  const roleCfg = settings.roles[role.id] || {};
  if (roleCfg.enabled === false) {
    throw toolError(`${role.title} is disabled. Enable it with update_ops_agent first.`, 'ROLE_DISABLED');
  }

  const email = String((ctx && ctx.userEmail) || '').trim().toLowerCase();
  const out = await agentOps.enqueueAndRun(ctx.workspaceId, role.defaultJob, {
    onBehalfOf: email,
    triggeredBy: email || 'mcp',
    force: input.force !== false,
  });

  if (!out.ok) {
    throw toolError(out.error || `${role.title} failed to run.`, 'RUN_FAILED');
  }

  const result = out.result || {};
  return {
    message: result.summary || `${role.title} finished.`,
    agent: {
      id: role.id,
      name: role.title,
    },
    job: out.job
      ? {
          id: out.job.id,
          type: out.job.type,
          status: out.job.status,
        }
      : null,
    skipped: !!result.skipped,
    reason: result.reason || null,
    summary: result.summary || '',
    counts: result.counts || {},
    top_items: Array.isArray(result.items)
      ? result.items.slice(0, 12).map((it) => ({
          kind: it.kind || 'lead',
          id: it.id || null,
          title: it.title || '',
          subtitle: it.subtitle || '',
          href: it.href || null,
          badge: it.badge || null,
        }))
      : [],
  };
}

async function updateOpsAgent(ctx, input) {
  await requireManager(ctx, 'change Ops agent settings');
  const patch = {};

  if (typeof input.ops_enabled === 'boolean') {
    patch.enabled = input.ops_enabled;
  }

  if (input.agent) {
    const role = resolveRole(input.agent);
    const rolePatch = {};
    if (typeof input.enabled === 'boolean') rolePatch.enabled = input.enabled;
    if (typeof input.auto_tick === 'boolean') rolePatch.autoTick = input.auto_tick;
    if (!Object.keys(rolePatch).length) {
      throw toolError('Set enabled and/or auto_tick for that agent.', 'INVALID_ARGUMENTS');
    }
    patch.roles = { [role.id]: rolePatch };
  } else if (typeof input.ops_enabled !== 'boolean') {
    throw toolError('Pass agent (and enabled/auto_tick), or ops_enabled for all Ops agents.', 'INVALID_ARGUMENTS');
  }

  const settings = agentOps.saveSettings(ctx.workspaceId, patch);
  const dash = agentOps.dashboardForWorkspace(ctx.workspaceId);
  const agents = (dash.roles || []).map(presentAgent);

  return {
    message: 'Ops agent settings updated.',
    ops_enabled: settings.enabled !== false,
    agents,
  };
}

const AGENT_OPS_TOOLS = [
  {
    name: 'list_ops_agents',
    description:
      'List AdHello Ops agents (Prospect SDR, Opportunity SDR, Dispatcher, Ops bot): on/off, auto-tick, running state, last insight, and top recommended leads/tasks. ' +
      'Use this when the user asks what the Ops bots are doing or whether they are healthy.',
    schema: z.object({}),
    run: listOpsAgents,
  },
  {
    name: 'get_ops_agent',
    description:
      'Get one Ops agent in detail: current insight, top items, recent runs, and recent insights. ' +
      'Agents: prospect (Prospect SDR), opportunity (Opportunity SDR), dispatcher, ops (Ops bot).',
    schema: z.object({
      agent: z
        .string()
        .min(1)
        .describe('Agent id or name: prospect, opportunity, dispatcher, ops (or "Prospect SDR", "Opportunity SDR").'),
      limit: z.number().int().min(1).max(20).optional().describe('How many recent runs/insights to return (default 8).'),
    }),
    run: getOpsAgent,
  },
  {
    name: 'run_ops_agent',
    description:
      'Run one Ops agent now (same as Run on Today → Ops agents). Owners/admins only. ' +
      'Prospect SDR preps the home-service Portland–Vancouver call queue; Opportunity SDR ranks open deals (skips SMS STOP / DNC); ' +
      'Dispatcher scans the referral/appointment pool; Ops bot checks GHL sync and messaging health.',
    schema: z.object({
      agent: z.string().min(1).describe('Agent id or name to run.'),
      force: z
        .boolean()
        .optional()
        .describe('For Opportunity SDR, force a fresh board scan even if one ran recently (default true).'),
    }),
    run: runOpsAgent,
  },
  {
    name: 'update_ops_agent',
    description:
      'Change Ops agent settings: turn all Ops agents on/off (ops_enabled), or enable/disable one agent and its hourly auto-tick. Owners/admins only.',
    schema: z.object({
      agent: z
        .string()
        .optional()
        .describe('Agent id or name when changing one role. Omit when only setting ops_enabled.'),
      enabled: z.boolean().optional().describe('Enable or disable this agent (requires agent).'),
      auto_tick: z
        .boolean()
        .optional()
        .describe('Whether this agent auto-runs about hourly (requires agent).'),
      ops_enabled: z.boolean().optional().describe('Master switch for all Ops agents in this workspace.'),
    }),
    run: updateOpsAgent,
  },
];

const BY_NAME = Object.fromEntries(AGENT_OPS_TOOLS.map((t) => [t.name, t]));
const AGENT_OPS_TOOL_NAMES = AGENT_OPS_TOOLS.map((t) => t.name);

async function executeAgentOpsTool(ctx, name, input) {
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
  return AGENT_OPS_TOOLS.map((tool) => {
    const { $schema, ...parameters } = zodToJsonSchema(tool.schema, { target: 'openApi3' });
    return { type: 'function', function: { name: tool.name, description: tool.description, parameters } };
  });
}

module.exports = {
  AGENT_OPS_TOOLS,
  AGENT_OPS_TOOL_NAMES,
  READ_ONLY_AGENT_OPS_TOOLS: ['list_ops_agents', 'get_ops_agent'],
  executeAgentOpsTool,
  openAiFunctionTools,
  resolveRole,
  listOpsAgents,
  getOpsAgent,
  runOpsAgent,
  updateOpsAgent,
};
