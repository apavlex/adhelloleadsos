/**
 * Team history rows for AI assistants (MCP clients and Ask AI). Every tool call that changes
 * something is credited to the bot ("Muse", "ChatGPT", "Ask AI"), with the user it acted for.
 */
const teamActivity = require('../teamActivity');

function text(v, max = 80) {
  const s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function list(v) {
  return Array.isArray(v) ? v.filter((x) => x != null && String(x).trim()) : [];
}

function count(n, one, many) {
  return `${n} ${n === 1 ? one : many || `${one}s`}`;
}

function quoted(names, max = 5) {
  const shown = names.slice(0, max).map((n) => `"${text(n, 40)}"`).join(', ');
  return names.length > max ? `${shown} +${names.length - max} more` : shown;
}

const LEAD_NOTE_FIELDS = new Set(['notes', 'note', 'panelNote', 'callNotes']);
const SCRIPT_LABELS = { sms: 'SMS', email: 'email', dm: 'DM', call: 'call', discovery: 'discovery', valueProp: 'value prop', objectionHandling: 'objection', close: 'close' };

/** tool name → (input, result) => activity entry, or null to skip. */
const DESCRIBE = {
  create_folder(i) {
    const names = list(i.names).length ? list(i.names) : list([i.name]);
    if (!names.length) return null;
    return { category: 'leads', action: 'folder_create', summary: names.length === 1 ? `Created folder ${quoted(names)}` : `Created ${names.length} folders: ${quoted(names)}` };
  },
  rename_folder(i) {
    return { category: 'leads', action: 'folder_rename', summary: `Renamed folder${i.folder_name ? ` "${text(i.folder_name, 40)}"` : ''} to "${text(i.new_name, 40)}"` };
  },
  bookmark_leads(i) {
    const keys = list(i.lead_ids);
    const off = i.bookmarked === false;
    return { category: 'leads', action: off ? 'unbookmark' : 'bookmark', summary: `${off ? 'Removed bookmark from' : 'Bookmarked'} ${count(keys.length, 'lead')}`, leadKeys: keys };
  },
  save_script(i) {
    const section = SCRIPT_LABELS[i.section] ? `${SCRIPT_LABELS[i.section]} ` : '';
    const offer = text(i.offer || i.offer_key, 40);
    return { category: 'notes', action: 'script_save', summary: `Saved ${section}script "${text(i.name, 60)}"${offer ? ` for ${offer}` : ''}` };
  },
  tag_leads(i) {
    const keys = list(i.lead_ids);
    const parts = [];
    if (list(i.add).length) parts.push(`added ${list(i.add).map((t) => text(t, 30)).join(', ')}`);
    if (list(i.remove).length) parts.push(`removed ${list(i.remove).map((t) => text(t, 30)).join(', ')}`);
    return { category: 'tags', action: 'lead_tags', summary: `Tags on ${count(keys.length, 'lead')}: ${parts.join('; ') || 'no change'}`, leadKeys: keys };
  },
  sync_leads_to_ghl(i) {
    const keys = list(i.lead_ids);
    return { category: 'leads', action: 'ghl_sync', summary: `Pushed ${count(keys.length, 'lead')} to Go High Level`, leadKeys: keys, attribute: false };
  },
  update_lead(i, r) {
    const fields = i.fields && typeof i.fields === 'object' ? i.fields : {};
    const names = Object.keys(fields);
    if (!names.length) return null;
    const noteOnly = names.every((f) => LEAD_NOTE_FIELDS.has(f));
    const status = fields.status ? ` (status → ${text(fields.status, 30)})` : '';
    return {
      category: noteOnly ? 'notes' : 'leads',
      action: noteOnly ? 'note_add' : 'lead_update',
      summary: noteOnly ? `Note: ${text(names.map((f) => fields[f]).join(' '), 160)}` : `Updated ${names.slice(0, 6).join(', ')}${status}`,
      leadKey: (r && r.lead && r.lead.key) || i.lead_id,
      leadTitle: (r && r.lead && r.lead.title) || '',
    };
  },
  bulk_update_leads(i) {
    const keys = list((i.updates || []).map((u) => u && u.lead_id));
    return { category: 'leads', action: 'lead_bulk_update', summary: `Updated ${count(keys.length, 'lead')}`, leadKeys: keys };
  },
  create_opportunity_pipeline(i) {
    return { category: 'pipeline', action: 'pipeline_create', summary: `Created pipeline "${text(i.name, 60)}"` };
  },
  move_opportunity(i, r) {
    const pipeline = text((r && r.pipelineName) || i.pipeline_name, 40);
    const stage = text((r && r.stageName) || i.stage_name, 40);
    return {
      category: 'pipeline',
      action: 'opportunity_move',
      summary: `Moved to ${[pipeline, stage].filter(Boolean).join(' → ') || 'pipeline'}`,
      leadKey: i.lead_id,
    };
  },
  enrich_lead(i) {
    return { category: 'leads', action: 'enrich', summary: 'Ran enrichment (email / phone hunt)', leadKey: i.lead_id };
  },
  create_task(i) {
    return { category: 'notes', action: 'task_create', summary: `Task: ${text(i.title, 160)}`, leadKey: i.lead_id || undefined };
  },
  update_task(i) {
    const bits = [i.title && `"${text(i.title, 80)}"`, i.column && `→ ${text(i.column, 20)}`].filter(Boolean).join(' ');
    return { category: 'notes', action: 'task_update', summary: `Updated task${bits ? ` ${bits}` : ''}`, leadKey: i.lead_id || undefined };
  },
  send_referral(i) {
    return { category: 'outreach', action: 'referral_send', summary: `Sent a ${text(i.trade, 30)} referral for ${text(i.homeowner_name, 40)}` };
  },
  update_referral(i) {
    const value = i.job_value ? ` ($${Number(i.job_value).toLocaleString('en-US')})` : '';
    return { category: 'outreach', action: `referral_${i.action}`, summary: `Referral ${i.action}${value}${i.note ? `: ${text(i.note, 100)}` : ''}` };
  },
  approve_network_application() {
    return { category: 'leads', action: 'network_approve', summary: 'Approved a network application' };
  },
  reject_network_application() {
    return { category: 'leads', action: 'network_reject', summary: 'Rejected a network application' };
  },
  manage_network_trades(i) {
    if (i.action === 'list') return null;
    return { category: 'leads', action: `network_trades_${i.action}`, summary: `Network trades ${i.action}: ${list(i.trades).map((t) => text(t, 30)).join(', ')}` };
  },
  save_custom_cadence(i) {
    const steps = list(i.steps).length;
    return { category: 'outreach', action: 'cadence_save', summary: `Saved cadence "${text(i.name || i.cadence, 60)}"${steps ? ` (${count(steps, 'step')})` : ''}` };
  },
  log_call_outcome(i, r) {
    const label = (r && r.outcome) || text(i.outcome, 30);
    const notes = i.notes ? `: ${text(i.notes, 140)}` : '';
    return { category: 'notes', action: 'disposition', summary: `Logged ${label}${notes}${r && r.follow_up ? ' · follow-up set' : ''}`, leadKey: i.lead_id, meta: { code: i.outcome } };
  },
  enroll_in_auto_outreach(i, r) {
    const n = (r && r.enrolled) || 0;
    if (!n) return null;
    return { category: 'outreach', action: 'prospecting_enroll', summary: `Enrolled ${count(n, 'lead')} in auto-outreach`, leadKeys: list(i.lead_ids), leadCount: n };
  },
  launch_cadence(i, r) {
    const n = (r && r.launched) || 0;
    if (!n) return null;
    return { category: 'outreach', action: 'ghl_cadence_launch', summary: `Launched "${text((r.cadence && r.cadence.name) || i.cadence, 60)}" on ${count(n, 'lead')}`, leadKeys: list(i.lead_ids), leadCount: n };
  },
  stop_cadence(i, r) {
    const n = (r && r.stopped) || 0;
    if (!n) return null;
    return { category: 'outreach', action: 'ghl_cadence_stop', summary: `Stopped the cadence on ${count(n, 'lead')}`, leadKeys: list(i.lead_ids) };
  },
  manage_sequence(i, r) {
    const n = (r && r.done) || 0;
    if (i.action === 'list_templates' || !n) return null;
    const what = { start: `Started sequence ${text(r.template_id, 40)} on`, pause: 'Paused the sequence on', snooze: `Snoozed the sequence ${r.days}d on` }[i.action];
    return { category: 'outreach', action: `sequence_${i.action}`, summary: `${what} ${count(n, 'lead')}`, leadKeys: list(i.lead_ids) };
  },
  find_contacts(i) {
    const keys = list(i.lead_ids).length ? list(i.lead_ids) : list([i.lead_id]);
    return { category: 'leads', action: 'find_contacts', summary: `Looked up decision makers on ${count(keys.length, 'lead')}`, leadKeys: keys };
  },
  analyze_website(i, r) {
    const score = r && r.gap_score != null ? ` (gap score ${r.gap_score}/10)` : '';
    return { category: 'leads', action: 'website_analysis', summary: `Analyzed the website${score}`, leadKey: i.lead_id };
  },
  review_icp_fit(i, r) {
    return { category: 'leads', action: 'icp_review', summary: `ICP review: ${r && r.decision === 'approve' ? 'fits' : 'does not fit'}${r && r.grade ? ` (${r.grade})` : ''}`, leadKey: i.lead_id };
  },
  save_lead_script(i) {
    const label = SCRIPT_LABELS[i.channel || 'dm'];
    return {
      category: 'notes',
      action: 'lead_script_save',
      summary: String(i.body || '').trim() ? `Saved a custom ${label} script` : `Removed the custom ${label} script`,
      leadKey: i.lead_id,
    };
  },
};

/**
 * Tool context for an AI call: who the bot is and a flag the activity log flips when the tool
 * records its own row (so the generic row isn't added twice).
 */
function withBotActivity(ctx) {
  if (!ctx || !ctx.workspaceId || ctx.bot) return ctx;
  const name = ctx.clientName || (ctx.viaMcp ? '' : 'Ask AI');
  return { ...ctx, bot: teamActivity.botActor(name, ctx.userEmail), activityCall: { recorded: false } };
}

/** After a successful tool call: add the bot's activity row unless the tool already recorded one. */
function recordToolActivity(ctx, toolName, input, result) {
  try {
    if (!ctx || !ctx.bot || (ctx.activityCall && ctx.activityCall.recorded)) return null;
    const describe = DESCRIBE[toolName];
    const entry = describe ? describe(input || {}, result || {}) : null;
    if (!entry) return null;
    return teamActivity.record(teamActivity.toolActivityContext(ctx), entry);
  } catch (err) {
    console.warn('[botActivity] record failed:', err && err.message);
    return null;
  }
}

module.exports = {
  withBotActivity,
  recordToolActivity,
  TRACKED_TOOLS: Object.keys(DESCRIBE),
};
