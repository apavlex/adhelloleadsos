/**
 * Lead sourcing beyond Google Maps for MCP clients (Grok, Manus, ChatGPT, Claude) and Ask AI:
 * building permits, new business registrations, property / product listings, saved folder searches,
 * recurring search schedules, CSV import, duplicate cleanup and single-purpose enrichment.
 * Searches share find_leads' background queue, so get_search_status tracks them all.
 */
const { z } = require('zod/v3');
const { zodToJsonSchema } = require('zod-to-json-schema');
const dbService = require('../database');
const workspaceIntegrations = require('../workspaceIntegrations');
const { filterLeadsForRequest } = require('../workspaceService');
const { JOB_TYPES, JOB_TYPE_LABELS, normalizeJobType, isListingJobType, scheduleDisplayTitle } = require('../scrapeJobTypes');
const { jobTypeRequiresLocation } = require('../searchTypeConfig');
const { normalizeSearchPreset, describeSearchPreset } = require('../folderSearchPreset');
const { resolveFolderSearchRun } = require('../folderSearchRun');
const { resolveTargetFolder } = require('../pipelineFolders');
const scrapeJobRunner = require('../scrapeJobRunner');
const { parseSchedulePayload, scheduleFrequencyLabel } = require('../scheduleHelpers');
const { computeScheduleNextRun } = require('../automationsRegistry');
const { resolveWorkspaceTimezone } = require('../workspaceTimezone');
const { PERMIT_STACK_CATEGORIES } = require('../permitStackCategories');
const { FORMATION_STATES, ENTITY_TYPES } = require('../businessFormationConstants');
const leadSourceRuns = require('../leadSourceRuns');
const { importLeadsFromCsv } = require('../leadImportRun');
const { mergeLeadsByKeys } = require('../leadMerge');
const { computeDedupeKey } = require('../leadDedupe');
const leadDeepEnrich = require('../leadDeepEnrich');
const leadGen = require('./mcpLeadGen');
const { buildReqLike, resolveFolderRef, resolveLeadKey } = require('./mcpCrmService');

const SOURCES = ['permits', 'business_formations', 'real_estate', 'home_owners', 'products', 'wholesale'];
const SCHEDULE_SOURCES = ['maps', 'business_formations', 'real_estate', 'home_owners', 'products', 'wholesale'];
const PRESET_SOURCES = ['maps', 'real_estate', 'home_owners', 'products', 'wholesale'];
const ENRICH_STEPS = ['reviews', 'socials', 'phone_line_type'];
const MAX_CSV_CHARS = 2_000_000;
const MAX_MERGE = 20;
const MAX_DUPLICATE_GROUPS = 50;

function toolError(message, code = 'LEAD_SOURCE_ERROR') {
  const err = new Error(message);
  err.code = code;
  return err;
}

function jobTypeFor(source) {
  return source === 'maps' ? JOB_TYPES.MAPS_BUSINESS : normalizeJobType(source);
}

function sourceLabel(jobType) {
  if (jobType === JOB_TYPES.PERMITS) return 'Building permits';
  if (jobType === JOB_TYPES.BUSINESS_FORMATIONS) return 'New business registrations';
  return JOB_TYPE_LABELS[jobType] || jobType;
}

async function integrationEnvFor(ctx) {
  return workspaceIntegrations.getResolvedIntegrationEnv(ctx.workspaceId);
}

/** folder_id → that folder; folder_name → existing folder with that name, else created; neither → the source's default folder. */
async function resolveSourceFolder(ctx, input, jobType) {
  const wid = ctx.workspaceId;
  if (input.folder_id) return resolveFolderRef(wid, { folder_id: input.folder_id });
  const name = String(input.folder_name || '').replace(/\s+/g, ' ').trim();
  if (name) {
    const folders = await dbService.listFolders(wid);
    const existing = folders.find((f) => f && f.key && String(f.name || '').trim().toLowerCase() === name.toLowerCase());
    if (existing) return existing;
  }
  const resolved = await resolveTargetFolder(wid, { jobType, newFolderName: name });
  if (resolved.error || !resolved.targetFolderKey) {
    throw toolError(resolved.error || 'Pass folder_id or folder_name.', 'INVALID_ARGUMENTS');
  }
  return (
    (await dbService.getFolder(wid, resolved.targetFolderKey)) || {
      key: resolved.targetFolderKey,
      name: resolved.targetFolderName,
    }
  );
}

/** Folder args for the permit / formation resolvers, which only create a new folder once the search input is valid. */
async function folderTarget(ctx, input) {
  if (input.folder_id) {
    return { folderKey: (await resolveFolderRef(ctx.workspaceId, { folder_id: input.folder_id })).key };
  }
  const name = String(input.folder_name || '').replace(/\s+/g, ' ').trim();
  if (!name) return {};
  const folders = await dbService.listFolders(ctx.workspaceId);
  const existing = folders.find((f) => f && f.key && String(f.name || '').trim().toLowerCase() === name.toLowerCase());
  return existing ? { folderKey: existing.key } : { newFolderName: name };
}

function folderFromResolved(resolvedFolder) {
  return { key: resolvedFolder.targetFolderKey, name: resolvedFolder.targetFolderName };
}

function formationInput(input, extra) {
  return {
    formationStates: input.states && input.states.length ? input.states : input.state ? [input.state] : [],
    entityTypes: input.entity_types,
    keyword: input.query,
    maxResults: input.max_results,
    ...extra,
  };
}

function listingPreset(jobType, input, location) {
  return normalizeSearchPreset({
    jobType,
    query: input.query,
    city: location.city,
    state: location.state,
    minPrice: input.min_price,
    maxPrice: input.max_price,
    sources: input.listing_sources,
    maxResults: input.max_results,
  });
}

function startedMessage(job, what) {
  if (job.status === 'running') {
    return `${what} search started in the background → folder "${job.folderName}". New leads land there in a few minutes (duplicates merge). Use get_search_status to check.`;
  }
  if (job.status === 'queued') {
    return `Another search is running, so this ${what.toLowerCase()} search is queued and will start automatically → folder "${job.folderName}".`;
  }
  return job.error || 'Search could not start.';
}

function searchOut(job, what, extra = {}) {
  return {
    search_id: job.id,
    status: job.status,
    source: job.source,
    folder: { key: job.folderKey, name: job.folderName },
    ...(job.error ? { error: job.error } : {}),
    ...extra,
    async: true,
    message: startedMessage(job, what),
  };
}

const locationFields = {
  location: z.string().optional().describe('"City, ST" (e.g. "Austin, TX"). Or pass city + state.'),
  city: z.string().optional(),
  state: z.string().optional().describe('2-letter US state'),
};

const folderFields = {
  folder_id: z.string().optional().describe('Existing folder key to save leads into'),
  folder_name: z.string().optional().describe('Folder name to save into (reused if it exists, otherwise created)'),
};

// ── Lead source search ──────────────────────────────────────────────────────

async function searchPermits(ctx, input, env) {
  const location = leadGen.parseLocation(input);
  const resolved = await leadSourceRuns.resolvePermitSearch(
    ctx.workspaceId,
    {
      city: location.city || input.city,
      state: location.state,
      category: input.permit_category,
      keyword: input.query,
      contractor: input.contractor,
      zip: input.zip,
      filedAfter: input.filed_after,
      maxResults: input.max_results,
      ...(await folderTarget(ctx, input)),
    },
    env
  );
  if (!resolved.ok) throw toolError(resolved.error, resolved.status === 503 ? 'PROVIDER_NOT_CONFIGURED' : 'INVALID_ARGUMENTS');
  const { params } = resolved;
  const folder = folderFromResolved(resolved.folder);
  const job = await leadGen.enqueueSearch(ctx, {
    folder,
    keyword: params.category || params.keyword || 'permits',
    city: params.city,
    state: params.state,
    maxResults: params.maxResults,
    source: 'permits',
    sourceLabel: 'permit',
    start: async () =>
      leadSourceRuns.runPermitSearchInBackground({
        workspaceId: ctx.workspaceId,
        integrationEnv: await integrationEnvFor(ctx),
        params,
        folder: resolved.folder,
        actorEmail: ctx.userEmail,
      }),
  });
  return searchOut(job, 'Permit', { city: params.city, state: params.state, zip: params.zip, category: params.category || 'all' });
}

async function searchFormations(ctx, input, env) {
  const resolved = await leadSourceRuns.resolveFormationSearch(
    ctx.workspaceId,
    formationInput(input, { registeredAfter: input.registered_after, ...(await folderTarget(ctx, input)) }),
    env
  );
  if (!resolved.ok) throw toolError(resolved.error, 'INVALID_ARGUMENTS');
  if (!resolved.configured) throw toolError(resolved.notConfiguredError, 'PROVIDER_NOT_CONFIGURED');
  const folder = folderFromResolved(resolved.folder);
  const job = await leadGen.enqueueSearch(ctx, {
    folder,
    keyword: resolved.jobParams.keyword,
    state: resolved.jobParams.state,
    maxResults: resolved.params.maxResults,
    source: 'business_formations',
    sourceLabel: 'new business',
    start: async () =>
      leadSourceRuns.runFormationSearchInBackground({
        workspaceId: ctx.workspaceId,
        integrationEnv: await integrationEnvFor(ctx),
        resolved,
        actorEmail: ctx.userEmail,
      }),
  });
  return searchOut(job, 'New business', { states: resolved.params.stateCodes });
}

async function searchListings(ctx, input, env, jobType) {
  const location = leadGen.parseLocation(input);
  if (jobTypeRequiresLocation(jobType) && (!location.city || !location.state)) {
    throw toolError('A city and US state are required, e.g. location "Tampa, FL".', 'NEED_LOCATION');
  }
  const preset = listingPreset(jobType, input, location);
  if (!scrapeJobRunner.isJobConfigured(preset, env)) {
    throw toolError(
      'Listing search requires Apify and/or SerpAPI keys. Add them under Workspace → API integrations.',
      'PROVIDER_NOT_CONFIGURED'
    );
  }
  const folder = await resolveSourceFolder(ctx, input, jobType);
  const job = await leadGen.enqueueSearch(ctx, {
    folder,
    keyword: preset.query,
    city: preset.city || '',
    state: preset.state || '',
    maxResults: preset.maxResults,
    preset,
    source: jobType,
    sourceLabel: sourceLabel(jobType).toLowerCase(),
  });
  return searchOut(job, sourceLabel(jobType), { query: preset.query, city: preset.city || '', state: preset.state || '' });
}

// ── Schedules ───────────────────────────────────────────────────────────────

function scheduleOut(s) {
  return {
    schedule_id: s.key,
    title: scheduleDisplayTitle(s),
    source: normalizeJobType(s.jobType) === JOB_TYPES.MAPS_BUSINESS ? 'maps' : normalizeJobType(s.jobType),
    query: s.keyword || s.query || '',
    city: s.city || '',
    state: s.state || '',
    max_results: s.maxResults || null,
    folder: s.targetFolderKey ? { key: s.targetFolderKey, name: s.targetFolderName || '' } : null,
    repeat: s.scheduledRunAt ? 'once' : s.frequency || 'daily',
    frequency_label: scheduleFrequencyLabel(s),
    time: s.scheduledTime || '',
    timezone: s.timezone || 'UTC',
    next_run: computeScheduleNextRun(s),
    last_run: s.lastRun || null,
  };
}

async function workspaceSchedules(ctx) {
  const all = await dbService.listSchedules();
  return all.filter((s) => s && String(s.workspaceId || '') === String(ctx.workspaceId));
}

async function scheduleJobPayload(ctx, input, jobType, env) {
  if (jobType === JOB_TYPES.BUSINESS_FORMATIONS) {
    const resolved = await leadSourceRuns.resolveFormationSearch(
      ctx.workspaceId,
      formationInput(input, await folderTarget(ctx, input)),
      env,
      { monitor: true }
    );
    if (!resolved.ok) throw toolError(resolved.error, 'INVALID_ARGUMENTS');
    if (!resolved.configured) throw toolError(resolved.notConfiguredError, 'PROVIDER_NOT_CONFIGURED');
    return { ...resolved.jobParams, monitorMode: true };
  }

  const location = leadGen.parseLocation(input);
  if (jobType === JOB_TYPES.MAPS_BUSINESS) {
    const keyword = String(input.query || '').trim();
    if (!keyword || !location.city || !location.state) {
      throw toolError('query (the trade, e.g. "roofers") plus a city and US state are required.', 'INVALID_ARGUMENTS');
    }
    const folder = await resolveSourceFolder(ctx, input, jobType);
    return {
      jobType,
      keyword,
      city: location.city,
      state: location.state,
      maxResults: Math.min(100, Math.max(1, parseInt(input.max_results, 10) || 20)),
      targetFolderKey: folder.key,
      targetFolderName: folder.name,
    };
  }

  if (jobTypeRequiresLocation(jobType) && (!location.city || !location.state)) {
    throw toolError('A city and US state are required, e.g. location "Tampa, FL".', 'NEED_LOCATION');
  }
  const preset = listingPreset(jobType, input, location);
  const folder = await resolveSourceFolder(ctx, input, jobType);
  return {
    jobType,
    city: preset.city || '',
    state: preset.state || '',
    query: preset.query,
    sources: preset.sources,
    maxResults: preset.maxResults,
    minPrice: preset.minPrice,
    maxPrice: preset.maxPrice,
    flipFilter: { enabled: false },
    targetFolderKey: folder.key,
    targetFolderName: folder.name,
  };
}

// ── Duplicates ──────────────────────────────────────────────────────────────

function duplicateLeadOut(lead) {
  return {
    id: lead.key,
    business: lead.title || '',
    phone: lead.phone && lead.phone !== 'N/A' ? lead.phone : '',
    website: lead.website && lead.website !== 'N/A' ? lead.website : '',
    city: lead.city || '',
    state: lead.state || '',
    folder_id: lead.folderKey || '',
    status: lead.status || '',
    updated_at: lead.updatedAt || lead.createdAt || null,
  };
}

const LEAD_SOURCE_TOOLS = [
  {
    name: 'search_lead_source',
    description:
      'Find leads from sources other than Google Maps and save them into a folder (runs in the background, one search at a time; ' +
      'track with get_search_status). Sources: "permits" = recent building permits (homeowners/contractors doing solar, roofing, ' +
      'HVAC, etc. — needs a supported Permit Stack city or a ZIP), "business_formations" = newly registered businesses (states NY, CO, ' +
      'PA, CT, OR), "real_estate" = property listings (incl. mobile homes/land), "home_owners" = homeowner listings, "products" and ' +
      '"wholesale" = product/wholesale listings. For local businesses by trade use find_leads instead.',
    schema: z.object({
      source: z.enum(SOURCES),
      query: z
        .string()
        .optional()
        .describe('Search terms: permit keyword, business-name keyword for formations, or listing search terms'),
      ...locationFields,
      zip: z.string().optional().describe('Permits: ZIP code (alternative to city)'),
      permit_category: z
        .string()
        .optional()
        .describe(`Permits: ${PERMIT_STACK_CATEGORIES.filter((c) => c.value).map((c) => c.value).join(', ')}`),
      contractor: z.string().optional().describe('Permits: contractor name filter'),
      filed_after: z.string().optional().describe('Permits: only permits filed on/after YYYY-MM-DD'),
      states: z
        .array(z.string())
        .optional()
        .describe(`Formations: ${FORMATION_STATES.map((s) => s.code).join(', ')}`),
      entity_types: z
        .array(z.string())
        .optional()
        .describe(`Formations: ${ENTITY_TYPES.map((e) => e.value).join(', ')}`),
      registered_after: z.string().optional().describe('Formations: registered on/after YYYY-MM-DD (default last 30 days)'),
      min_price: z.number().optional().describe('Listings: minimum price'),
      max_price: z.number().optional().describe('Listings: maximum price'),
      listing_sources: z.array(z.string()).optional().describe('Listings: specific scrapers (default: recommended for the type)'),
      max_results: z.number().int().min(1).max(100).optional(),
      ...folderFields,
    }),
    async run(ctx, input) {
      const env = await integrationEnvFor(ctx);
      const jobType = jobTypeFor(input.source);
      if (jobType === JOB_TYPES.PERMITS) return searchPermits(ctx, input, env);
      if (jobType === JOB_TYPES.BUSINESS_FORMATIONS) return searchFormations(ctx, input, env);
      return searchListings(ctx, input, env, jobType);
    },
  },
  {
    name: 'run_folder_search',
    description:
      "Re-run a folder's saved search (its search preset, else its last search / workspace ICP) and merge new leads into that folder. " +
      'Runs in the background; track with get_search_status.',
    schema: z.object({
      folder_id: z.string().optional(),
      folder_name: z.string().optional(),
    }),
    async run(ctx, input) {
      const folder = await resolveFolderRef(ctx.workspaceId, input);
      const resolved = await resolveFolderSearchRun(ctx.workspaceId, folder.key);
      if (!resolved.ok) throw toolError(resolved.error || 'This folder has no search to run.', 'INVALID_ARGUMENTS');
      const preset = resolved.preset;
      const jobType = normalizeJobType(preset.jobType);
      if (jobType === JOB_TYPES.PERMITS) {
        throw toolError('Permit folders run through search_lead_source with source "permits".', 'INVALID_ARGUMENTS');
      }
      const job = await leadGen.enqueueSearch(ctx, {
        folder: resolved.folder,
        keyword: preset.keyword || preset.query || resolved.folder.name,
        city: preset.city || '',
        state: preset.state || '',
        maxResults: preset.maxResults,
        preset,
        source: jobType === JOB_TYPES.MAPS_BUSINESS ? 'maps' : jobType,
      });
      return searchOut(job, 'Folder', { search: describeSearchPreset(preset) });
    },
  },
  {
    name: 'save_folder_search',
    description:
      "Save a folder's search preset (what run_folder_search and the folder's Run search button use): source, query, location, " +
      'filters and max results.',
    schema: z.object({
      folder_id: z.string().optional(),
      folder_name: z.string().optional(),
      source: z.enum(PRESET_SOURCES).default('maps'),
      query: z.string().describe('Trade / business type for maps (e.g. "roofers"), or listing search terms'),
      ...locationFields,
      min_rating: z.number().min(0).max(5).optional().describe('Maps: minimum Google rating'),
      min_reviews: z.number().int().min(0).optional().describe('Maps: minimum Google review count'),
      min_price: z.number().optional().describe('Listings: minimum price'),
      max_price: z.number().optional().describe('Listings: maximum price'),
      max_results: z.number().int().min(1).max(100).optional(),
    }),
    async run(ctx, input) {
      const folder = await resolveFolderRef(ctx.workspaceId, input);
      const jobType = jobTypeFor(input.source);
      const location = leadGen.parseLocation(input);
      const preset = isListingJobType(jobType)
        ? listingPreset(jobType, input, location)
        : normalizeSearchPreset(
            {
              jobType,
              keyword: input.query,
              city: location.city,
              state: location.state,
              minRating: input.min_rating,
              minReviews: input.min_reviews,
              maxResults: input.max_results,
            },
            { defaultKeyword: '' }
          );
      if (!preset || !(preset.keyword || preset.query)) throw toolError('query is required.', 'INVALID_ARGUMENTS');
      await dbService.updateFolder(ctx.workspaceId, folder.key, { searchPreset: preset });
      return {
        success: true,
        folder: { key: folder.key, name: folder.name },
        search: describeSearchPreset(preset),
        next_steps: 'Call run_folder_search to run it now.',
      };
    },
  },
  {
    name: 'list_search_schedules',
    description: 'List scheduled / recurring lead searches in this workspace with their next and last run times.',
    schema: z.object({}),
    async run(ctx) {
      const schedules = (await workspaceSchedules(ctx)).map(scheduleOut);
      schedules.sort((a, b) => String(a.next_run || '').localeCompare(String(b.next_run || '')));
      return { count: schedules.length, schedules };
    },
  },
  {
    name: 'schedule_search',
    description:
      'Schedule a lead search to run once later or repeat daily / weekly / monthly. Sources: "maps" (local businesses by trade + city), ' +
      '"business_formations" (new registrations, monitor mode), or listing types. Each run merges new leads into the folder ' +
      '(duplicates merge). To search right now use find_leads / search_lead_source instead.',
    schema: z.object({
      source: z.enum(SCHEDULE_SOURCES),
      query: z.string().optional().describe('Maps: the trade (required). Formations: name keyword. Listings: search terms.'),
      ...locationFields,
      states: z.array(z.string()).optional().describe(`Formations: ${FORMATION_STATES.map((s) => s.code).join(', ')}`),
      entity_types: z.array(z.string()).optional().describe(`Formations: ${ENTITY_TYPES.map((e) => e.value).join(', ')}`),
      min_price: z.number().optional(),
      max_price: z.number().optional(),
      max_results: z.number().int().min(1).max(100).optional(),
      ...folderFields,
      repeat: z.enum(['once', 'daily', 'weekly', 'monthly']),
      time: z.string().default('09:00').describe('Run time HH:mm (24h) in timezone'),
      date: z.string().optional().describe('For repeat "once": run date YYYY-MM-DD (must be in the future)'),
      timezone: z.string().optional().describe('IANA timezone, e.g. America/Chicago (default: workspace timezone)'),
    }),
    async run(ctx, input) {
      const ws = (await dbService.getWorkspace(ctx.workspaceId)) || {};
      const parsed = parseSchedulePayload({
        scheduleKind: input.repeat === 'once' ? 'once' : 'recurring',
        frequency: input.repeat === 'once' ? undefined : input.repeat,
        scheduledTime: input.time,
        scheduledDate: input.date,
        timezone: resolveWorkspaceTimezone(input.timezone || ws),
      });
      if (!parsed.ok) throw toolError(parsed.message, 'INVALID_ARGUMENTS');

      const env = await integrationEnvFor(ctx);
      const job = await scheduleJobPayload(ctx, input, jobTypeFor(input.source), env);
      const record = { ...job, ...parsed.data, createdAt: new Date().toISOString(), workspaceId: ctx.workspaceId };
      const key = await dbService.saveSchedule(record);
      return { success: true, schedule: scheduleOut({ key, ...record, lastRun: null }) };
    },
  },
  {
    name: 'delete_search_schedule',
    description: 'Delete a scheduled lead search (schedule_id from list_search_schedules).',
    schema: z.object({ schedule_id: z.string() }),
    async run(ctx, input) {
      const schedule = (await workspaceSchedules(ctx)).find((s) => s.key === input.schedule_id);
      if (!schedule) throw toolError('Schedule not found in this workspace.', 'NOT_FOUND');
      await dbService.deleteSchedule(schedule.key);
      return { success: true, deleted: scheduleOut(schedule) };
    },
  },
  {
    name: 'import_leads_csv',
    description:
      'Import leads from CSV (or TSV) text — header row plus one business per row (name/company, phone, email, website, address, ' +
      'city, state, etc.; common export column names are recognized). Existing leads are matched and updated instead of duplicated. ' +
      `Up to ${MAX_CSV_CHARS.toLocaleString('en-US')} characters per call.`,
    schema: z.object({
      csv_text: z.string().min(1).max(MAX_CSV_CHARS),
      file_name: z.string().optional().describe('Original file name (helps detect format), e.g. "leads.csv"'),
      ...folderFields,
    }),
    async run(ctx, input) {
      let folderKey = '';
      if (input.folder_id) folderKey = (await resolveFolderRef(ctx.workspaceId, { folder_id: input.folder_id })).key;
      const result = await importLeadsFromCsv({
        workspaceId: ctx.workspaceId,
        csvContent: input.csv_text,
        fileName: input.file_name || 'import.csv',
        leadSource: 'csv_import',
        folderKey,
        folderName: folderKey ? '' : input.folder_name,
      });
      return {
        success: true,
        created: result.created,
        updated: result.updated,
        failed: result.failed,
        skipped_without_name: result.skipped,
        folder: result.folderKey ? { key: result.folderKey, name: result.folderName || '' } : null,
        lead_ids: result.keys.slice(0, 200),
      };
    },
  },
  {
    name: 'find_duplicate_leads',
    description:
      'Find likely duplicate leads (same Google listing, website, email, phone, or name + city). Returns groups; pass a group to ' +
      'merge_leads to combine them.',
    schema: z.object({
      folder_id: z.string().optional().describe('Only look inside this folder'),
      limit: z.number().int().min(1).max(MAX_DUPLICATE_GROUPS).default(20),
    }),
    async run(ctx, input) {
      let leads = filterLeadsForRequest(
        buildReqLike(ctx.workspaceId, ctx.userEmail),
        await dbService.getAllLeads(ctx.workspaceId)
      );
      if (input.folder_id) {
        const folder = await resolveFolderRef(ctx.workspaceId, { folder_id: input.folder_id });
        leads = leads.filter((l) => String(l.folderKey || '') === String(folder.key));
      }
      const groups = new Map();
      for (const lead of leads) {
        const key = computeDedupeKey(lead);
        if (!key) continue;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(lead);
      }
      const dupes = [...groups.entries()]
        .filter(([, list]) => list.length > 1)
        .sort((a, b) => b[1].length - a[1].length);
      return {
        groups_found: dupes.length,
        groups: dupes.slice(0, input.limit).map(([matchKey, list]) => ({
          matched_on: matchKey.split(':')[0],
          leads: list.map(duplicateLeadOut),
        })),
      };
    },
  },
  {
    name: 'merge_leads',
    description:
      `Merge 2–${MAX_MERGE} duplicate leads into one. The primary keeps its id; blank fields, contacts, notes, tags and history ` +
      'from the others are folded in, then the others are deleted. Cannot be undone.',
    schema: z.object({
      lead_ids: z.array(z.string()).min(2).max(MAX_MERGE),
      primary_lead_id: z.string().optional().describe('Lead to keep (default: the first id)'),
    }),
    async run(ctx, input) {
      const resolved = [];
      for (const id of input.lead_ids) {
        // eslint-disable-next-line no-await-in-loop
        resolved.push((await resolveLeadKey(ctx.workspaceId, id)).fullKey);
      }
      const primary = input.primary_lead_id ? (await resolveLeadKey(ctx.workspaceId, input.primary_lead_id)).fullKey : resolved[0];
      if (!resolved.includes(primary)) resolved.unshift(primary);
      const result = await mergeLeadsByKeys({ dbService, workspaceId: ctx.workspaceId, keys: resolved, primaryKey: primary });
      if (!result.success) throw toolError(result.error, 'MERGE_FAILED');
      return {
        success: true,
        primary_lead_id: result.primaryKey,
        business: (result.lead && result.lead.title) || '',
        merged_count: result.mergedCount,
        deleted_lead_ids: result.mergedAwayKeys,
      };
    },
  },
  {
    name: 'deep_enrich_lead',
    description:
      'Targeted enrichment on one lead: "reviews" = refresh Google rating, review count and recent reviews (Outscraper); ' +
      '"socials" = find Instagram / TikTok / X / Facebook / LinkedIn profiles (TikHub); "phone_line_type" = mobile vs landline + ' +
      'carrier (SignalWire lookup — tells you if a number can take texts). For emails/phones use enrich_lead or find_contacts.',
    schema: z.object({
      lead_id: z.string(),
      steps: z.array(z.enum(ENRICH_STEPS)).min(1).describe('Which lookups to run (each is a paid provider call)'),
    }),
    async run(ctx, input) {
      const { lead: initial, fullKey } = await resolveLeadKey(ctx.workspaceId, input.lead_id);
      let lead = { ...initial, key: fullKey };
      const results = {};
      const runners = {
        reviews: leadDeepEnrich.runReviewsRefresh,
        socials: leadDeepEnrich.runSocialEnrichment,
        phone_line_type: leadDeepEnrich.verifyPhoneLine,
      };
      for (const step of [...new Set(input.steps)]) {
        let r;
        try {
          // eslint-disable-next-line no-await-in-loop
          r = await runners[step](lead, ctx.workspaceId);
        } catch (e) {
          r = { success: false, error: (e && e.message) || `${step} failed` };
        }
        if (r.lead) lead = { ...r.lead, key: fullKey };
        if (step === 'reviews') {
          results.reviews = r.success
            ? {
                ok: true,
                rating: lead.rating || null,
                review_count: (lead.reviewsCount != null ? lead.reviewsCount : lead.reviews) || null,
                reviews_fetched: !!r.reviewsFetched,
              }
            : { ok: false, error: r.error };
        } else if (step === 'socials') {
          results.socials = r.success
            ? {
                ok: true,
                found: r.socialsFound || [],
                ...(r.message ? { message: r.message } : {}),
                profiles: Object.fromEntries(
                  ['instagram', 'tiktok', 'twitter', 'facebook', 'linkedin']
                    .filter((k) => lead[k] && lead[k] !== 'N/A')
                    .map((k) => [k, lead[k]])
                ),
              }
            : { ok: false, error: r.error };
        } else {
          results.phone_line_type = r.success
            ? { ok: true, line_type: r.lineType || '', carrier: r.carrier || '', phone: lead.phone || '' }
            : { ok: false, error: r.error, code: r.code };
        }
      }
      return { lead_id: fullKey, business: lead.title || '', results };
    },
  },
];

const BY_NAME = Object.fromEntries(LEAD_SOURCE_TOOLS.map((t) => [t.name, t]));
const LEAD_SOURCE_TOOL_NAMES = LEAD_SOURCE_TOOLS.map((t) => t.name);

async function executeLeadSourceTool(ctx, name, input) {
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
  return LEAD_SOURCE_TOOLS.map((tool) => {
    const { $schema, ...parameters } = zodToJsonSchema(tool.schema, { target: 'openApi3' });
    return { type: 'function', function: { name: tool.name, description: tool.description, parameters } };
  });
}

module.exports = {
  LEAD_SOURCE_TOOLS,
  LEAD_SOURCE_TOOL_NAMES,
  READ_ONLY_LEAD_SOURCE_TOOLS: ['list_search_schedules', 'find_duplicate_leads'],
  DESTRUCTIVE_LEAD_SOURCE_TOOLS: ['delete_search_schedule', 'merge_leads'],
  OPEN_WORLD_LEAD_SOURCE_TOOLS: ['search_lead_source', 'run_folder_search', 'deep_enrich_lead'],
  executeLeadSourceTool,
  openAiFunctionTools,
};
