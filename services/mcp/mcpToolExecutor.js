/**
 * Execute CRM MCP tools in-process (shared by MCP server, inline chat fallback, diagnostics).
 */
const crm = require('./mcpCrmService');
const ops = require('./mcpPavlexOps');
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
  'list_opportunity_pipelines',
  'get_opportunity_board',
  'create_opportunity_pipeline',
  'move_opportunity',
  'enrich_lead',
  'list_tasks',
  'create_task',
  'update_task',
  'list_followups',
  'suggest_daily_leads',
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
      case 'list_opportunity_pipelines':
        result = await ops.listOpportunityPipelines(ctx);
        break;
      case 'get_opportunity_board':
        result = await ops.getOpportunityBoard(ctx, input);
        break;
      case 'create_opportunity_pipeline':
        result = await ops.createOpportunityPipeline(ctx, input);
        break;
      case 'move_opportunity':
        result = await ops.moveOpportunity(ctx, input);
        break;
      case 'enrich_lead':
        result = await ops.enrichLead(ctx, input);
        break;
      case 'list_tasks':
        result = await ops.listTasks(ctx, input);
        break;
      case 'create_task':
        result = await ops.createTask(ctx, input);
        break;
      case 'update_task':
        result = await ops.updateTask(ctx, input);
        break;
      case 'list_followups':
        result = await ops.listFollowups(ctx, input);
        break;
      case 'suggest_daily_leads':
        result = await ops.suggestDailyLeads(ctx, input);
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
  if (toolName === 'list_opportunity_pipelines' && Array.isArray(payload.pipelines)) {
    return `${payload.pipelines.length} pipelines`;
  }
  if (toolName === 'get_opportunity_board' && Array.isArray(payload.stages)) {
    return `${payload.stages.length} stages`;
  }
  if (toolName === 'suggest_daily_leads' && Array.isArray(payload.suggestions)) {
    return `${payload.suggestions.length} suggestions`;
  }
  if (toolName === 'list_tasks' && Array.isArray(payload.tasks)) {
    return `${payload.tasks.length} tasks`;
  }
  if (toolName === 'list_followups' && Array.isArray(payload.followups)) {
    return `${payload.followups.length} followups`;
  }
  if (toolName === 'enrich_lead') {
    return payload.found ? 'email found' : 'no email';
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
        description: 'Fetch full lead record by lead_id (includes status and prospecting stage).',
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
        description: 'Update CRM/enrichment fields on a lead (status, phone, email, tags, etc.).',
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
        description: 'Find leads across folders by company, email, phone, website, or tags.',
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
    {
      type: 'function',
      function: {
        name: 'list_opportunity_pipelines',
        description:
          'List opportunity pipelines, stages, active pipeline, and available pipeline templates.',
        parameters: { type: 'object', properties: {}, additionalProperties: false },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_opportunity_board',
        description:
          'Get prospecting stages and leads on an opportunity pipeline (counts + sample cards per stage).',
        parameters: {
          type: 'object',
          properties: {
            pipeline_id: { type: 'string', description: 'Optional pipeline id (defaults to active)' },
            limit: { type: 'integer', minimum: 1, maximum: 20, description: 'Cards per stage' },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'create_opportunity_pipeline',
        description: 'Create a new opportunity pipeline from a template.',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Pipeline display name' },
            template_id: {
              type: 'string',
              description: 'Template id from list_opportunity_pipelines (e.g. marketing, sales)',
            },
          },
          required: ['name'],
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'move_opportunity',
        description: 'Move a lead to a pipeline stage (by stage_id or stage_name).',
        parameters: {
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
    },
    {
      type: 'function',
      function: {
        name: 'enrich_lead',
        description: 'Hunt for email/phone enrichment on a lead (website scrape, Monid, etc.).',
        parameters: {
          type: 'object',
          properties: {
            lead_id: { type: 'string' },
            force: {
              type: 'boolean',
              description: 'Re-hunt even if the lead already has an email',
            },
          },
          required: ['lead_id'],
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'list_tasks',
        description: 'List the signed-in user manual tasks (optional column or lead filter).',
        parameters: {
          type: 'object',
          properties: {
            column: { type: 'string', description: 'backlog | todo | doing | done' },
            lead_id: { type: 'string' },
            limit: { type: 'integer', minimum: 1, maximum: 100 },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'create_task',
        description: 'Create or upsert an open task for the signed-in user (optionally linked to a lead).',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            column: { type: 'string' },
            lead_id: { type: 'string' },
            scheduled_at: { type: 'string', description: 'ISO datetime for follow-up reminder' },
            remind_minutes_before: { type: 'integer' },
          },
          required: ['title'],
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'update_task',
        description: 'Update an existing task (title, column, schedule, lead link).',
        parameters: {
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
    },
    {
      type: 'function',
      function: {
        name: 'list_followups',
        description: 'List upcoming/overdue scheduled follow-up tasks for the signed-in user.',
        parameters: {
          type: 'object',
          properties: {
            within_hours: {
              type: 'integer',
              minimum: 1,
              maximum: 336,
              description: 'Lookahead window (default 48)',
            },
            include_done: { type: 'boolean' },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'suggest_daily_leads',
        description:
          'Suggest top leads to work today from the active (or specified) opportunity pipeline, prioritizing early prospecting stages.',
        parameters: {
          type: 'object',
          properties: {
            pipeline_id: { type: 'string' },
            limit: { type: 'integer', minimum: 1, maximum: 20 },
          },
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
