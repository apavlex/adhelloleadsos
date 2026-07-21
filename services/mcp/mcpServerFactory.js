/**
 * Builds an MCP server instance with CEO CRM tools registered.
 */
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { z } = require('zod');
const { executeCrmTool } = require('./mcpToolExecutor');
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
    version: '1.1.0',
  });

  const toolNames = [
    'list_folders',
    'get_folder',
    'count_leads',
    'list_leads',
    'get_lead',
    'update_lead',
    'bulk_update_leads',
    'search_leads',
  ];
  mcpLogger.toolsDiscovered({ workspaceId: ctx.workspaceId, tools: toolNames, source: 'mcp_server' });

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
      description: 'Fetch the full lead record by lead id/key.',
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
    version: '1.1.0',
    description: 'AdHello CEO Command Center CRM — folders, leads, search, and enrichment updates.',
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
        description: 'Count leads in a folder.',
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
    ],
  };
}

module.exports = {
  createCrmMcpServer,
  getOpenAiToolManifest,
};
