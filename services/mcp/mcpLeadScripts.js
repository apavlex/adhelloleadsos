/**
 * Per-lead outreach scripts for MCP clients (Meta AI / Muse, Grok, ChatGPT, Claude) and the in-app chat.
 * get_lead_script hands back the DM / SMS / email / call script that applies to a lead, filled in;
 * save_lead_script stores a custom script on one lead that wins over the offer's script.
 */
const { z } = require('zod/v3');
const { zodToJsonSchema } = require('zod-to-json-schema');
const dbService = require('../database');
const { SCRIPT_LIBRARY } = require('../salesConstants');
const { buildMergedScriptLibrary, SCRIPT_SECTIONS } = require('../salesScriptsStorage');
const workspaceSalesScripts = require('../workspaceSalesScripts');
const { resolveOutreachSenderProfile } = require('../outreachSenderProfile');
const { resolveScriptSignOffProfile, fillScriptPlain } = require('../scriptPlaceholders');
const { htmlToPlain } = require('../scriptMarkup');
const { resolveLeadKey } = require('./mcpCrmService');
const { withCustomScript } = require('../leadCustomScripts');

const CHANNELS = ['dm', 'sms', 'email', 'call'];
const CHANNEL_LABELS = { dm: 'DM script', sms: 'SMS script', email: 'Email script', call: 'Call script' };
const MAX_LEADS_PER_CALL = 25;
const LEFTOVER_TAG = /\{\{\s*[\w.]+\s*\}\}|\[[A-Za-z][A-Za-z ]{1,30}\]/g;

function toolError(message, code = 'SCRIPT_ERROR') {
  const err = new Error(message);
  err.code = code;
  return err;
}

function clean(v) {
  const s = String(v == null ? '' : v).trim();
  return s && s !== 'N/A' ? s : '';
}

function firstWord(v) {
  return clean(v).split(/\s+/)[0] || '';
}

function offerTemplate(block, channel) {
  if (!block) return '';
  if (channel !== 'call') return htmlToPlain(String(block[channel] || '')).trim();
  return SCRIPT_SECTIONS.map((sec) => htmlToPlain(String(block[sec] || '')).trim())
    .filter(Boolean)
    .join('\n\n');
}

function customScriptOf(lead, channel) {
  const all = lead && lead.customScripts && typeof lead.customScripts === 'object' ? lead.customScripts : {};
  const row = all[channel];
  return row && typeof row === 'object' && clean(row.text) ? row : null;
}

function senderFor(ctx, ws, offerKey) {
  const email = String((ctx && ctx.userEmail) || '').toLowerCase();
  const member = ws && ws.members && ws.members[email];
  const user = { emails: [{ value: email }], displayName: (member && (member.name || member.displayName)) || '' };
  return resolveScriptSignOffProfile({ user, workspace: ws, offerKey });
}

function leadSummary(lead, fullKey) {
  return {
    id: fullKey,
    business: clean(lead.title),
    contact_first_name: clean(lead.ownerFirstName) || firstWord(lead.contactName || lead.ownerName),
    city: clean(lead.city),
    state: clean(lead.state),
    website: clean(lead.website),
    instagram: clean(lead.instagram),
    facebook: clean(lead.facebook),
    linkedin: clean(lead.linkedin),
    phone: clean(lead.phone),
    email: clean(lead.email),
  };
}

/** Fill merge tags ({{name}}, {{company}}, {{city}}, sender tags) in free text for one lead; lists anything left unfilled. */
async function fillMessageForLead(ctx, ws, lead, text) {
  const folderKey = clean(lead.folderKey);
  const folder = folderKey ? await dbService.getFolder(ctx.workspaceId, folderKey) : null;
  const { offerKey } = resolveOutreachSenderProfile(ws, lead, folder);
  const summary = leadSummary(lead, '');
  const message = fillScriptPlain(String(text || ''), {
    sender: senderFor(ctx, ws, offerKey),
    prospect: { name: summary.contact_first_name || summary.business, company: summary.business, city: summary.city },
  }).trim();
  return { message, unfilled: [...new Set(message.match(LEFTOVER_TAG) || [])] };
}

async function scriptForLead(ctx, ws, catalog, library, leadId, channel, offerRef) {
  const { lead, fullKey } = await resolveLeadKey(ctx.workspaceId, leadId);
  const summary = leadSummary(lead, fullKey);

  let offerKey = '';
  if (offerRef) {
    const hit = workspaceSalesScripts.findOfferByName(catalog, offerRef);
    if (!hit) {
      throw toolError(`No offer matches "${offerRef}". Offers: ${catalog.map((c) => c.label).join(', ') || 'none yet'}.`, 'NOT_FOUND');
    }
    offerKey = hit.key;
  } else {
    const folderKey = clean(lead.folderKey);
    const folder = folderKey ? await dbService.getFolder(ctx.workspaceId, folderKey) : null;
    offerKey = resolveOutreachSenderProfile(ws, lead, folder).offerKey;
  }
  const entry = catalog.find((c) => c.key === offerKey) || null;

  const custom = customScriptOf(lead, channel);
  const template = custom ? custom.text : offerTemplate(library[offerKey], channel);
  const source = custom ? 'lead' : template ? 'offer' : 'none';
  const message = template
    ? fillScriptPlain(template, {
        sender: senderFor(ctx, ws, offerKey),
        prospect: { name: summary.contact_first_name || summary.business, company: summary.business, city: summary.city },
      }).trim()
    : '';
  const unfilled = [...new Set(message.match(LEFTOVER_TAG) || [])];

  const offer = entry ? { key: entry.key, label: entry.label } : null;
  let note;
  if (source === 'lead') {
    note = 'Custom script saved on this lead (it wins over the offer script).';
  } else if (source === 'offer') {
    note = `From the "${offer.label}" offer's ${CHANNEL_LABELS[channel]}.`;
  } else if (offer) {
    note = `The "${offer.label}" offer has no ${CHANNEL_LABELS[channel]} yet. Draft one with the user, then save it with save_script (section "${channel === 'call' ? 'opening' : channel}", offer "${offer.label}") for every lead on that offer, or save_lead_script for just this lead.`;
  } else {
    note = 'This workspace has no offers yet. Draft a message with the user and save it with save_lead_script, or create an offer with save_script.';
  }

  return {
    lead: summary,
    channel,
    source,
    offer,
    message,
    ...(unfilled.length ? { unfilled_placeholders: unfilled } : {}),
    template,
    note,
    ...(custom ? { custom_saved_at: custom.updatedAt || '' } : {}),
  };
}

async function getLeadScript(ctx, input) {
  const ids = input.lead_ids && input.lead_ids.length ? input.lead_ids : input.lead_id ? [input.lead_id] : [];
  if (!ids.length) throw toolError('Pass lead_id (or lead_ids for several leads).', 'INVALID_ARGUMENTS');
  const channel = input.channel || 'dm';
  const ws = await dbService.getWorkspace(ctx.workspaceId);
  if (!ws) throw toolError('Workspace not found.', 'NOT_FOUND');
  const library = buildMergedScriptLibrary(ws, SCRIPT_LIBRARY);
  const catalog = workspaceSalesScripts.resolveWorkspaceOfferCatalog(ws, SCRIPT_LIBRARY);

  const guidance =
    'Use `message` as the outreach text. Light personalization from the lead\'s details is fine, but keep the offer and the ask. ' +
    'Fill or remove anything listed in unfilled_placeholders. Show the user the final text before sending.';

  if (ids.length === 1 && !input.lead_ids) {
    return { ...(await scriptForLead(ctx, ws, catalog, library, ids[0], channel, input.offer)), guidance };
  }
  const scripts = [];
  for (const id of ids) {
    try {
      // eslint-disable-next-line no-await-in-loop
      scripts.push(await scriptForLead(ctx, ws, catalog, library, id, channel, input.offer));
    } catch (e) {
      scripts.push({ lead: { id }, error: e.message, code: e.code || 'ERROR' });
    }
  }
  return { channel, count: scripts.length, scripts, guidance };
}

async function saveLeadScript(ctx, input) {
  const channel = input.channel || 'dm';
  const { lead, fullKey } = await resolveLeadKey(ctx.workspaceId, input.lead_id);
  const saved = withCustomScript(lead, channel, input.body, ctx.userEmail);
  if (!saved.ok) throw toolError(saved.error, 'INVALID_ARGUMENTS');
  const text = saved.script ? saved.script.text : '';
  await dbService.updateLead(fullKey, { customScripts: saved.customScripts }, ctx.workspaceId);
  const name = clean(lead.title) || 'this lead';
  return {
    lead: { id: fullKey, business: clean(lead.title) },
    channel,
    cleared: !text,
    message: text
      ? `Saved a custom ${CHANNEL_LABELS[channel]} for ${name}. get_lead_script now returns it instead of the offer script.`
      : `Removed the custom ${CHANNEL_LABELS[channel]} for ${name}; it falls back to the offer script.`,
  };
}

const CHANNEL_ENUM = z
  .enum(CHANNELS)
  .optional()
  .describe('dm (Instagram / Facebook / LinkedIn message, default), sms, email, or call.');

const LEAD_SCRIPT_TOOLS = [
  {
    name: 'get_lead_script',
    description:
      'Load the outreach script for a lead, ready to send: a DM (default), SMS, email or call script with the lead\'s name, business and city filled in, ' +
      'plus the lead\'s Instagram / Facebook / LinkedIn / website so you know where to message them. ' +
      'Call this BEFORE writing a DM or text to any lead instead of inventing one. A custom script saved on the lead wins; otherwise it uses the script of the lead\'s offer ' +
      '(the lead\'s, its folder\'s, or the workspace default). Pass lead_ids for up to 25 leads at once (e.g. a prospect list).',
    schema: z.object({
      lead_id: z.string().min(1).optional().describe('Lead id/key from list_leads or search_leads.'),
      lead_ids: z.array(z.string().min(1)).min(1).max(MAX_LEADS_PER_CALL).optional().describe('Several leads at once.'),
      channel: CHANNEL_ENUM,
      offer: z.string().optional().describe('Use this offer\'s script instead of the lead\'s default offer.'),
    }),
    run: getLeadScript,
  },
  {
    name: 'save_lead_script',
    description:
      'Save a custom DM / SMS / email / call script on ONE lead; get_lead_script returns it for that lead from then on. ' +
      'Use merge tags {{name}} {{company}} {{city}} or write it out. Send an empty body to remove it. ' +
      'Draft it with the user first. For a script every lead on an offer should get, use save_script with section "dm" and offer instead.',
    schema: z.object({
      lead_id: z.string().min(1),
      channel: CHANNEL_ENUM,
      body: z.string().max(8000).describe('Script text; empty string removes the custom script.'),
    }),
    run: saveLeadScript,
  },
];

const BY_NAME = Object.fromEntries(LEAD_SCRIPT_TOOLS.map((t) => [t.name, t]));
const LEAD_SCRIPT_TOOL_NAMES = LEAD_SCRIPT_TOOLS.map((t) => t.name);

async function executeLeadScriptTool(ctx, name, input) {
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
  return LEAD_SCRIPT_TOOLS.map((tool) => {
    const { $schema, ...parameters } = zodToJsonSchema(tool.schema, { target: 'openApi3' });
    return { type: 'function', function: { name: tool.name, description: tool.description, parameters } };
  });
}

module.exports = {
  LEAD_SCRIPT_TOOLS,
  LEAD_SCRIPT_TOOL_NAMES,
  READ_ONLY_LEAD_SCRIPT_TOOLS: ['get_lead_script'],
  executeLeadScriptTool,
  openAiFunctionTools,
  fillMessageForLead,
};
