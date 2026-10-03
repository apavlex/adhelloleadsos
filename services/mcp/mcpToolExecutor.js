/**
 * Execute CRM MCP tools in-process (shared by MCP server, inline chat fallback, diagnostics).
 */
const crm = require('./mcpCrmService');
const ops = require('./mcpPavlexOps');
const leadGen = require('./mcpLeadGen');
const leadActions = require('./mcpLeadActions');
const networkTools = require('./mcpNetwork');
const cadenceTools = require('./mcpCadences');
const leadScriptTools = require('./mcpLeadScripts');
const messagingTools = require('./mcpMessaging');
const workspaceTools = require('./mcpWorkspaceOps');
const botActivity = require('./mcpBotActivity');
const mcpLogger = require('./mcpLogger');
const pavlexLogger = require('../pavlex/pavlexLogger');

const TOOL_NAMES = [
  'list_folders',
  'get_folder',
  'create_folder',
  'rename_folder',
  'count_leads',
  'list_leads',
  'get_lead',
  'update_lead',
  'bulk_update_leads',
  'search_leads',
  'find_leads',
  'get_search_status',
  'bookmark_leads',
  'list_tags',
  'tag_leads',
  'sync_leads_to_ghl',
  'get_ghl_sync_status',
  'save_script',
  'list_opportunity_pipelines',
  'get_opportunity_board',
  'create_opportunity_pipeline',
  'move_opportunity',
  'move_opportunities',
  'enrich_lead',
  'list_team_members',
  'list_tasks',
  'create_task',
  'update_task',
  'list_followups',
  'suggest_daily_leads',
  ...networkTools.NETWORK_TOOL_NAMES,
  ...cadenceTools.CADENCE_TOOL_NAMES,
  ...leadScriptTools.LEAD_SCRIPT_TOOL_NAMES,
  ...messagingTools.MESSAGING_TOOL_NAMES,
  ...workspaceTools.WORKSPACE_TOOL_NAMES,
];

const LIST_LEADS_DESCRIPTION =
  'List leads in a folder or across the workspace, with filters and sorting (rating = Google stars, reviews = Google review count, ' +
  'score = opportunity score, newest, recent = most recent activity). Folder is optional when any filter is set. ' +
  'Personal filters use Team history: bookmarked_by / tagged_by / worked_by take "me" (the signed-in user), a teammate name or email, ' +
  'or an assistant name, and include what AI assistants did at that person\'s request. ' +
  '"Leads I reviewed / worked on / touched" = worked_by "me" (notes, edits, calls, texts, stage moves, tags, bookmarks, leads they added). ' +
  'Bookmarks and tags themselves are shared by the workspace; bookmarked_only / tag ignore who set them.';

const PERSON_DESCRIPTION = '"me", a teammate name/email, or an assistant name like "Muse".';

const LIST_LEADS_FILTER_JSON = {
  tag: { type: 'string', description: 'Only leads with this tag (name).' },
  tags: { type: 'array', items: { type: 'string' }, description: 'Only leads with any of these tags (names).' },
  status: { type: 'string', description: 'Lead status or prospecting stage, e.g. "Follow-up", "Email Sent".' },
  min_rating: { type: 'number', minimum: 0, maximum: 5, description: 'Minimum Google star rating.' },
  min_reviews: { type: 'integer', minimum: 0, description: 'Minimum Google review count.' },
  max_reviews: { type: 'integer', minimum: 0, description: 'Maximum Google review count.' },
  bookmarked_by: { type: 'string', description: `Leads this person bookmarked (still bookmarked): ${PERSON_DESCRIPTION}` },
  tagged_by: { type: 'string', description: `Leads this person added tags to (still tagged): ${PERSON_DESCRIPTION}` },
  worked_by: { type: 'string', description: `Leads this person worked on / reviewed: ${PERSON_DESCRIPTION}` },
};

async function executeCrmTool(rawCtx, toolName, args) {
  const ctx = botActivity.withBotActivity(rawCtx);
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
      case 'create_folder':
        result = await leadGen.createFolder(ctx, input);
        break;
      case 'rename_folder':
        result = await leadGen.renameFolder(ctx, input);
        break;
      case 'find_leads':
        result = await leadGen.findLeads(ctx, input);
        break;
      case 'get_search_status':
        result = await leadGen.getSearchStatus(ctx, input);
        break;
      case 'bookmark_leads':
        result = await leadGen.bookmarkLeads(ctx, input);
        break;
      case 'save_script':
        result = await leadGen.saveScript(ctx, input);
        break;
      case 'list_tags':
        result = await leadActions.listTags(ctx);
        break;
      case 'tag_leads':
        result = await leadActions.tagLeads(ctx, input);
        break;
      case 'sync_leads_to_ghl':
        result = await leadActions.syncLeadsToGhl(ctx, input);
        break;
      case 'get_ghl_sync_status':
        result = await leadActions.getGhlSyncStatus(ctx, input);
        break;
      case 'list_team_members':
        result = await ops.listTeamMembers(ctx);
        break;
      case 'move_opportunities':
        result = await ops.moveOpportunities(ctx, input);
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
        if (networkTools.NETWORK_TOOL_NAMES.includes(name)) {
          result = await networkTools.executeNetworkTool(ctx, name, input);
          break;
        }
        if (cadenceTools.CADENCE_TOOL_NAMES.includes(name)) {
          result = await cadenceTools.executeCadenceTool(ctx, name, input);
          break;
        }
        if (leadScriptTools.LEAD_SCRIPT_TOOL_NAMES.includes(name)) {
          result = await leadScriptTools.executeLeadScriptTool(ctx, name, input);
          break;
        }
        if (messagingTools.MESSAGING_TOOL_NAMES.includes(name)) {
          result = await messagingTools.executeMessagingTool(ctx, name, input);
          break;
        }
        if (workspaceTools.WORKSPACE_TOOL_NAMES.includes(name)) {
          result = await workspaceTools.executeWorkspaceTool(ctx, name, input);
          break;
        }
        const err = new Error(`Unknown tool: ${name}`);
        err.code = 'UNKNOWN_TOOL';
        throw err;
      }
    }

    botActivity.recordToolActivity(ctx, name, input, result);
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
  if (toolName === 'create_folder' && Array.isArray(payload.folders)) {
    return `${payload.created} created, ${payload.alreadyExisted} existed`;
  }
  if (toolName === 'find_leads' || toolName === 'get_search_status') {
    const s = payload.search || payload;
    return s && s.status ? `search ${s.status}` : 'ok';
  }
  if (toolName === 'bookmark_leads') {
    return `${payload.changed} changed, ${payload.failed} failed`;
  }
  if (toolName === 'move_opportunities') {
    return `${payload.moved} moved, ${payload.failed} failed`;
  }
  if (toolName === 'save_script' && payload.script) {
    return payload.duplicate ? 'duplicate script' : 'script saved';
  }
  if (toolName === 'list_tags' && Array.isArray(payload.tags)) {
    return `${payload.tags.length} tags`;
  }
  if (toolName === 'tag_leads') {
    return `${payload.changed} changed, ${payload.failed} failed`;
  }
  if (toolName === 'sync_leads_to_ghl' || (toolName === 'get_ghl_sync_status' && payload.job)) {
    const j = payload.job || payload;
    return `ghl ${j.status} ${j.processed}/${j.total}`;
  }
  if (toolName === 'list_team_members' && Array.isArray(payload.members)) {
    return `${payload.members.length} members`;
  }
  return 'ok';
}

const CRM_ACTION_TOOL_SCHEMAS = [
  {
    name: 'list_tags',
    description: 'List the workspace lead tags with how many leads carry each.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'tag_leads',
    description:
      `Add and/or remove tags (by tag NAME) on up to ${leadActions.MAX_TAG_LEADS} leads in one call — same as the Tags menu in the app. ` +
      'Tags in add that do not exist yet are created. For "top N in <folder>", call list_leads with sort and limit first, then pass those lead ids.',
    parameters: {
      type: 'object',
      properties: {
        lead_ids: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: leadActions.MAX_TAG_LEADS },
        add: { type: 'array', items: { type: 'string' }, description: 'Tag names to add, e.g. ["Hot"]' },
        remove: { type: 'array', items: { type: 'string' }, description: 'Tag names to remove' },
      },
      required: ['lead_ids'],
      additionalProperties: false,
    },
  },
  {
    name: 'sync_leads_to_ghl',
    description:
      `Push up to ${leadActions.MAX_GHL_SYNC_LEADS} leads to GoHighLevel (same as the "Sync GHL" button). Returns per-lead created / updated / skipped / error. ` +
      'Large batches keep running in the background after ~30s and return a job_id for get_ghl_sync_status. ' +
      'Fails with GHL_NOT_CONNECTED when the workspace has no GHL connection.',
    parameters: {
      type: 'object',
      properties: {
        lead_ids: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: leadActions.MAX_GHL_SYNC_LEADS },
      },
      required: ['lead_ids'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_ghl_sync_status',
    description: 'Progress and per-lead results of a background GHL sync (omit job_id for recent syncs).',
    parameters: {
      type: 'object',
      properties: { job_id: { type: 'string' } },
      additionalProperties: false,
    },
  },
  {
    name: 'list_team_members',
    description: 'List workspace members (name, email, role) — use it to resolve "Maria" before assigning a task.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
];

function getCrmActionToolSchemas() {
  return CRM_ACTION_TOOL_SCHEMAS.map((t) => ({ ...t }));
}

const ASSIGNEE_DESCRIPTION =
  'Teammate email or name (from list_team_members). The task goes into their own Tasks list. Omit for yourself.';

const LEAD_GEN_TOOL_SCHEMAS = [
  {
    name: 'create_folder',
    description:
      'Create real LEAD FOLDER(S) in Folder manager (where leads live). Use this whenever the user says "folder(s)". ' +
      'NOT an Opportunity pipeline. Idempotent: an existing folder with the same name (case-insensitive) is returned with existed=true. ' +
      'Pass names[] to create several at once (max 25), e.g. one folder per trade.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Folder name (single folder)' },
        names: {
          type: 'array',
          items: { type: 'string' },
          maxItems: 25,
          description: 'Several folder names to create in one call',
        },
        parent_folder_id: { type: 'string', description: 'Optional parent folder key (nest inside)' },
        parent_folder_name: { type: 'string', description: 'Optional parent folder name (nest inside)' },
        description: { type: 'string', description: 'Optional note stored on a single new folder' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'rename_folder',
    description: 'Rename a lead folder (by folder_id or folder_name).',
    parameters: {
      type: 'object',
      properties: {
        folder_id: { type: 'string' },
        folder_name: { type: 'string' },
        new_name: { type: 'string' },
      },
      required: ['new_name'],
      additionalProperties: false,
    },
  },
  {
    name: 'find_leads',
    description:
      'Run a NEW Google Maps lead search (same as Find leads / folder Run search) and save results as leads into a lead folder. ' +
      'Use for "find N <trade> in <city>", prospecting, and referral partners (search each partner trade). ' +
      'Runs in the background and returns immediately with a search_id (status running or queued); leads appear in a few minutes, duplicates merge. ' +
      'Target folder: folder_id, or folder_name (created if missing), default = a folder named after the query. ' +
      `max_results default ${leadGen.DEFAULT_MAX_RESULTS}, hard cap ${leadGen.MAX_RESULTS_CAP}. ` +
      'Do NOT use search_leads for this — search_leads only searches leads already in the CRM. ' +
      'To add trades (seats) to the referral network itself, use manage_network_trades instead.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Trade / business type, e.g. "Interior Designers"' },
        location: { type: 'string', description: 'City and US state, e.g. "Camas, WA"' },
        city: { type: 'string' },
        state: { type: 'string', description: '2-letter US state, e.g. WA' },
        max_results: {
          type: 'integer',
          minimum: 1,
          maximum: leadGen.MAX_RESULTS_CAP,
          description: `Default ${leadGen.DEFAULT_MAX_RESULTS}`,
        },
        folder_id: { type: 'string', description: 'Existing lead folder key to save into' },
        folder_name: { type: 'string', description: 'Lead folder name to save into (created if missing)' },
        parent_folder_name: { type: 'string', description: 'Parent for a newly created folder' },
        min_rating: { type: 'number', minimum: 0, maximum: 5 },
        min_reviews: { type: 'integer', minimum: 0 },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_search_status',
    description:
      'Check background lead searches started by find_leads (running / queued / completed / failed, new leads saved). Omit search_id for recent searches.',
    parameters: {
      type: 'object',
      properties: { search_id: { type: 'string' } },
      additionalProperties: false,
    },
  },
  {
    name: 'bookmark_leads',
    description:
      'Bookmark (or unbookmark with bookmarked=false) up to 100 leads by lead_id. For "top N in <folder> by rating/reviews/score", ' +
      'first call list_leads with sort and limit, then pass those lead ids.',
    parameters: {
      type: 'object',
      properties: {
        lead_ids: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 100 },
        bookmarked: { type: 'boolean', description: 'Default true; false removes the bookmark' },
      },
      required: ['lead_ids'],
      additionalProperties: false,
    },
  },
  {
    name: 'save_script',
    description:
      'Save a call script, SMS or email template. You write the body yourself; use merge tags {{name}}, {{company}}, {{city}}. ' +
      'Set section "sms" for text messages, "email" for emails and "dm" for Instagram/Facebook/LinkedIn DMs (for one lead only, use save_lead_script). ' +
      'When the script belongs to an offer/service (e.g. "the Overflow script", "for Overflow Referral"), set offer to its name: the text goes into that offer\'s Call/SMS/Email box on Scripts → By offer (a new offer is created if none matches). ' +
      'Without offer it goes to Scripts → Saved library. ' +
      'Optional folder_id/folder_name tags the script with that folder (the app has no per-folder scripts; the folder name goes in the title).',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Script title' },
        body: { type: 'string', description: 'Full script text' },
        section: {
          type: 'string',
          enum: ['opening', 'discovery', 'valueProp', 'objectionHandling', 'close', 'sms', 'email', 'dm'],
          description: 'Default opening',
        },
        folder_id: { type: 'string' },
        folder_name: { type: 'string' },
        offer: { type: 'string', description: 'Offer name (or key) on Scripts → By offer to save into, e.g. "Overflow Referral"' },
        offer_key: { type: 'string', description: 'Same as offer, by key' },
      },
      required: ['name', 'body'],
      additionalProperties: false,
    },
  },
  {
    name: 'move_opportunities',
    description:
      'Send many leads (max 100) to an Opportunity pipeline stage in one call. Pipeline by pipeline_id or pipeline_name (default active); ' +
      'stage by stage_id or stage_name (default: a "Review" stage if present, else the first stage). Returns per-lead results.',
    parameters: {
      type: 'object',
      properties: {
        lead_ids: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 100 },
        pipeline_id: { type: 'string' },
        pipeline_name: { type: 'string' },
        stage_id: { type: 'string' },
        stage_name: { type: 'string' },
      },
      required: ['lead_ids'],
      additionalProperties: false,
    },
  },
];

function getLeadGenToolSchemas() {
  return LEAD_GEN_TOOL_SCHEMAS.map((t) => ({ ...t }));
}

function getOpenAiFunctionTools() {
  return [
    ...LEAD_GEN_TOOL_SCHEMAS.map((t) => ({ type: 'function', function: { ...t } })),
    ...CRM_ACTION_TOOL_SCHEMAS.map((t) => ({ type: 'function', function: { ...t } })),
    ...networkTools.openAiFunctionTools(),
    ...cadenceTools.openAiFunctionTools(),
    ...leadScriptTools.openAiFunctionTools(),
    ...messagingTools.openAiFunctionTools(),
    ...workspaceTools.openAiFunctionTools(),
    {
      type: 'function',
      function: {
        name: 'list_folders',
        description:
          'List all lead folders (Folder manager) in the workspace with lead counts. Lead folders are not Opportunity pipelines.',
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
        description: LIST_LEADS_DESCRIPTION,
        parameters: {
          type: 'object',
          properties: {
            folder_id: { type: 'string' },
            folder_name: { type: 'string' },
            limit: { type: 'integer', minimum: 1, maximum: 100 },
            offset: { type: 'integer', minimum: 0 },
            sort: { type: 'string', enum: ['name', 'rating', 'reviews', 'score', 'newest', 'recent'] },
            bookmarked_only: { type: 'boolean' },
            ...LIST_LEADS_FILTER_JSON,
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
        description:
          'Update CRM/enrichment fields on a lead (status, phone, email, tags, folderKey, opportunityValue deal value, etc.). Use add_lead_note for notes and assign_leads for owners.',
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
        description:
          'Search leads ALREADY in the CRM by company, email, phone, website, or tags. To discover new businesses use find_leads.',
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
        description:
          'Create a new Opportunity pipeline (deal board with stages) from a template. Only when the user explicitly asks for a pipeline/board — never as a substitute for lead folders.',
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
        description:
          'Move one lead to an Opportunity pipeline stage (stage_id or stage_name; default Review/first stage). For many leads use move_opportunities.',
        parameters: {
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
        description:
          'List manual tasks for the signed-in user, or for a teammate with assignee (optional column or lead filter).',
        parameters: {
          type: 'object',
          properties: {
            column: { type: 'string', description: 'backlog | todo | doing | done' },
            lead_id: { type: 'string' },
            assignee: { type: 'string', description: 'Teammate email or name; omit for your own tasks' },
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
        description:
          'Create a task for the signed-in user or assign it to a teammate (assignee), optionally linked to a lead and due at a date/time. ' +
          'A lead can have several open tasks.',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            column: { type: 'string' },
            lead_id: { type: 'string' },
            assignee: { type: 'string', description: ASSIGNEE_DESCRIPTION },
            scheduled_at: {
              type: 'string',
              description: 'Due date/time as ISO 8601 with the user timezone offset, e.g. 2026-10-01T10:00:00-07:00',
            },
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
        description:
          "Update a task (title, column, due date, lead link) — yours or one in a teammate's list. assignee reassigns it to that teammate.",
        parameters: {
          type: 'object',
          properties: {
            task_id: { type: 'string' },
            title: { type: 'string' },
            column: { type: 'string' },
            lead_id: { type: 'string' },
            assignee: { type: 'string', description: 'Reassign to this teammate (email or name)' },
            scheduled_at: { type: 'string', description: 'Due date/time, ISO 8601' },
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
  getLeadGenToolSchemas,
  getCrmActionToolSchemas,
  LIST_LEADS_DESCRIPTION,
  LIST_LEADS_FILTER_JSON,
};
