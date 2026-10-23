/**
 * SOP (standard operating procedure) tools for MCP clients and in-app Alex.
 */
const { z } = require('zod/v3');
const { zodToJsonSchema } = require('zod-to-json-schema');
const dbService = require('../database');
const workspaceService = require('../workspaceService');
const sopsService = require('../sops');
const notify = require('../networkNotify');

function toolError(message, code = 'SOPS_ERROR') {
  const err = new Error(message);
  err.code = code;
  return err;
}

function pageUrl(ctx, id) {
  const base = (ctx && ctx.baseUrl) || notify.baseUrlFromReq(null) || '';
  const root = `${String(base).replace(/\/+$/, '')}/sops`;
  return id ? `${root}/${encodeURIComponent(id)}` : root;
}

async function requireEditor(ctx) {
  if (ctx && (ctx.canManage === true || ctx.canAssignWork === true)) return;
  const ws = await dbService.getWorkspace(ctx.workspaceId);
  const role = workspaceService.roleForEmail(ws, ctx.userEmail || '');
  if (role === 'viewer') {
    throw toolError('Viewers can\'t edit SOPs. Ask an owner, admin, or manager.', 'FORBIDDEN');
  }
}

function presentSop(sop, { full = false } = {}) {
  if (!sop) return null;
  const base = {
    id: sop.id,
    title: sop.title || '',
    purpose: sop.purpose || '',
    owner: sop.owner || '',
    trigger: sop.trigger || '',
    success_measure: sop.successMeasure || '',
    builtin: !!sop.builtin,
    updated_at: sop.updatedAt || null,
  };
  if (!full) {
    return {
      ...base,
      steps_count: Array.isArray(sop.steps) ? sop.steps.length : 0,
    };
  }
  return {
    ...base,
    steps: Array.isArray(sop.steps) ? sop.steps : [],
    related_paths: Array.isArray(sop.relatedPaths) ? sop.relatedPaths : [],
  };
}

async function listSops(ctx) {
  const all = await sopsService.listSopsForWorkspace(ctx.workspaceId);
  const sops = sopsService.visibleSops(all).map((s) => presentSop(s));
  return { count: sops.length, sops, sops_page: pageUrl(ctx) };
}

async function getSop(ctx, input) {
  const sop = await sopsService.getSopForWorkspace(ctx.workspaceId, input.sop_id);
  if (!sop || sop.deleted) throw toolError('SOP not found.', 'NOT_FOUND');
  return { sop: presentSop(sop, { full: true }), sop_page: pageUrl(ctx, sop.id) };
}

async function saveSop(ctx, input) {
  await requireEditor(ctx);
  const fields = {
    title: input.title,
    purpose: input.purpose,
    owner: input.owner,
    trigger: input.trigger,
    successMeasure: input.success_measure,
    steps: input.steps,
    relatedPaths: (input.related_paths || []).map((p) => ({
      label: p.label,
      href: p.href,
    })),
  };
  const by = ctx.userEmail || 'AI assistant';
  let sop;
  if (input.sop_id) {
    sop = await sopsService.updateSop(ctx.workspaceId, input.sop_id, fields, by);
  } else {
    if (!String(input.title || '').trim()) throw toolError('title is required when creating a SOP.', 'INVALID_ARGUMENTS');
    sop = await sopsService.createSop(ctx.workspaceId, fields, by);
  }
  return {
    message: input.sop_id ? `Updated SOP "${sop.title}".` : `Created SOP "${sop.title}".`,
    sop: presentSop(sop, { full: true }),
    sop_page: pageUrl(ctx, sop.id),
  };
}

async function deleteSop(ctx, input) {
  await requireEditor(ctx);
  if (input.confirm !== true) {
    throw toolError('Pass confirm:true to delete a SOP.', 'CONFIRM_REQUIRED');
  }
  const prev = await sopsService.getSopForWorkspace(ctx.workspaceId, input.sop_id);
  if (!prev || prev.deleted) throw toolError('SOP not found.', 'NOT_FOUND');
  await sopsService.deleteSop(ctx.workspaceId, input.sop_id);
  return { message: `Deleted SOP "${prev.title}".`, sop_id: input.sop_id, sops_page: pageUrl(ctx) };
}

const RELATED = z.object({
  label: z.string().min(1).max(80),
  href: z.string().min(1).max(500).describe('App path (/leads) or https URL.'),
});

const SOP_TOOLS = [
  {
    name: 'list_sops',
    description: 'List workspace SOPs (standard operating procedures), including built-in seeds.',
    schema: z.object({}),
    run: listSops,
  },
  {
    name: 'get_sop',
    description: 'Get one SOP with full steps and related app links.',
    schema: z.object({ sop_id: z.string().min(1) }),
    run: getSop,
  },
  {
    name: 'save_sop',
    description:
      'Create a SOP, or update an existing one when sop_id is set. Pass steps as an array of strings. Viewers cannot edit.',
    schema: z.object({
      sop_id: z.string().optional().describe('Existing SOP id to update; omit to create.'),
      title: z.string().max(160).optional(),
      purpose: z.string().max(500).optional(),
      owner: z.string().max(120).optional().describe('Role that owns the process, e.g. SDR.'),
      trigger: z.string().max(300).optional(),
      success_measure: z.string().max(300).optional(),
      steps: z.array(z.string().min(1).max(500)).max(40).optional(),
      related_paths: z.array(RELATED).max(12).optional(),
    }),
    run: saveSop,
  },
  {
    name: 'delete_sop',
    description: 'Delete a SOP (built-ins become hidden tombstones). Requires confirm:true.',
    schema: z.object({
      sop_id: z.string().min(1),
      confirm: z.boolean().describe('Must be true.'),
    }),
    run: deleteSop,
  },
];

const BY_NAME = Object.fromEntries(SOP_TOOLS.map((t) => [t.name, t]));
const SOP_TOOL_NAMES = SOP_TOOLS.map((t) => t.name);

async function executeSopTool(ctx, name, input) {
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
  return SOP_TOOLS.map((tool) => {
    const { $schema, ...parameters } = zodToJsonSchema(tool.schema, { target: 'openApi3' });
    return { type: 'function', function: { name: tool.name, description: tool.description, parameters } };
  });
}

module.exports = {
  SOP_TOOLS,
  SOP_TOOL_NAMES,
  READ_ONLY_SOP_TOOLS: ['list_sops', 'get_sop'],
  DESTRUCTIVE_SOP_TOOLS: ['delete_sop'],
  executeSopTool,
  openAiFunctionTools,
};
