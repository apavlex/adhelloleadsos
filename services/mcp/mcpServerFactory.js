/**
 * Builds an MCP server instance with CEO CRM tools registered.
 */
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { z } = require('zod');
const { executeCrmTool, TOOL_NAMES } = require('./mcpToolExecutor');
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

/**
 * @param {{ workspaceId: string, userEmail?: string }} ctx
 */
function createCrmMcpServer(ctx) {
  const server = new McpServer({
    name: 'adhello-ceo-crm',
    version: '1.2.0',
  });

  mcpLogger.toolsDiscovered({
    workspaceId: ctx.workspaceId,
    tools: TOOL_NAMES.slice(),
    source: 'mcp_server',
  });

  server.registerTool(
    'list_folders',
    {
      description: 'List all lead folders in the active workspace with lead counts.',
      inputSchema: z.object({}),
    },
    async () => runTool(ctx, 'list_folders', {}),
  );

  server.registerTool(
    'get_folder',
    {
      description: 'Get folder metadata and lead count by folder_id or folder name.',
      inputSchema: folderRefSchema,
    },
    async (args) => runTool(ctx, 'get_folder', args),
  );

  server.registerTool(
    'count_leads',
    {
      description: 'Count leads in a folder by folder_id or folder name.',
      inputSchema: folderRefSchema,
    },
    async (args) => runTool(ctx, 'count_leads', args),
  );

  server.registerTool(
    'list_leads',
    {
      description: 'List leads in a folder with pagination.',
      inputSchema: folderRefSchema.extend({
        limit: z.number().int().min(1).max(100).optional().describe('Page size (default 25, max 100).'),
        offset: z.number().int().min(0).optional().describe('Pagination offset (default 0).'),
      }),
    },
    async (args) => runTool(ctx, 'list_leads', args),
  );

  server.registerTool(
    'get_lead',
    {
      description: 'Fetch the full lead record by lead id/key (status, stage, contact fields).',
      inputSchema: z.object({
        lead_id: z.string().min(1).describe('Lead key, with or without the lead: prefix.'),
      }),
    },
    async ({ lead_id }) => runTool(ctx, 'get_lead', { lead_id }),
  );

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
    'list_opportunity_pipelines',
    {
      description: 'List opportunity pipelines, stages, active pipeline, and templates.',
      inputSchema: z.object({}),
    },
    async () => runTool(ctx, 'list_opportunity_pipelines', {}),
  );

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
    'move_opportunity',
    {
      description: 'Move a lead onto a pipeline stage (stage_id or stage_name).',
      inputSchema: z.object({
        lead_id: z.string().min(1),
        pipeline_id: z.string().min(1).optional(),
        stage_id: z.string().min(1).optional(),
        stage_name: z.string().min(1).optional(),
      }),
    },
    async (args) => runTool(ctx, 'move_opportunity', args),
  );

  server.registerTool(
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

  server.registerTool(
    'list_tasks',
    {
      description: 'List signed-in user manual tasks.',
      inputSchema: z.object({
        column: z.string().optional(),
        lead_id: z.string().optional(),
        limit: z.number().int().min(1).max(100).optional(),
      }),
    },
    async (args) => runTool(ctx, 'list_tasks', args),
  );

  server.registerTool(
    'create_task',
    {
      description: 'Create or upsert an open task (optionally linked to a lead / scheduled).',
      inputSchema: z.object({
        title: z.string().min(1),
        column: z.string().optional(),
        lead_id: z.string().optional(),
        scheduled_at: z.string().optional(),
        remind_minutes_before: z.number().int().optional(),
      }),
    },
    async (args) => runTool(ctx, 'create_task', args),
  );

  server.registerTool(
    'update_task',
    {
      description: 'Update an existing task.',
      inputSchema: z.object({
        task_id: z.string().min(1),
        title: z.string().optional(),
        column: z.string().optional(),
        lead_id: z.string().optional(),
        scheduled_at: z.string().optional(),
        remind_minutes_before: z.number().int().optional(),
      }),
    },
    async (args) => runTool(ctx, 'update_task', args),
  );

  server.registerTool(
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

  server.registerTool(
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
    version: '1.2.0',
    description:
      'AdHello CEO Command Center CRM — folders, leads, opportunities, enrichment, tasks, and follow-ups.',
    authentication: {
      type: 'bearer',
      header: 'Authorization',
      description:
        'Use Authorization: Bearer <token>. Chat sessions use short-lived session tokens; long-lived tokens can be generated in Workspace → Integrations.',
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
        description: 'List leads in a folder.',
        input_schema: {
          type: 'object',
          properties: {
            ...folderRefProps,
            limit: { type: 'integer', minimum: 1, maximum: 100 },
            offset: { type: 'integer', minimum: 0 },
          },
          additionalProperties: false,
        },
      },
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
        description: 'List user tasks.',
        input_schema: {
          type: 'object',
          properties: {
            column: { type: 'string' },
            lead_id: { type: 'string' },
            limit: { type: 'integer', minimum: 1, maximum: 100 },
          },
          additionalProperties: false,
        },
      },
      {
        name: 'create_task',
        description: 'Create or upsert a task.',
        input_schema: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            column: { type: 'string' },
            lead_id: { type: 'string' },
            scheduled_at: { type: 'string' },
            remind_minutes_before: { type: 'integer' },
          },
          required: ['title'],
          additionalProperties: false,
        },
      },
      {
        name: 'update_task',
        description: 'Update a task.',
        input_schema: {
          type: 'object',
          properties: {
            task_id: { type: 'string' },
            title: { type: 'string' },
            column: { type: 'string' },
            lead_id: { type: 'string' },
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
    ],
  };
}

module.exports = {
  createCrmMcpServer,
  getOpenAiToolManifest,
};
