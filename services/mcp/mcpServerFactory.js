/**
 * Builds an MCP server instance with CEO CRM tools registered.
 */
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
// The MCP SDK validates with zod v3; schemas built with the app's zod v4 can't be parsed by it.
const { z } = require('zod/v3');
const {
  executeCrmTool,
  TOOL_NAMES,
  getLeadGenToolSchemas,
  getCrmActionToolSchemas,
} = require('./mcpToolExecutor');
const networkTools = require('./mcpNetwork');
const mcpLogger = require('./mcpLogger');

function jsonToolResult(payload) {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(payload, null, 2),
      },
    ],
  };
}

function jsonToolError(err) {
  const payload = {
    success: false,
    error: err.message || 'Request failed',
    code: err.code || 'ERROR',
  };
  return {
    ...jsonToolResult(payload),
    isError: true,
  };
}

async function runTool(ctx, toolName, args) {
  const payload = await executeCrmTool(ctx, toolName, args);
  if (!payload.success) {
    return jsonToolError({ message: payload.error, code: payload.code });
  }
  return jsonToolResult(payload);
}

const folderRefSchema = z
  .object({
    folder_id: z.string().min(1).optional().describe('Folder key/id.'),
    folder_name: z.string().min(1).optional().describe('Folder display name.'),
  })
  .refine((v) => Boolean(v.folder_id || v.folder_name), {
    message: 'folder_id or folder_name is required.',
  });

const READ_ONLY_TOOLS = new Set([
  'list_folders',
  'get_folder',
  'count_leads',
  'list_leads',
  'get_lead',
  'search_leads',
  'get_search_status',
  'list_tags',
  'get_ghl_sync_status',
  'list_team_members',
  'list_opportunity_pipelines',
  'get_opportunity_board',
  'list_tasks',
  'list_followups',
  'suggest_daily_leads',
  ...networkTools.READ_ONLY_NETWORK_TOOLS,
]);

// Overwrites or removes data, or pushes it somewhere it can't be pulled back from.
const DESTRUCTIVE_TOOLS = new Set([
  'update_lead',
  'bulk_update_leads',
  'sync_leads_to_ghl',
  'update_task',
  ...networkTools.DESTRUCTIVE_NETWORK_TOOLS,
]);

// Reaches outside this app: paid lead searches, enrichment, GHL, texting businesses.
const OPEN_WORLD_TOOLS = new Set([
  'find_leads',
  'enrich_lead',
  'sync_leads_to_ghl',
  ...networkTools.OPEN_WORLD_NETWORK_TOOLS,
]);

function toolAnnotations(name) {
  if (READ_ONLY_TOOLS.has(name)) return { readOnlyHint: true, openWorldHint: false };
  return {
    readOnlyHint: false,
    destructiveHint: DESTRUCTIVE_TOOLS.has(name),
    idempotentHint: name === 'create_folder',
    openWorldHint: OPEN_WORLD_TOOLS.has(name),
  };
}

/** The SDK (1.12) wants a raw zod shape, not a z.object(); a full schema publishes `{}`. */
function inputShape(schema) {
  let current = schema;
  while (current && current._def && current._def.typeName === 'ZodEffects') current = current._def.schema;
  if (current && current.shape && typeof current.shape === 'object') return current.shape;
  return current && !current._def ? current : {};
}

/**
 * @param {{ workspaceId: string, userEmail?: string, baseUrl?: string }} ctx
 */
function createCrmMcpServer(ctx) {
  const server = new McpServer({
    name: 'adhello-ceo-crm',
    version: '1.4.0',
  });

  const register = (name, config, handler) =>
    server.registerTool(
      name,
      { ...config, inputSchema: inputShape(config.inputSchema), annotations: toolAnnotations(name) },
      handler,
    );

  mcpLogger.toolsDiscovered({
    workspaceId: ctx.workspaceId,
    tools: TOOL_NAMES.slice(),
    source: 'mcp_server',
  });

  register(
    'list_folders',
    {
      description: 'List all lead folders in the active workspace with lead counts.',
      inputSchema: z.object({}),
    },
    async () => runTool(ctx, 'list_folders', {}),
  );

  register(
    'get_folder',
    {
      description: 'Get folder metadata and lead count by folder_id or folder name.',
      inputSchema: folderRefSchema,
    },
    async (args) => runTool(ctx, 'get_folder', args),
  );

  register(
    'count_leads',
    {
      description: 'Count leads in a folder by folder_id or folder name.',
      inputSchema: folderRefSchema,
    },
    async (args) => runTool(ctx, 'count_leads', args),
  );

  register(
    'list_leads',
    {
      description:
        'List leads in a folder with pagination and sort (name, rating, reviews, score, newest). bookmarked_only=true lists bookmarked leads (folder optional).',
      inputSchema: z.object({
        folder_id: z.string().min(1).optional().describe('Folder key/id.'),
        folder_name: z.string().min(1).optional().describe('Folder display name.'),
        limit: z.number().int().min(1).max(100).optional().describe('Page size (default 25, max 100).'),
        offset: z.number().int().min(0).optional().describe('Pagination offset (default 0).'),
        sort: z.enum(['name', 'rating', 'reviews', 'score', 'newest']).optional(),
        bookmarked_only: z.boolean().optional(),
      }),
    },
    async (args) => runTool(ctx, 'list_leads', args),
  );

  register(
    'create_folder',
    {
      description:
        'Create lead folder(s) in Folder manager (not Opportunity pipelines). Idempotent by name; names[] creates several.',
      inputSchema: z.object({
        name: z.string().min(1).optional(),
        names: z.array(z.string().min(1)).max(25).optional(),
        parent_folder_id: z.string().min(1).optional(),
        parent_folder_name: z.string().min(1).optional(),
        description: z.string().optional(),
      }),
    },
    async (args) => runTool(ctx, 'create_folder', args),
  );

  register(
    'rename_folder',
    {
      description: 'Rename a lead folder.',
      inputSchema: z.object({
        folder_id: z.string().min(1).optional(),
        folder_name: z.string().min(1).optional(),
        new_name: z.string().min(1),
      }),
    },
    async (args) => runTool(ctx, 'rename_folder', args),
  );

  register(
    'find_leads',
    {
      description:
        'Run a new Google Maps lead search in the background and save results into a lead folder (created if missing). Returns a search_id immediately.',
      inputSchema: z.object({
        query: z.string().min(1).describe('Trade / business type, e.g. "Interior Designers".'),
        location: z.string().optional().describe('City and state, e.g. "Camas, WA".'),
        city: z.string().optional(),
        state: z.string().optional(),
        max_results: z.number().int().min(1).max(60).optional(),
        folder_id: z.string().min(1).optional(),
        folder_name: z.string().min(1).optional(),
        parent_folder_name: z.string().min(1).optional(),
        min_rating: z.number().min(0).max(5).optional(),
        min_reviews: z.number().int().min(0).optional(),
      }),
    },
    async (args) => runTool(ctx, 'find_leads', args),
  );

  register(
    'get_search_status',
    {
      description: 'Status of background lead searches started by find_leads.',
      inputSchema: z.object({ search_id: z.string().min(1).optional() }),
    },
    async (args) => runTool(ctx, 'get_search_status', args),
  );

  register(
    'bookmark_leads',
    {
      description: 'Bookmark or unbookmark up to 100 leads.',
      inputSchema: z.object({
        lead_ids: z.array(z.string().min(1)).min(1).max(100),
        bookmarked: z.boolean().optional(),
      }),
    },
    async (args) => runTool(ctx, 'bookmark_leads', args),
  );

  register(
    'save_script',
    {
      description:
        'Save a call script, SMS or email template to the workspace Scripts library (merge tags {{name}} {{company}} {{city}}). ' +
        'Use section "sms" for text messages, "email" for emails.',
      inputSchema: z.object({
        name: z.string().min(1),
        body: z.string().min(1),
        section: z
          .enum(['opening', 'discovery', 'valueProp', 'objectionHandling', 'close', 'sms', 'email'])
          .optional(),
        folder_id: z.string().min(1).optional(),
        folder_name: z.string().min(1).optional(),
        offer_key: z.string().optional(),
      }),
    },
    async (args) => runTool(ctx, 'save_script', args),
  );

  register(
    'move_opportunities',
    {
      description: 'Move up to 100 leads onto an Opportunity pipeline stage (default Review/first stage).',
      inputSchema: z.object({
        lead_ids: z.array(z.string().min(1)).min(1).max(100),
        pipeline_id: z.string().min(1).optional(),
        pipeline_name: z.string().min(1).optional(),
        stage_id: z.string().min(1).optional(),
        stage_name: z.string().min(1).optional(),
      }),
    },
    async (args) => runTool(ctx, 'move_opportunities', args),
  );

  register(
    'list_tags',
    {
      description: 'List workspace lead tags with lead counts.',
      inputSchema: z.object({}),
    },
    async () => runTool(ctx, 'list_tags', {}),
  );

  register(
    'tag_leads',
    {
      description: 'Add and/or remove tags (by name) on up to 100 leads; missing tags in add are created.',
      inputSchema: z.object({
        lead_ids: z.array(z.string().min(1)).min(1).max(100),
        add: z.array(z.string().min(1)).optional(),
        remove: z.array(z.string().min(1)).optional(),
      }),
    },
    async (args) => runTool(ctx, 'tag_leads', args),
  );

  register(
    'sync_leads_to_ghl',
    {
      description:
        'Push up to 50 leads to GoHighLevel (same as Sync GHL). Per-lead created/updated/skipped/error; long batches continue in the background (job_id).',
      inputSchema: z.object({
        lead_ids: z.array(z.string().min(1)).min(1).max(50),
      }),
    },
    async (args) => runTool(ctx, 'sync_leads_to_ghl', args),
  );

  register(
    'get_ghl_sync_status',
    {
      description: 'Progress of a background GHL sync started by sync_leads_to_ghl.',
      inputSchema: z.object({ job_id: z.string().min(1).optional() }),
    },
    async (args) => runTool(ctx, 'get_ghl_sync_status', args),
  );

  register(
    'list_team_members',
    {
      description: 'List workspace members (name, email, role) for assigning tasks.',
      inputSchema: z.object({}),
    },
    async () => runTool(ctx, 'list_team_members', {}),
  );

  register(
    'get_lead',
    {
      description: 'Fetch the full lead record by lead id/key (status, stage, contact fields).',
      inputSchema: z.object({
        lead_id: z.string().min(1).describe('Lead key, with or without the lead: prefix.'),
      }),
    },
    async ({ lead_id }) => runTool(ctx, 'get_lead', { lead_id }),
  );

  register(
    'update_lead',
    {
      description:
        'Update enrichment and CRM fields on a lead (phone, email, website, status, tags, etc.).',
      inputSchema: z.object({
        lead_id: z.string().min(1).describe('Lead key, with or without the lead: prefix.'),
        fields: z
          .record(z.any())
          .describe('Object of fields to update. Only whitelisted enrichment/CRM fields are applied.'),
      }),
    },
    async ({ lead_id, fields }) => runTool(ctx, 'update_lead', { lead_id, fields }),
  );

  register(
    'bulk_update_leads',
    {
      description: 'Batch update up to 50 leads. Each item needs lead_id and fields.',
      inputSchema: z.object({
        updates: z
          .array(
            z.object({
              lead_id: z.string().min(1),
              fields: z.record(z.any()),
            }),
          )
          .min(1)
          .max(50),
      }),
    },
    async ({ updates }) => runTool(ctx, 'bulk_update_leads', { updates }),
  );

  register(
    'search_leads',
    {
      description: 'Search leads across all folders by company, email, phone, website, or tags.',
      inputSchema: z.object({
        query: z.string().min(2).describe('Search text (min 2 characters).'),
        limit: z.number().int().min(1).max(100).optional(),
        offset: z.number().int().min(0).optional(),
      }),
    },
    async ({ query, limit, offset }) => runTool(ctx, 'search_leads', { query, limit, offset }),
  );

  register(
    'list_opportunity_pipelines',
    {
      description: 'List opportunity pipelines, stages, active pipeline, and templates.',
      inputSchema: z.object({}),
    },
    async () => runTool(ctx, 'list_opportunity_pipelines', {}),
  );

  register(
    'get_opportunity_board',
    {
      description: 'Get prospecting stages and sample leads on an opportunity pipeline.',
      inputSchema: z.object({
        pipeline_id: z.string().min(1).optional(),
        limit: z.number().int().min(1).max(20).optional(),
      }),
    },
    async (args) => runTool(ctx, 'get_opportunity_board', args),
  );

  register(
    'create_opportunity_pipeline',
    {
      description: 'Create a new opportunity pipeline from a template.',
      inputSchema: z.object({
        name: z.string().min(1),
        template_id: z.string().min(1).optional(),
      }),
    },
    async (args) => runTool(ctx, 'create_opportunity_pipeline', args),
  );

  register(
    'move_opportunity',
    {
      description: 'Move a lead onto a pipeline stage (stage_id or stage_name; default Review/first stage).',
      inputSchema: z.object({
        lead_id: z.string().min(1),
        pipeline_id: z.string().min(1).optional(),
        pipeline_name: z.string().min(1).optional(),
        stage_id: z.string().min(1).optional(),
        stage_name: z.string().min(1).optional(),
      }),
    },
    async (args) => runTool(ctx, 'move_opportunity', args),
  );

  register(
    'enrich_lead',
    {
      description: 'Hunt for email/phone enrichment on a lead.',
      inputSchema: z.object({
        lead_id: z.string().min(1),
        force: z.boolean().optional(),
      }),
    },
    async (args) => runTool(ctx, 'enrich_lead', args),
  );

  register(
    'list_tasks',
    {
      description: "List manual tasks for the signed-in user or a teammate's list (assignee).",
      inputSchema: z.object({
        column: z.string().optional(),
        lead_id: z.string().optional(),
        assignee: z.string().optional(),
        limit: z.number().int().min(1).max(100).optional(),
      }),
    },
    async (args) => runTool(ctx, 'list_tasks', args),
  );

  register(
    'create_task',
    {
      description:
        'Create a task for yourself or assign it to a teammate (assignee email/name), optionally lead-linked and due at scheduled_at.',
      inputSchema: z.object({
        title: z.string().min(1),
        column: z.string().optional(),
        lead_id: z.string().optional(),
        assignee: z.string().optional(),
        scheduled_at: z.string().optional(),
        remind_minutes_before: z.number().int().optional(),
      }),
    },
    async (args) => runTool(ctx, 'create_task', args),
  );

  register(
    'update_task',
    {
      description: "Update a task (yours or a teammate's); assignee reassigns it.",
      inputSchema: z.object({
        task_id: z.string().min(1),
        title: z.string().optional(),
        column: z.string().optional(),
        lead_id: z.string().optional(),
        assignee: z.string().optional(),
        scheduled_at: z.string().optional(),
        remind_minutes_before: z.number().int().optional(),
      }),
    },
    async (args) => runTool(ctx, 'update_task', args),
  );

  register(
    'list_followups',
    {
      description: 'List upcoming or overdue scheduled follow-up tasks.',
      inputSchema: z.object({
        within_hours: z.number().int().min(1).max(336).optional(),
        include_done: z.boolean().optional(),
      }),
    },
    async (args) => runTool(ctx, 'list_followups', args),
  );

  register(
    'suggest_daily_leads',
    {
      description:
        'Suggest top leads to work today from the active opportunity pipeline (early prospecting stages first).',
      inputSchema: z.object({
        pipeline_id: z.string().min(1).optional(),
        limit: z.number().int().min(1).max(20).optional(),
      }),
    },
    async (args) => runTool(ctx, 'suggest_daily_leads', args),
  );

  for (const tool of networkTools.NETWORK_TOOLS) {
    register(tool.name, { description: tool.description, inputSchema: tool.schema }, async (args) => runTool(ctx, tool.name, args));
  }

  return server;
}

/** OpenAI / ChatGPT connector manifest (tool JSON schemas). */
function getOpenAiToolManifest() {
  const folderRefProps = {
    folder_id: { type: 'string', description: 'Folder key/id' },
    folder_name: { type: 'string', description: 'Folder display name' },
  };

  return {
    name: 'adhello-ceo-crm',
    version: '1.4.0',
    description:
      'AdHello CEO Command Center CRM — lead folders, lead searches, leads, tags, bookmarks, scripts, opportunities, GHL sync, enrichment, team tasks, follow-ups, and the referral network (members, referrals, applications, review stats).',
    authentication: {
      type: 'oauth2',
      header: 'Authorization',
      discovery: '/.well-known/oauth-protected-resource',
      description:
        'ChatGPT and Claude connectors sign in with OAuth (discovered automatically). Other clients can send Authorization: Bearer <token> with a token from Workspace → Integrations.',
    },
    tools: [
      {
        name: 'list_folders',
        description: 'List all lead folders with counts.',
        input_schema: { type: 'object', properties: {}, additionalProperties: false },
      },
      {
        name: 'get_folder',
        description: 'Get folder metadata and lead count.',
        input_schema: {
          type: 'object',
          properties: folderRefProps,
          additionalProperties: false,
        },
      },
      {
        name: 'count_leads',
        description: 'Count leads in the workspace (all folders) or in a specific folder.',
        input_schema: {
          type: 'object',
          properties: folderRefProps,
          additionalProperties: false,
        },
      },
      {
        name: 'list_leads',
        description: 'List leads in a folder (sort: name, rating, reviews, score, newest; bookmarked_only).',
        input_schema: {
          type: 'object',
          properties: {
            ...folderRefProps,
            limit: { type: 'integer', minimum: 1, maximum: 100 },
            offset: { type: 'integer', minimum: 0 },
            sort: { type: 'string', enum: ['name', 'rating', 'reviews', 'score', 'newest'] },
            bookmarked_only: { type: 'boolean' },
          },
          additionalProperties: false,
        },
      },
      ...getLeadGenToolSchemas().map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      })),
      ...getCrmActionToolSchemas().map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      })),
      {
        name: 'get_lead',
        description: 'Get full lead record.',
        input_schema: {
          type: 'object',
          properties: { lead_id: { type: 'string' } },
          required: ['lead_id'],
          additionalProperties: false,
        },
      },
      {
        name: 'update_lead',
        description: 'Update lead enrichment fields.',
        input_schema: {
          type: 'object',
          properties: {
            lead_id: { type: 'string' },
            fields: { type: 'object', additionalProperties: true },
          },
          required: ['lead_id', 'fields'],
          additionalProperties: false,
        },
      },
      {
        name: 'bulk_update_leads',
        description: 'Batch update leads.',
        input_schema: {
          type: 'object',
          properties: {
            updates: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  lead_id: { type: 'string' },
                  fields: { type: 'object', additionalProperties: true },
                },
                required: ['lead_id', 'fields'],
              },
              maxItems: 50,
            },
          },
          required: ['updates'],
          additionalProperties: false,
        },
      },
      {
        name: 'search_leads',
        description: 'Search CRM leads.',
        input_schema: {
          type: 'object',
          properties: {
            query: { type: 'string', minLength: 2 },
            limit: { type: 'integer', minimum: 1, maximum: 100 },
            offset: { type: 'integer', minimum: 0 },
          },
          required: ['query'],
          additionalProperties: false,
        },
      },
      {
        name: 'list_opportunity_pipelines',
        description: 'List opportunity pipelines and templates.',
        input_schema: { type: 'object', properties: {}, additionalProperties: false },
      },
      {
        name: 'get_opportunity_board',
        description: 'Get prospecting stages and sample leads on a pipeline.',
        input_schema: {
          type: 'object',
          properties: {
            pipeline_id: { type: 'string' },
            limit: { type: 'integer', minimum: 1, maximum: 20 },
          },
          additionalProperties: false,
        },
      },
      {
        name: 'create_opportunity_pipeline',
        description: 'Create an opportunity pipeline from a template.',
        input_schema: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            template_id: { type: 'string' },
          },
          required: ['name'],
          additionalProperties: false,
        },
      },
      {
        name: 'move_opportunity',
        description: 'Move a lead to a pipeline stage.',
        input_schema: {
          type: 'object',
          properties: {
            lead_id: { type: 'string' },
            pipeline_id: { type: 'string' },
            pipeline_name: { type: 'string' },
            stage_id: { type: 'string' },
            stage_name: { type: 'string' },
          },
          required: ['lead_id'],
          additionalProperties: false,
        },
      },
      {
        name: 'enrich_lead',
        description: 'Enrich a lead with email/phone hunt.',
        input_schema: {
          type: 'object',
          properties: {
            lead_id: { type: 'string' },
            force: { type: 'boolean' },
          },
          required: ['lead_id'],
          additionalProperties: false,
        },
      },
      {
        name: 'list_tasks',
        description: "List user tasks (or a teammate's with assignee).",
        input_schema: {
          type: 'object',
          properties: {
            column: { type: 'string' },
            lead_id: { type: 'string' },
            assignee: { type: 'string' },
            limit: { type: 'integer', minimum: 1, maximum: 100 },
          },
          additionalProperties: false,
        },
      },
      {
        name: 'create_task',
        description: 'Create a task for yourself or assign it to a teammate.',
        input_schema: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            column: { type: 'string' },
            lead_id: { type: 'string' },
            assignee: { type: 'string' },
            scheduled_at: { type: 'string' },
            remind_minutes_before: { type: 'integer' },
          },
          required: ['title'],
          additionalProperties: false,
        },
      },
      {
        name: 'update_task',
        description: 'Update or reassign a task.',
        input_schema: {
          type: 'object',
          properties: {
            task_id: { type: 'string' },
            title: { type: 'string' },
            column: { type: 'string' },
            lead_id: { type: 'string' },
            assignee: { type: 'string' },
            scheduled_at: { type: 'string' },
            remind_minutes_before: { type: 'integer' },
          },
          required: ['task_id'],
          additionalProperties: false,
        },
      },
      {
        name: 'list_followups',
        description: 'List upcoming/overdue follow-up tasks.',
        input_schema: {
          type: 'object',
          properties: {
            within_hours: { type: 'integer', minimum: 1, maximum: 336 },
            include_done: { type: 'boolean' },
          },
          additionalProperties: false,
        },
      },
      {
        name: 'suggest_daily_leads',
        description: 'Suggest daily leads from the top opportunity pipeline.',
        input_schema: {
          type: 'object',
          properties: {
            pipeline_id: { type: 'string' },
            limit: { type: 'integer', minimum: 1, maximum: 20 },
          },
          additionalProperties: false,
        },
      },
      ...networkTools.openAiFunctionTools().map(({ function: fn }) => ({
        name: fn.name,
        description: fn.description,
        input_schema: fn.parameters,
      })),
    ],
  };
}

module.exports = {
  createCrmMcpServer,
  getOpenAiToolManifest,
};
