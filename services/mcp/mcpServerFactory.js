/**
 * Builds an MCP server instance with CEO CRM tools registered.
 */
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { z } = require('zod');
const crm = require('./mcpCrmService');

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

async function runTool(ctx, fn) {
  try {
    const data = await fn();
    return jsonToolResult({ success: true, ...data });
  } catch (err) {
    return jsonToolError(err);
  }
}

/**
 * @param {{ workspaceId: string, userEmail?: string }} ctx
 */
function createCrmMcpServer(ctx) {
  const server = new McpServer({
    name: 'adhello-ceo-crm',
    version: '1.0.0',
  });

  server.registerTool(
    'list_folders',
    {
      description: 'List all lead folders in the active workspace with lead counts.',
      inputSchema: z.object({}),
    },
    async () => runTool(ctx, () => crm.listFolders(ctx)),
  );

  server.registerTool(
    'get_folder',
    {
      description: 'Get folder metadata and lead count by folder name or key.',
      inputSchema: z.object({
        folder_name: z.string().min(1).describe('Folder display name or folder key.'),
      }),
    },
    async ({ folder_name }) => runTool(ctx, () => crm.getFolder(ctx, { folder_name })),
  );

  server.registerTool(
    'list_leads',
    {
      description: 'List leads in a folder with pagination.',
      inputSchema: z.object({
        folder_name: z.string().min(1).describe('Folder display name or folder key.'),
        limit: z.number().int().min(1).max(100).optional().describe('Page size (default 25, max 100).'),
        offset: z.number().int().min(0).optional().describe('Pagination offset (default 0).'),
      }),
    },
    async ({ folder_name, limit, offset }) =>
      runTool(ctx, () => crm.listLeads(ctx, { folder_name, limit, offset })),
  );

  server.registerTool(
    'get_lead',
    {
      description: 'Fetch the full lead record by lead id/key.',
      inputSchema: z.object({
        lead_id: z.string().min(1).describe('Lead key, with or without the lead: prefix.'),
      }),
    },
    async ({ lead_id }) => runTool(ctx, () => crm.getLead(ctx, { lead_id })),
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
    async ({ lead_id, fields }) => runTool(ctx, () => crm.updateLead(ctx, { lead_id, fields })),
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
    async ({ updates }) => runTool(ctx, () => crm.bulkUpdateLeads(ctx, { updates })),
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
    async ({ query, limit, offset }) => runTool(ctx, () => crm.searchLeads(ctx, { query, limit, offset })),
  );

  return server;
}

/** OpenAI / ChatGPT connector manifest (tool JSON schemas). */
function getOpenAiToolManifest() {
  return {
    name: 'adhello-ceo-crm',
    version: '1.0.0',
    description: 'AdHello CEO Command Center CRM — folders, leads, search, and enrichment updates.',
    authentication: {
      type: 'bearer',
      header: 'Authorization',
      description:
        'Use Authorization: Bearer <token>. Generate a token from CEO → MCP while signed in, or set MCP_ACCESS_TOKEN on the server.',
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
          properties: {
            folder_name: { type: 'string', description: 'Folder name or key' },
          },
          required: ['folder_name'],
          additionalProperties: false,
        },
      },
      {
        name: 'list_leads',
        description: 'List leads in a folder.',
        input_schema: {
          type: 'object',
          properties: {
            folder_name: { type: 'string' },
            limit: { type: 'integer', minimum: 1, maximum: 100 },
            offset: { type: 'integer', minimum: 0 },
          },
          required: ['folder_name'],
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
