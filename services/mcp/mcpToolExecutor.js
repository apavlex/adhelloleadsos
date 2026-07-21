/**
 * Execute CRM MCP tools in-process (shared by MCP server, inline chat fallback, diagnostics).
 */
const crm = require('./mcpCrmService');
const mcpLogger = require('./mcpLogger');
const pavlexLogger = require('../pavlex/pavlexLogger');

const TOOL_NAMES = [
  'list_folders',
  'get_folder',
  'count_leads',
  'list_leads',
  'get_lead',
  'update_lead',
  'bulk_update_leads',
  'search_leads',
];

async function executeCrmTool(ctx, toolName, args) {
  const name = String(toolName || '').trim();
  const input = args && typeof args === 'object' ? args : {};

  mcpLogger.toolInvoke({
    tool: name,
    workspaceId: ctx && ctx.workspaceId,
    userEmail: ctx && ctx.userEmail,
    args: input,
  });

  try {
    let result;
    switch (name) {
      case 'list_folders':
        result = await crm.listFolders(ctx);
        break;
      case 'get_folder':
        result = await crm.getFolder(ctx, input);
        break;
      case 'count_leads':
        result = await crm.countLeads(ctx, input);
        break;
      case 'list_leads':
        result = await crm.listLeads(ctx, input);
        break;
      case 'get_lead':
        result = await crm.getLead(ctx, input);
        break;
      case 'update_lead':
        result = await crm.updateLead(ctx, input);
        break;
      case 'bulk_update_leads':
        result = await crm.bulkUpdateLeads(ctx, input);
        break;
      case 'search_leads':
        result = await crm.searchLeads(ctx, input);
        break;
      default: {
        const err = new Error(`Unknown tool: ${name}`);
        err.code = 'UNKNOWN_TOOL';
        throw err;
      }
    }

    const payload = { success: true, ...result };
    mcpLogger.toolResponse({
      tool: name,
      workspaceId: ctx && ctx.workspaceId,
      ok: true,
      summary: summarizeToolResult(name, payload),
    });
    pavlexLogger.toolExecution({
      user: ctx && ctx.userEmail,
      tool: name,
      args: input,
      response: payload,
      mcpConnected: true,
    });
    return payload;
  } catch (err) {
    const payload = {
      success: false,
      error: err.message || 'Tool failed',
      code: err.code || 'ERROR',
    };
    mcpLogger.toolResponse({
      tool: name,
      workspaceId: ctx && ctx.workspaceId,
      ok: false,
      error: payload.error,
      code: payload.code,
    });
    pavlexLogger.toolExecution({
      user: ctx && ctx.userEmail,
      tool: name,
      args: input,
      response: payload,
      mcpConnected: true,
    });
    return payload;
  }
}

function summarizeToolResult(toolName, payload) {
  if (!payload || !payload.success) return '';
  if (toolName === 'list_folders' && Array.isArray(payload.folders)) {
    return `${payload.folders.length} folders`;
  }
  if (toolName === 'count_leads' && typeof payload.count === 'number') {
    return `count=${payload.count}`;
  }
  if (toolName === 'list_leads' && Array.isArray(payload.leads)) {
    return `${payload.leads.length} leads`;
  }
  if (toolName === 'search_leads' && Array.isArray(payload.leads)) {
    return `${payload.leads.length} matches`;
  }
  return 'ok';
}

function getOpenAiFunctionTools() {
  return [
    {
      type: 'function',
      function: {
        name: 'list_folders',
        description: 'List all lead folders in the workspace with lead counts.',
        parameters: { type: 'object', properties: {}, additionalProperties: false },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_folder',
        description: 'Get folder metadata and lead count by folder_id or folder name.',
        parameters: {
          type: 'object',
          properties: {
            folder_id: { type: 'string', description: 'Folder key/id' },
            folder_name: { type: 'string', description: 'Folder display name' },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'count_leads',
        description:
          'Count leads in the workspace (all folders) or in a specific folder by folder_id or folder_name.',
        parameters: {
          type: 'object',
          properties: {
            folder_id: { type: 'string', description: 'Optional folder key/id' },
            folder_name: { type: 'string', description: 'Optional folder display name' },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'list_leads',
        description: 'List leads in a folder with pagination.',
        parameters: {
          type: 'object',
          properties: {
            folder_id: { type: 'string' },
            folder_name: { type: 'string' },
            limit: { type: 'integer', minimum: 1, maximum: 100 },
            offset: { type: 'integer', minimum: 0 },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_lead',
        description: 'Fetch full lead record by lead_id.',
        parameters: {
          type: 'object',
          properties: { lead_id: { type: 'string' } },
          required: ['lead_id'],
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'update_lead',
        description: 'Update CRM/enrichment fields on a lead.',
        parameters: {
          type: 'object',
          properties: {
            lead_id: { type: 'string' },
            fields: { type: 'object', additionalProperties: true },
          },
          required: ['lead_id', 'fields'],
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'bulk_update_leads',
        description: 'Batch update up to 50 leads.',
        parameters: {
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
    },
    {
      type: 'function',
      function: {
        name: 'search_leads',
        description: 'Search leads across folders by company, email, phone, website, or tags.',
        parameters: {
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
    },
  ];
}

module.exports = {
  TOOL_NAMES,
  executeCrmTool,
  getOpenAiFunctionTools,
};
