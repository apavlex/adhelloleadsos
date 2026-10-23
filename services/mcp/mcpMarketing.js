/**
 * Marketing Studio (Direct Mail) tools for MCP clients and in-app Alex:
 * status, brand kit, playbooks, and the direct-mail lead queue.
 * Physical Lob sends and AI image generation stay in the Marketing Studio UI.
 */
const { z } = require('zod/v3');
const { zodToJsonSchema } = require('zod-to-json-schema');
const dbService = require('../database');
const workspaceService = require('../workspaceService');
const workspaceIntegrations = require('../workspaceIntegrations');
const lobDirectMail = require('../lobDirectMail');
const directMailQueue = require('../directMailQueue');
const {
  listPlaybooks,
  getPlaybookById,
  suggestPlaybookForLead,
  normalizeContext,
} = require('../directMailPlaybooks');
const { DM_PLATFORMS } = require('../dmPlatforms');
const brandKitLogo = require('../brandKitLogo');
const notify = require('../networkNotify');

function toolError(message, code = 'MARKETING_ERROR') {
  const err = new Error(message);
  err.code = code;
  return err;
}

function pageUrl(ctx) {
  const base = (ctx && ctx.baseUrl) || notify.baseUrlFromReq(null) || '';
  return `${String(base).replace(/\/+$/, '')}/direct-mail`;
}

async function requireEditor(ctx) {
  if (ctx && (ctx.canManage === true || ctx.canAssignWork === true)) return;
  const ws = await dbService.getWorkspace(ctx.workspaceId);
  const role = workspaceService.roleForEmail(ws, ctx.userEmail || '');
  if (role === 'viewer') {
    throw toolError('Viewers can\'t change Marketing Studio data.', 'FORBIDDEN');
  }
}

function normalizeBrandKit(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  return {
    business_name: String(src.businessName || '').trim().slice(0, 120),
    address: String(src.address || '').trim().slice(0, 240),
    phone: String(src.phone || '').trim().slice(0, 40),
    hours: String(src.hours || '').trim().slice(0, 240),
    website: String(src.website || '').trim().slice(0, 240),
    email: String(src.email || '').trim().slice(0, 120),
    logo_url: String(src.logoUrl || '').trim().slice(0, 500),
    use_logo_in_design: src.useLogoInDesign !== false,
    updated_at: String(src.updatedAt || '').trim() || null,
  };
}

function brandKitFromWorkspace(ws) {
  const kit = normalizeBrandKit(ws && ws.brandKit);
  if (brandKitLogo.hasStoredLogo(ws)) {
    const stored = brandKitLogo.normalizeStoredLogo(ws.brandKitLogo);
    kit.logo_url = brandKitLogo.logoDisplayUrl(kit.updated_at || (stored && stored.updatedAt));
    kit.has_logo = true;
  } else {
    kit.has_logo = Boolean(kit.logo_url);
  }
  return kit;
}

async function getMarketingStudioStatus(ctx) {
  const integrationEnv = await workspaceIntegrations.getResolvedIntegrationEnv(ctx.workspaceId);
  const ready = lobDirectMail.directMailReady(integrationEnv);
  const ws = (await dbService.getWorkspace(ctx.workspaceId)) || { id: ctx.workspaceId };
  return {
    lob_configured: !!ready.configured,
    lob_test_mode: !!ready.testMode,
    has_custom_postcard: !!ready.hasCustomPostcard,
    has_letter_pdf: !!ready.hasLetterPdf,
    brand_kit: brandKitFromWorkspace(ws),
    design_platforms: Object.entries(DM_PLATFORMS || {}).map(([id, p]) => ({
      id,
      label: (p && p.label) || id,
      aspect_ratio: (p && p.aspectRatio) || null,
    })),
    note:
      'Physical postcard/letter sends and AI image generation run in Marketing Studio UI (/direct-mail). Use queue tools to stage leads here.',
    marketing_studio_page: pageUrl(ctx),
  };
}

async function listDirectMailPlaybooks() {
  return { count: listPlaybooks().length, playbooks: listPlaybooks() };
}

async function getDirectMailPlaybook(_ctx, input) {
  const playbook = getPlaybookById(input.playbook_id);
  if (!playbook) throw toolError('Playbook not found.', 'NOT_FOUND');
  return { playbook };
}

async function suggestDirectMailPlaybook(ctx, input) {
  const lead = await dbService.getLead(input.lead_id, ctx.workspaceId);
  if (!lead) throw toolError('Lead not found.', 'NOT_FOUND');
  const context = normalizeContext(input.context);
  const result = suggestPlaybookForLead(lead, context);
  return {
    lead_id: lead.key,
    lead_title: lead.title || lead.company || '',
    context: context || null,
    playbook: result.playbook,
    alternatives: (result.alternatives || []).map(({ id, label, description }) => ({
      id,
      label,
      description,
    })),
  };
}

async function listDirectMailQueue(ctx, input) {
  const all = await dbService.getAllLeads(ctx.workspaceId);
  const queue = await directMailQueue.listDirectMailQueueLeads(ctx.workspaceId, all);
  const limit = Math.min(100, input.limit || 50);
  return {
    folder_key: queue.folderKey,
    folder_name: queue.folderName,
    tag_key: queue.tagKey,
    tag_name: queue.tagName,
    count: Math.min(queue.leads.length, limit),
    total: queue.leads.length,
    leads: queue.leads.slice(0, limit),
    marketing_studio_page: pageUrl(ctx),
  };
}

async function queueLeadsForDirectMail(ctx, input) {
  await requireEditor(ctx);
  const all = await dbService.getAllLeads(ctx.workspaceId);
  const result = await directMailQueue.addLeadsToDirectMailQueue(
    ctx.workspaceId,
    input.lead_ids,
    all,
  );
  return {
    message: `Queued ${result.added} lead(s) for direct mail (${result.skipped} skipped).`,
    added: result.added,
    skipped: result.skipped,
    folder_key: result.folderKey,
    tag_key: result.tagKey,
    leads: result.leads || [],
    marketing_studio_page: pageUrl(ctx),
  };
}

async function removeLeadsFromDirectMailQueue(ctx, input) {
  await requireEditor(ctx);
  const all = await dbService.getAllLeads(ctx.workspaceId);
  const result = await directMailQueue.removeLeadsFromDirectMailQueue(
    ctx.workspaceId,
    input.lead_ids,
    all,
  );
  return {
    message: `Removed ${result.removed || 0} lead(s) from the direct mail queue.`,
    ...result,
    marketing_studio_page: pageUrl(ctx),
  };
}

async function updateMarketingBrandKit(ctx, input) {
  await requireEditor(ctx);
  const ws = (await dbService.getWorkspace(ctx.workspaceId)) || { id: ctx.workspaceId };
  const prev = (ws.brandKit && typeof ws.brandKit === 'object' ? ws.brandKit : {}) || {};
  const next = {
    ...prev,
    businessName: input.business_name != null ? String(input.business_name).trim().slice(0, 120) : prev.businessName,
    address: input.address != null ? String(input.address).trim().slice(0, 240) : prev.address,
    phone: input.phone != null ? String(input.phone).trim().slice(0, 40) : prev.phone,
    hours: input.hours != null ? String(input.hours).trim().slice(0, 240) : prev.hours,
    website: input.website != null ? String(input.website).trim().slice(0, 240) : prev.website,
    email: input.email != null ? String(input.email).trim().slice(0, 120) : prev.email,
    useLogoInDesign:
      input.use_logo_in_design != null ? !!input.use_logo_in_design : prev.useLogoInDesign !== false,
    updatedAt: new Date().toISOString(),
  };
  await dbService.saveWorkspace(ctx.workspaceId, { ...ws, brandKit: next });
  const refreshed = await dbService.getWorkspace(ctx.workspaceId);
  return {
    message: 'Brand kit updated.',
    brand_kit: brandKitFromWorkspace(refreshed || { ...ws, brandKit: next }),
    marketing_studio_page: pageUrl(ctx),
  };
}

const MARKETING_TOOLS = [
  {
    name: 'get_marketing_studio_status',
    description:
      'Marketing Studio readiness: Lob postcard config, brand kit, design platforms. ' +
      'Physical mail send and AI image generation stay in the /direct-mail UI.',
    schema: z.object({}),
    run: getMarketingStudioStatus,
  },
  {
    name: 'list_direct_mail_playbooks',
    description: 'List Marketing Studio direct-mail playbooks (postcard angles / contexts).',
    schema: z.object({}),
    run: listDirectMailPlaybooks,
  },
  {
    name: 'get_direct_mail_playbook',
    description: 'Get one direct-mail playbook in full (copy angles, contexts).',
    schema: z.object({ playbook_id: z.string().min(1) }),
    run: getDirectMailPlaybook,
  },
  {
    name: 'suggest_direct_mail_playbook',
    description: 'Suggest the best direct-mail playbook for a CRM lead (and alternatives).',
    schema: z.object({
      lead_id: z.string().min(1),
      context: z.string().optional().describe('Optional playbook context hint from list_direct_mail_playbooks.'),
    }),
    run: suggestDirectMailPlaybook,
  },
  {
    name: 'list_direct_mail_queue',
    description: 'List leads currently in the Direct Mail queue (folder + tag).',
    schema: z.object({ limit: z.number().int().min(1).max(100).optional() }),
    run: listDirectMailQueue,
  },
  {
    name: 'queue_leads_for_direct_mail',
    description:
      'Add CRM leads to the Direct Mail queue (moves into the Direct Mail folder and tags them). Viewers cannot queue.',
    schema: z.object({
      lead_ids: z.array(z.string().min(1)).min(1).max(100),
    }),
    run: queueLeadsForDirectMail,
  },
  {
    name: 'remove_leads_from_direct_mail_queue',
    description: 'Remove leads from the Direct Mail queue (clears the queue tag / filing).',
    schema: z.object({
      lead_ids: z.array(z.string().min(1)).min(1).max(100),
    }),
    run: removeLeadsFromDirectMailQueue,
  },
  {
    name: 'update_marketing_brand_kit',
    description:
      'Update Marketing Studio brand kit text fields (business name, phone, website, address, hours, email, logo overlay toggle). Logo upload stays in the UI.',
    schema: z.object({
      business_name: z.string().max(120).optional(),
      phone: z.string().max(40).optional(),
      email: z.string().max(120).optional(),
      website: z.string().max(240).optional(),
      address: z.string().max(240).optional(),
      hours: z.string().max(240).optional(),
      use_logo_in_design: z.boolean().optional(),
    }),
    run: updateMarketingBrandKit,
  },
];

const BY_NAME = Object.fromEntries(MARKETING_TOOLS.map((t) => [t.name, t]));
const MARKETING_TOOL_NAMES = MARKETING_TOOLS.map((t) => t.name);

async function executeMarketingTool(ctx, name, input) {
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
  return MARKETING_TOOLS.map((tool) => {
    const { $schema, ...parameters } = zodToJsonSchema(tool.schema, { target: 'openApi3' });
    return { type: 'function', function: { name: tool.name, description: tool.description, parameters } };
  });
}

module.exports = {
  MARKETING_TOOLS,
  MARKETING_TOOL_NAMES,
  READ_ONLY_MARKETING_TOOLS: [
    'get_marketing_studio_status',
    'list_direct_mail_playbooks',
    'get_direct_mail_playbook',
    'suggest_direct_mail_playbook',
    'list_direct_mail_queue',
  ],
  DESTRUCTIVE_MARKETING_TOOLS: ['remove_leads_from_direct_mail_queue'],
  executeMarketingTool,
  openAiFunctionTools,
};
