/**
 * Team field-work tools for MCP clients and in-app Alex:
 * rollup of every network partner's jobs, schedule, and job detail (owner/manager view).
 */
const { z } = require('zod/v3');
const { zodToJsonSchema } = require('zod-to-json-schema');
const dbService = require('../database');
const workspaceService = require('../workspaceService');
const store = require('../networkStore');
const teamFieldWork = require('../teamFieldWork');
const memberWork = require('../memberWork');
const notify = require('../networkNotify');

function toolError(message, code = 'FIELD_WORK_ERROR') {
  const err = new Error(message);
  err.code = code;
  return err;
}

function pageUrl(ctx, query = 'tab=field-work&fw=open') {
  const base = (ctx && ctx.baseUrl) || notify.baseUrlFromReq(null) || '';
  return `${String(base).replace(/\/+$/, '')}/network?${query}`;
}

async function requireNetwork(ctx) {
  const network = await store.getNetworkForWorkspace(ctx.workspaceId);
  if (!network) {
    throw toolError('This workspace has no referral network yet. Open Network in AdHello to set one up.', 'NO_NETWORK');
  }
  return network;
}

async function requireManager(ctx) {
  if (ctx && (ctx.canManage === true || ctx.canAssignWork === true)) return;
  const ws = await dbService.getWorkspace(ctx.workspaceId);
  const role = workspaceService.roleForEmail(ws, ctx.userEmail || '');
  if (!workspaceService.canAssignWork(role)) {
    throw toolError('Only workspace owners, admins, and managers can view team field work.', 'FORBIDDEN');
  }
}

function presentJobRow(row) {
  return {
    member_id: row.memberId,
    member_name: row.memberName,
    customer_id: row.customerId || null,
    customer_name: row.customerName,
    customer_phone: row.customerPhone || null,
    job_id: row.jobId,
    title: row.title,
    status: row.status,
    status_label: row.statusLabel,
    date: row.date || null,
    time: row.time || null,
    when: row.whenLabel || null,
    value: row.value || 0,
    value_label: row.valueLabel || '',
    notes: row.latestNote || row.notes || '',
    photo_count: row.photoCount || 0,
    overdue: !!row.overdue,
    open: !!row.isOpen,
    job_url: row.ownerJobHref || null,
    customer_url: row.ownerCustomerHref || null,
  };
}

async function getFieldWorkOverview(ctx) {
  await requireManager(ctx);
  const network = await requireNetwork(ctx);
  const members = await store.listMembers(network.id);
  const summary = await teamFieldWork.summarizeTeamFieldWork(network.id, members);
  const totals = summary.totals || {};
  return {
    today: summary.today,
    need_attention: summary.needAttention || 0,
    totals: {
      open: totals.open || 0,
      today: totals.today || 0,
      overdue: totals.overdue || 0,
      this_week: totals.thisWeek || 0,
      upcoming: totals.upcoming || 0,
      leads: totals.leads || 0,
      deals_won: totals.dealsWon || 0,
      open_value: totals.openValue || 0,
      won_value: totals.wonValue || 0,
      deals_value: totals.dealsValue || 0,
      photos: totals.photos || 0,
      members_with_work: totals.membersWithWork || 0,
    },
    field_work_page: pageUrl(ctx),
    calendar_page: pageUrl(ctx, 'tab=calendar'),
  };
}

async function listFieldWorkJobs(ctx, input) {
  await requireManager(ctx);
  const network = await requireNetwork(ctx);
  const members = await store.listMembers(network.id);
  const view = input.view || 'open';
  const data = await teamFieldWork.listTeamFieldWork(network.id, members, {
    view,
    day: input.day,
    month: input.month,
    memberId: input.member_id,
    status: input.status,
  });
  const limit = Math.min(100, input.limit || 40);
  const rows = (data.rows || []).slice(0, limit).map(presentJobRow);
  return {
    today: data.today,
    view: data.view,
    day: data.day,
    month: data.month,
    count: rows.length,
    showing_of: (data.totals && data.totals.showing) || rows.length,
    totals: {
      open: data.totals.open || 0,
      today: data.totals.today || 0,
      overdue: data.totals.overdue || 0,
      this_week: data.totals.thisWeek || 0,
    },
    jobs: rows,
    field_work_page: pageUrl(ctx, `tab=field-work&fw=${encodeURIComponent(view)}`),
  };
}

async function getFieldWorkJob(ctx, input) {
  await requireManager(ctx);
  const network = await requireNetwork(ctx);
  const members = await store.listMembers(network.id);
  const member =
    members.find((m) => m && m.id === input.member_id) ||
    members.find(
      (m) =>
        m &&
        String(m.companyName || '')
          .toLowerCase()
          .includes(String(input.member_id || '').toLowerCase()),
    );
  if (!member) throw toolError(`No network member matches "${input.member_id}".`, 'NOT_FOUND');
  const job = await teamFieldWork.getFieldWorkJob(network.id, member, input.job_id);
  if (!job) throw toolError('Job not found.', 'NOT_FOUND');
  return {
    job: {
      member_id: job.memberId,
      member_name: job.memberName,
      customer_id: job.customerId || null,
      customer_name: job.customerName,
      customer_phone: job.customerPhone || null,
      customer_email: job.customerEmail || null,
      customer_address: job.customerAddress || null,
      job_id: job.jobId,
      title: job.title,
      status: job.status,
      status_label: job.statusLabel,
      date: job.date || null,
      time: job.time || null,
      when: job.whenLabel || null,
      value: job.value || 0,
      value_label: job.valueLabel || '',
      notes: job.notes || '',
      latest_note: job.latestNote || '',
      photo_count: job.photoCount || 0,
      photos: (job.photos || []).map((p) => ({
        id: p.id,
        caption: p.caption || '',
        href: p.href || null,
      })),
      overdue: !!job.overdue,
      job_url: job.ownerJobHref || null,
      customer_url: job.ownerCustomerHref || null,
    },
    field_work_page: pageUrl(ctx),
  };
}

const FIELD_WORK_TOOLS = [
  {
    name: 'get_field_work_overview',
    description:
      'Team field-work rollup for managers: open jobs, today, overdue, this week, lead/deal value, photos. ' +
      'Use when the user asks how the crew / partners are doing in the field or on the calendar.',
    schema: z.object({}),
    run: getFieldWorkOverview,
  },
  {
    name: 'list_field_work_jobs',
    description:
      'List team field-work jobs across network partners (owner/manager view). Filter by view (open/upcoming/today/day/calendar/all), member, status, or day.',
    schema: z.object({
      view: z
        .enum(['open', 'upcoming', 'today', 'day', 'calendar', 'all'])
        .optional()
        .describe('Default open. day/calendar need day or use today.'),
      day: z.string().optional().describe('YYYY-MM-DD for day/calendar views.'),
      month: z.string().optional().describe('YYYY-MM for calendar month.'),
      member_id: z.string().optional().describe('Network member id to filter.'),
      status: z
        .enum(memberWork.JOB_STATUSES)
        .optional()
        .describe('Job status filter (lead, estimate, scheduled, in_progress, on_hold, completed, cancelled).'),
      limit: z.number().int().min(1).max(100).optional(),
    }),
    run: listFieldWorkJobs,
  },
  {
    name: 'get_field_work_job',
    description:
      'Get one teammate field-work job with customer contact, notes, value, and photo links (owner/manager workspace view).',
    schema: z.object({
      member_id: z.string().min(1).describe('Network member id (from list_field_work_jobs).'),
      job_id: z.string().min(1).describe('Job id.'),
    }),
    run: getFieldWorkJob,
  },
];

const BY_NAME = Object.fromEntries(FIELD_WORK_TOOLS.map((t) => [t.name, t]));
const FIELD_WORK_TOOL_NAMES = FIELD_WORK_TOOLS.map((t) => t.name);

async function executeFieldWorkTool(ctx, name, input) {
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
  return FIELD_WORK_TOOLS.map((tool) => {
    const { $schema, ...parameters } = zodToJsonSchema(tool.schema, { target: 'openApi3' });
    return { type: 'function', function: { name: tool.name, description: tool.description, parameters } };
  });
}

module.exports = {
  FIELD_WORK_TOOLS,
  FIELD_WORK_TOOL_NAMES,
  READ_ONLY_FIELD_WORK_TOOLS: FIELD_WORK_TOOL_NAMES.slice(),
  executeFieldWorkTool,
  openAiFunctionTools,
};
