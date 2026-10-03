/**
 * SMS and email to leads through the workspace's Go High Level connection, for MCP clients
 * (Meta AI / Muse, Grok, ChatGPT, Claude) and the in-app chat. Sends go through the same
 * checks and lead history as the lead panel (see services/leadOutreachSend.js).
 */
const { z } = require('zod/v3');
const { zodToJsonSchema } = require('zod-to-json-schema');
const dbService = require('../database');
const workspaceService = require('../workspaceService');
const teamActivity = require('../teamActivity');
const workspaceIntegrations = require('../workspaceIntegrations');
const ghlMessaging = require('../ghlMessaging');
const { sendLeadSms, sendLeadEmail, SMS_WINDOW } = require('../leadOutreachSend');
const { resolveLeadKey } = require('./mcpCrmService');
const { fillMessageForLead } = require('./mcpLeadScripts');

const MAX_LEADS_PER_CALL = 25;
const INTEGRATIONS_PATH = '/workspace/integrations';

function toolError(message, code = 'MESSAGING_ERROR') {
  const err = new Error(message);
  err.code = code;
  return err;
}

function clean(v) {
  const s = String(v == null ? '' : v).trim();
  return s && s !== 'N/A' ? s : '';
}

function viaLabel(ctx) {
  return clean(ctx && ctx.clientName) || 'AI assistant';
}

function actorFor(ctx, ws) {
  const email = String((ctx && ctx.userEmail) || '').toLowerCase();
  const member = ws && ws.members && ws.members[email];
  return email ? { email, name: (member && (member.name || member.displayName)) || '' } : null;
}

async function loadSender(ctx) {
  const ws = await dbService.getWorkspace(ctx.workspaceId);
  if (!ws) throw toolError('Workspace not found.', 'NOT_FOUND');
  if (workspaceService.roleForEmail(ws, ctx.userEmail || '') === 'viewer') {
    throw toolError('Viewers can\'t send messages from this workspace. Ask an owner or admin for member access.', 'FORBIDDEN');
  }
  return ws;
}

function leadIds(input) {
  const ids = input.lead_ids && input.lead_ids.length ? input.lead_ids : input.lead_id ? [input.lead_id] : [];
  if (!ids.length) throw toolError('Pass lead_id (or lead_ids for several leads).', 'INVALID_ARGUMENTS');
  if (input.to && ids.length > 1) throw toolError('`to` only works with a single lead_id.', 'INVALID_ARGUMENTS');
  return ids;
}

function settingsUrl(ctx) {
  return `${String((ctx && ctx.baseUrl) || '').replace(/\/+$/, '')}${INTEGRATIONS_PATH}`;
}

async function getMessagingStatus(ctx) {
  const env = await workspaceIntegrations.getResolvedIntegrationEnv(ctx.workspaceId);
  const ready = ghlMessaging.messagingReady(env);
  const missing = [];
  if (!ready.configured) missing.push('Go High Level API key and location ID');
  else {
    if (!ready.hasSmsFromNumber) missing.push('SMS "from" number');
    if (!ready.hasEmailFrom) missing.push('email "from" address');
  }
  return {
    ghl_connected: ready.configured,
    sms_ready: ready.smsReady,
    email_ready: ready.emailReady,
    sms_hours: `${SMS_WINDOW.start}–${SMS_WINDOW.end} in each lead's local time`,
    ...(missing.length ? { missing, settings_url: settingsUrl(ctx) } : {}),
    message: missing.length
      ? `Not ready yet: add the ${missing.join(' and ')} in Workspace → Integrations.`
      : 'SMS and email are ready. Show the user the exact text and get a yes before calling send_sms or send_email.',
  };
}

/** Runs `send` for each lead and returns per-lead results (single lead: the result itself). */
async function forEachLead(ctx, input, prepare, send) {
  const ws = await loadSender(ctx);
  const ids = leadIds(input);
  const actor = actorFor(ctx, ws);
  const results = [];
  for (const id of ids) {
    let row;
    try {
      // eslint-disable-next-line no-await-in-loop
      const { lead, fullKey } = await resolveLeadKey(ctx.workspaceId, id);
      // eslint-disable-next-line no-await-in-loop
      const prepared = await prepare(ws, lead);
      const base = { lead: { id: fullKey, business: clean(lead.title) } };
      if (prepared.unfilled.length) {
        row = {
          ...base,
          status: 'skipped',
          error: `Message still has placeholders: ${prepared.unfilled.join(', ')}. Fill them in and try again.`,
          code: 'UNFILLED_PLACEHOLDERS',
        };
      } else if (input.preview) {
        row = { ...base, status: 'preview', ...prepared.show };
      } else {
        // eslint-disable-next-line no-await-in-loop
        const sent = await send({
          workspaceId: ctx.workspaceId,
          actor,
          lead,
          fullKey,
          via: viaLabel(ctx),
          activity: teamActivity.toolActivityContext(ctx),
          ...prepared.args,
        });
        row = { ...base, status: 'sent', ...prepared.show, to: sent.to, message_id: sent.messageId };
      }
    } catch (e) {
      row = { lead: { id }, status: 'failed', error: e.message, code: e.code || 'ERROR' };
    }
    results.push(row);
  }
  if (ids.length === 1 && !input.lead_ids) {
    const only = results[0];
    if (only.status === 'failed' || only.status === 'skipped') throw toolError(only.error, only.code);
    return only;
  }
  const count = (s) => results.filter((r) => r.status === s).length;
  return {
    sent: count('sent'),
    failed: count('failed'),
    skipped: count('skipped'),
    ...(input.preview ? { previewed: count('preview') } : {}),
    results,
  };
}

async function sendSms(ctx, input) {
  return forEachLead(
    ctx,
    input,
    async (ws, lead) => {
      const { message, unfilled } = await fillMessageForLead(ctx, ws, lead, input.message);
      return { unfilled, show: { message }, args: { body: message, to: input.to } };
    },
    sendLeadSms,
  );
}

async function sendEmail(ctx, input) {
  return forEachLead(
    ctx,
    input,
    async (ws, lead) => {
      const subject = await fillMessageForLead(ctx, ws, lead, input.subject);
      const body = await fillMessageForLead(ctx, ws, lead, input.body);
      return {
        unfilled: [...new Set([...subject.unfilled, ...body.unfilled])],
        show: { subject: subject.message, body: body.message },
        args: { subject: subject.message, body: body.message, to: input.to },
      };
    },
    sendLeadEmail,
  );
}

const LEAD_TARGET = {
  lead_id: z.string().min(1).optional().describe('Lead id/key from list_leads or search_leads.'),
  lead_ids: z
    .array(z.string().min(1))
    .min(1)
    .max(MAX_LEADS_PER_CALL)
    .optional()
    .describe(`Up to ${MAX_LEADS_PER_CALL} leads at once; merge tags are filled per lead.`),
  preview: z.boolean().optional().describe('true = return the filled-in text per lead without sending.'),
};

const SEND_RULES =
  'Only send after the user has approved the exact text (use preview: true to show it per lead first). ' +
  'Merge tags {{name}} {{company}} {{city}} and the sender\'s sign-off tags are filled per lead; a message with unfilled placeholders is not sent. ' +
  'Logged on the lead\'s timeline and in Messages, and moves the lead along the pipeline like a manual send.';

const MESSAGING_TOOLS = [
  {
    name: 'get_messaging_status',
    description:
      'Check whether this workspace can send SMS and email through Go High Level (connected, SMS from-number, email from-address) and what is missing. ' +
      'Call before the first send_sms / send_email in a conversation.',
    schema: z.object({}),
    run: getMessagingStatus,
  },
  {
    name: 'send_sms',
    description:
      'Text a lead (or up to 25 leads) from the workspace\'s Go High Level number. ' +
      `${SEND_RULES} Skips leads marked Do Not Contact or opted out of SMS, and only sends 8 AM – 9 PM in the lead's local time. ` +
      'Use get_lead_script with channel "sms" to load the approved script first.',
    schema: z.object({
      ...LEAD_TARGET,
      message: z.string().min(1).max(1600).describe('Plain SMS text.'),
      to: z.string().optional().describe('Different phone number to text (single lead only); defaults to the lead\'s phone.'),
    }),
    run: sendSms,
  },
  {
    name: 'send_email',
    description:
      'Email a lead (or up to 25 leads) through Go High Level from the workspace\'s email-from address. ' +
      `${SEND_RULES} Skips leads marked Do Not Contact. Use get_lead_script with channel "email" to load the approved script first.`,
    schema: z.object({
      ...LEAD_TARGET,
      subject: z.string().min(1).max(300),
      body: z.string().min(1).max(20000).describe('Email body as plain text; line breaks are kept.'),
      to: z.string().email().optional().describe('Different recipient address (single lead only); defaults to the lead\'s email.'),
    }),
    run: sendEmail,
  },
];

const BY_NAME = Object.fromEntries(MESSAGING_TOOLS.map((t) => [t.name, t]));
const MESSAGING_TOOL_NAMES = MESSAGING_TOOLS.map((t) => t.name);

async function executeMessagingTool(ctx, name, input) {
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
  return MESSAGING_TOOLS.map((tool) => {
    const { $schema, ...parameters } = zodToJsonSchema(tool.schema, { target: 'openApi3' });
    return { type: 'function', function: { name: tool.name, description: tool.description, parameters } };
  });
}

module.exports = {
  MESSAGING_TOOLS,
  MESSAGING_TOOL_NAMES,
  READ_ONLY_MESSAGING_TOOLS: ['get_messaging_status'],
  SEND_MESSAGING_TOOLS: ['send_sms', 'send_email'],
  executeMessagingTool,
  openAiFunctionTools,
};
