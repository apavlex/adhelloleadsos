/**
 * GHL → app inbound: Workflow webhooks (form / FB lead form / call status / customer replied),
 * inbound calls from native InboundMessage webhooks, and leads for unknown callers/texters.
 */
const dbService = require('./database');
const ghlClient = require('./ghlClient');
const workspaceIntegrations = require('./workspaceIntegrations');
const { appendInboundEvent, TYPE_LABELS } = require('./inboundEvents');
const userTasks = require('./userTasks');
const { resolveTaskOwnerEmail } = require('./dispositionFollowUp');
const { notifyInboundEvent } = require('./inboundPush');

const CALL_BACK_MINUTES = 15;

/** Top-level keys GHL sends on every Workflow webhook; anything else is treated as a form answer. */
const WORKFLOW_STANDARD_KEYS = new Set([
  'contact_id', 'id', 'first_name', 'last_name', 'full_name', 'name', 'email', 'phone', 'tags',
  'country', 'date_created', 'full_address', 'contact_type', 'contact_source', 'company_name',
  'address1', 'city', 'state', 'postal_code', 'timezone', 'website', 'location', 'workflow',
  'triggerdata', 'contact', 'attributionsource', 'lastattributionsource', 'customdata', 'user',
  'message', 'opportunity', 'calendar', 'appointment', 'campaign', 'date_of_birth', 'source',
  'type', 'event', 'locationid', 'location_id', 'contactid', 'utm_source', 'utm_medium',
  'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'gclid', 'call_status', 'callstatus',
  'call_duration', 'callduration', 'form_name', 'formname',
]);

function str(v) {
  return v == null ? '' : String(v).trim();
}

function obj(v) {
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
}

function toIso(raw) {
  const t = typeof raw === 'number' ? raw : Date.parse(str(raw));
  return Number.isFinite(t) && t > 0 ? new Date(t).toISOString() : new Date().toISOString();
}

/** GHL Workflow "Webhook" action payloads use snake_case contact fields and no `type`. */
function isWorkflowPayload(body) {
  if (!body || typeof body !== 'object') return false;
  if (str(body.type) || str(body.eventType) || str(body.webhookType)) return false;
  return !!(
    str(body.contact_id) ||
    (body.workflow && typeof body.workflow === 'object') ||
    (body.customData && typeof body.customData === 'object' && (body.phone || body.email))
  );
}

/**
 * @returns {'missed_call'|'voicemail'|'call'}
 */
function classifyCallOutcome({ status, durationSec, hasRecording, hint } = {}) {
  const s = `${str(status)} ${str(hint)}`.toLowerCase();
  const dur = Number.isFinite(Number(durationSec)) && str(durationSec) !== '' ? Number(durationSec) : null;
  if (/voice.?mail|\bvm\b/.test(s)) return 'voicemail';
  if (/no.?answer|missed|busy|cancel|fail|unanswered|abandon|not.?answered/.test(s)) {
    return hasRecording ? 'voicemail' : 'missed_call';
  }
  if (/complet|answered|connected|in.?progress/.test(s)) return dur === 0 ? 'missed_call' : 'call';
  if (hasRecording) return 'voicemail';
  return dur && dur > 0 ? 'call' : 'missed_call';
}

const EVENT_ALIASES = [
  [/^(form|lead|form_?submitted|form_?submission|survey|fb_?lead|facebook_?lead|lead_?form|ad_?lead|new_?lead)$/, 'form'],
  [/^(missed|missed_?call|no_?answer|call_?missed)$/, 'missed_call'],
  [/^(voicemail|vm|voice_?mail)$/, 'voicemail'],
  [/^(call|inbound_?call|call_?completed|call_?status)$/, 'call'],
  [/^(sms|text|reply|message|customer_?replied|inbound_?sms|inbound_?message)$/, 'sms'],
  [/^(email|inbound_?email|email_?reply)$/, 'email'],
];

function workflowMessage(body) {
  const cd = obj(body.customData);
  const m = body.message;
  if (m && typeof m === 'object') {
    return {
      body: str(m.body || m.text || m.message),
      isEmail: /email/i.test(str(m.type || m.messageType)),
    };
  }
  return { body: str(m || cd.message || cd.body), isEmail: /email/i.test(str(cd.channel)) };
}

function detectWorkflowEvent(body) {
  const cd = obj(body.customData);
  const trigger = obj(body.triggerData);
  const callStatus = str(body.call_status || body.callStatus || cd.call_status || cd.callStatus || trigger.callStatus || trigger.status);
  const duration = body.call_duration ?? body.callDuration ?? cd.call_duration ?? trigger.callDuration;
  const explicit = str(cd.event || cd.type || cd.kind).toLowerCase().replace(/[\s-]+/g, '_');
  if (explicit) {
    for (const [re, kind] of EVENT_ALIASES) {
      if (!re.test(explicit)) continue;
      if (kind === 'call') {
        return classifyCallOutcome({ status: callStatus, durationSec: duration, hint: '' });
      }
      if (kind === 'sms' && workflowMessage(body).isEmail) return 'email';
      return kind;
    }
  }
  const hint = `${str(obj(body.workflow).name)} ${str(trigger.type)} ${str(trigger.name)}`.toLowerCase();
  if (/voice.?mail/.test(hint)) return 'voicemail';
  if (/missed|no.?answer/.test(hint)) return 'missed_call';
  if (/\bcall/.test(hint) || callStatus) {
    return classifyCallOutcome({ status: callStatus, durationSec: duration, hint });
  }
  if (/repl|message|\bsms\b|\btext/.test(hint)) return workflowMessage(body).isEmail ? 'email' : 'sms';
  if (/\bemail/.test(hint) && workflowMessage(body).body) return 'email';
  return 'form';
}

/** UTM / click-id attribution → "Facebook Ads" | "Google Ads" | utm source. */
function adAttribution(body) {
  const contact = obj(body.contact);
  const a = {
    ...obj(contact.lastAttributionSource),
    ...obj(body.lastAttributionSource),
    ...obj(contact.attributionSource),
    ...obj(body.attributionSource),
  };
  const cd = obj(body.customData);
  const pick = (...vals) => vals.map(str).find(Boolean) || '';
  const utmSource = pick(a.utmSource, a.utm_source, body.utm_source, cd.utm_source);
  const utmMedium = pick(a.utmMedium, a.utm_medium, a.medium, body.utm_medium, cd.utm_medium);
  const utmCampaign = pick(a.utmCampaign, a.utm_campaign, a.campaign, body.utm_campaign, cd.utm_campaign);
  const utmContent = pick(a.utmContent, a.utm_content, a.adName, body.utm_content, cd.utm_content);
  const fbclid = pick(a.fbclid, a.fbc, body.fbclid, cd.fbclid);
  const gclid = pick(a.gclid, body.gclid, cd.gclid);
  const sessionSource = pick(a.sessionSource, a.source);
  const blob = [utmSource, utmMedium, sessionSource, body.contact_source, cd.source]
    .map((s) => str(s).toLowerCase())
    .join(' ');
  let adSource = '';
  if (fbclid || /facebook|instagram|\bmeta\b|\bfb\b|fb_ads|\big\b/.test(blob)) adSource = 'Facebook Ads';
  else if (gclid || /google|adwords|gads/.test(blob)) adSource = 'Google Ads';
  else if (/\bpaid\b|\bcpc\b|\bppc\b/.test(blob)) adSource = 'Paid ads';
  else adSource = utmSource || '';
  return {
    adSource,
    utmSource,
    utmMedium,
    utmCampaign,
    utmContent,
    landingUrl: pick(a.url, a.pageUrl, a.landingPage),
    referrer: pick(a.referrer),
  };
}

function workflowFormAnswers(body) {
  const out = [];
  for (const [k, v] of Object.entries(body || {})) {
    if (WORKFLOW_STANDARD_KEYS.has(k.toLowerCase())) continue;
    if (v == null || typeof v === 'object') continue;
    const val = str(v);
    if (!val || k.length > 80) continue;
    out.push({ q: k, a: val.slice(0, 300) });
    if (out.length >= 15) break;
  }
  return out;
}

function workflowContact(body) {
  const nested = obj(body.contact);
  const tags = Array.isArray(body.tags)
    ? body.tags
    : str(body.tags).split(',').map((t) => t.trim()).filter(Boolean);
  const first = str(body.first_name || nested.firstName);
  const last = str(body.last_name || nested.lastName);
  const contact = {
    id: str(body.contact_id || nested.id || body.id),
    firstName: first,
    lastName: last,
    email: str(body.email || nested.email),
    phone: str(body.phone || nested.phone),
    companyName: str(body.company_name || nested.companyName),
    website: str(body.website || nested.website),
    address1: str(body.address1 || nested.address1),
    city: str(body.city || nested.city),
    state: str(body.state || nested.state),
    locationId: str(obj(body.location).id || body.locationId || body.location_id),
  };
  if (!contact.companyName && !first && !last) {
    contact.name = str(body.full_name || body.name) || contact.phone || contact.email;
  }
  if (tags.length) contact.tags = tags;
  return contact;
}

/**
 * @returns {null | { kind, locationId, contactId, contact, label, preview, attribution, answers, at, eventId, durationSec, recordingUrl }}
 */
function parseGhlWorkflowPayload(body) {
  if (!isWorkflowPayload(body)) return null;
  const cd = obj(body.customData);
  const trigger = obj(body.triggerData);
  const contact = workflowContact(body);
  const kind = detectWorkflowEvent(body);
  const msg = workflowMessage(body);
  const formName = str(
    cd.form_name || cd.formName || body.form_name || body.formName || trigger.formName ||
      obj(trigger.form).name,
  );
  const workflowName = str(obj(body.workflow).name);
  const answers = kind === 'form' ? workflowFormAnswers(body) : [];
  return {
    kind,
    locationId: contact.locationId,
    contactId: contact.id,
    contact,
    label: formName || workflowName,
    preview: kind === 'sms' || kind === 'email' ? msg.body : str(cd.message || cd.note),
    attribution: adAttribution(body),
    answers,
    at: toIso(cd.at || trigger.dateAdded || body.date_created),
    eventId: str(cd.event_id || cd.eventId || trigger.messageId || trigger.id),
    durationSec: body.call_duration ?? body.callDuration ?? cd.call_duration ?? trigger.callDuration ?? null,
    recordingUrl: str(cd.recording_url || cd.recordingUrl || trigger.recordingUrl),
  };
}

async function resolveWorkspaceId(locationId, fallback) {
  let wid = str(fallback);
  if (locationId) {
    const match = await workspaceIntegrations.findWorkspaceIdByGhlLocationId(locationId);
    if (match) wid = match;
  }
  return wid || 'default';
}

function hasContactDetails(c) {
  return !!(c && (c.phone || c.email || c.firstName || c.lastName || c.companyName || c.name));
}

/**
 * Find or create the lead for a GHL contact. Unknown contacts are pulled from the GHL API
 * when possible so the lead gets a real name.
 * @returns {Promise<{ lead: object|null, created: boolean }>}
 */
async function ensureLeadForContact({ workspaceId, contactId, contact, phone, email, source }) {
  const ghlSync = require('./ghlSync');
  const localLeads = await dbService.getAllLeads(workspaceId);
  const probe = {
    id: str(contactId || (contact && contact.id)),
    email: str(email || (contact && contact.email)),
    phone: str(phone || (contact && contact.phone)),
  };
  const existing = ghlSync.findLocalLeadMatch(localLeads, probe);
  if (existing && existing.key) {
    const fill = {};
    const blank = (v) => !str(v) || str(v).toUpperCase() === 'N/A';
    if (blank(existing.email) && probe.email) fill.email = probe.email;
    if (blank(existing.phone) && probe.phone) fill.phone = probe.phone;
    if (!str(existing.ghlContactId) && probe.id) fill.ghlContactId = probe.id;
    if (Object.keys(fill).length) await dbService.updateLead(existing.key, fill);
    return { lead: await dbService.getLead(existing.key), created: false };
  }

  const integrationEnv = await workspaceIntegrations.getResolvedIntegrationEnv(workspaceId);
  let c = contact && typeof contact === 'object' ? { ...contact } : null;
  if (!hasContactDetails(c) && contactId && ghlClient.isConfigured(integrationEnv)) {
    try {
      c = { ...(await ghlClient.getContact(contactId, integrationEnv)) };
    } catch (e) {
      console.warn('[ghlInbound] contact lookup failed:', e && e.message);
    }
  }
  if (!c) c = {};
  c.id = str(c.id || contactId);
  if (!c.phone && phone) c.phone = phone;
  if (!c.email && email) c.email = email;
  if (!c.companyName && !c.firstName && !c.lastName && !str(c.name)) c.name = c.phone || c.email || '';
  if (!c.id && !c.phone && !c.email) return { lead: null, created: false };

  const result = await ghlSync.pullContactToLead(c, workspaceId, localLeads, integrationEnv);
  if (!result || result.skipped || !result.key) return { lead: null, created: false };
  const created = result.action === 'created';
  if (created && source) {
    await dbService.updateLead(result.key, {
      source,
      inboundSource: source,
      inboundAt: new Date().toISOString(),
    });
  }
  return { lead: await dbService.getLead(result.key), created };
}

function formatDuration(sec) {
  const n = Number(sec);
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n < 60) return `${Math.round(n)}s`;
  return `${Math.floor(n / 60)}m ${Math.round(n % 60)}s`;
}

/**
 * Log an inbound call on the lead. Missed calls and voicemails also queue a call-back task.
 */
async function handleInboundCall({ lead, workspaceId, outcome, at, eventId, durationSec, recordingUrl, label, source }) {
  if (!lead || !lead.key) return { applied: false, reason: 'missing_lead' };
  const kind = ['missed_call', 'voicemail', 'call'].includes(outcome) ? outcome : 'missed_call';
  const updates = Array.isArray(lead.updates) ? [...lead.updates] : [];
  const id = str(eventId);
  if (id && updates.some((u) => u && (str(u.ghlMessageId) === id || str(u.inboundEventId) === id))) {
    return { applied: false, reason: 'duplicate' };
  }
  const atIso = toIso(at);
  const typeLabel = TYPE_LABELS[kind];
  const dur = formatDuration(durationSec);
  const summary = [typeLabel, dur].filter(Boolean).join(' · ');
  updates.push({
    timestamp: atIso,
    type: 'call_inbound',
    value: summary,
    outcome: kind,
    ghlMessageId: id,
    inboundEventId: id,
    provider: 'ghl',
    ...(recordingUrl ? { recordingUrl } : {}),
  });

  const patch = {
    updates,
    inboundEvents: appendInboundEvent(lead.inboundEvents, {
      id: id ? `${kind}:${id}` : '',
      type: kind,
      at: atIso,
      label: label || '',
      preview: recordingUrl ? 'Voicemail recording in GHL' : '',
      source: source || 'ghl',
    }),
    logs: [{ type: 'call_inbound', message: `${summary} from ${lead.phone || 'caller'}`, timestamp: atIso }],
  };

  let taskId = null;
  if (kind !== 'call') {
    const respondBy = new Date(Date.parse(atIso) + CALL_BACK_MINUTES * 60000).toISOString();
    const curNext = Date.parse(str(lead.nextActionAt));
    if (!Number.isFinite(curNext) || curNext > Date.parse(respondBy)) patch.nextActionAt = respondBy;
    try {
      const ws = (await dbService.getWorkspace(workspaceId)) || { id: workspaceId };
      const ownerEmail = resolveTaskOwnerEmail(lead, ws);
      if (ownerEmail) {
        const task = await userTasks.upsertOpenTaskForLead(workspaceId, ownerEmail, {
          title: `Call back ${lead.title || lead.phone || 'caller'} (${typeLabel.toLowerCase()})`,
          column: 'todo',
          scheduledAt: respondBy,
          leadKey: lead.key,
          source: 'routing',
        });
        taskId = task && task.id;
      }
    } catch (e) {
      console.warn('[ghlInbound] call-back task failed:', e && e.message);
    }
  }

  const updated = await dbService.updateLead(lead.key, patch, workspaceId);
  if (kind !== 'call') {
    notifyInboundEvent({ workspaceId, lead: updated || lead, event: { type: kind, label: label || '' } });
  }
  return { applied: true, outcome: kind, taskId, lead: updated };
}

function formLogMessage(parsed) {
  const head = ['Form submitted', parsed.label, parsed.attribution.adSource].filter(Boolean).join(' · ');
  const lines = parsed.answers.map((x) => `${x.q}: ${x.a}`);
  return [head, ...lines].join('\n').slice(0, 2000);
}

/**
 * Handle a GHL Workflow webhook (custom "Webhook" action).
 * @param {object} body
 * @param {{ workspaceId?: string }} [opts]
 */
async function processWorkflowWebhook(body, opts = {}) {
  const parsed = parseGhlWorkflowPayload(body);
  if (!parsed) return { ok: true, ignored: true, reason: 'not_workflow_payload' };
  const wid = await resolveWorkspaceId(parsed.locationId, opts.workspaceId);
  const sourceByKind = {
    form: 'inbound_ghl_form',
    missed_call: 'inbound_ghl_call',
    voicemail: 'inbound_ghl_call',
    call: 'inbound_ghl_call',
    sms: 'inbound_ghl_sms',
    email: 'inbound_ghl_email',
  };
  const source = sourceByKind[parsed.kind];
  const { lead, created } = await ensureLeadForContact({
    workspaceId: wid,
    contactId: parsed.contactId,
    contact: parsed.contact,
    source,
  });
  if (!lead) return { ok: true, workspaceId: wid, ignored: true, reason: 'no_contact' };

  if (parsed.kind === 'form') {
    const attr = parsed.attribution;
    const eventLabel = [parsed.label, attr.adSource].filter(Boolean).join(' · ');
    const formEvent = {
      id: parsed.eventId ? `form:${parsed.eventId}` : '',
      type: 'form',
      at: parsed.at,
      label: eventLabel,
      preview: parsed.answers.slice(0, 3).map((x) => `${x.q}: ${x.a}`).join(' · '),
      source: 'ghl',
    };
    const patch = {
      inboundSource: source,
      inboundAt: parsed.at,
      inboundEvents: appendInboundEvent(lead.inboundEvents, formEvent),
      logs: [{ type: 'inbound_form', message: formLogMessage(parsed), timestamp: parsed.at }],
    };
    if (parsed.label) patch.inboundFormName = parsed.label;
    if (attr.adSource) patch.adSource = attr.adSource;
    for (const k of ['utmSource', 'utmMedium', 'utmCampaign', 'utmContent', 'landingUrl']) {
      if (attr[k]) patch[k] = attr[k];
    }
    await dbService.updateLead(lead.key, patch, wid);
    try {
      const { applyWarmInboundRules } = require('./leadRoutingRules');
      await applyWarmInboundRules({ leadKey: lead.key, workspaceId: wid, source });
    } catch (e) {
      console.warn('[ghlInbound] warm inbound routing failed:', e && e.message);
    }
    notifyInboundEvent({ workspaceId: wid, lead, event: formEvent });
    return { ok: true, workspaceId: wid, key: lead.key, action: 'form_lead', created, adSource: attr.adSource || null };
  }

  if (parsed.kind === 'sms' || parsed.kind === 'email') {
    const { handleInboundReply } = require('./inboundReplyRules');
    const r = await handleInboundReply({
      lead,
      workspaceId: wid,
      channel: parsed.kind,
      body: parsed.preview || (parsed.kind === 'email' ? '(email reply)' : '(text message)'),
      messageId: parsed.eventId,
      ghlContactId: parsed.contactId,
      timestamp: parsed.at,
      newContact: created,
    });
    return { ok: true, workspaceId: wid, key: lead.key, action: `${parsed.kind}_inbound`, created, applied: !!r.applied, reason: r.reason };
  }

  const r = await handleInboundCall({
    lead,
    workspaceId: wid,
    outcome: parsed.kind,
    at: parsed.at,
    eventId: parsed.eventId,
    durationSec: parsed.durationSec,
    recordingUrl: parsed.recordingUrl,
    label: created ? 'New caller' : '',
    source: 'ghl',
  });
  return { ok: true, workspaceId: wid, key: lead.key, action: parsed.kind, created, applied: !!r.applied, taskId: r.taskId || null };
}

module.exports = {
  isWorkflowPayload,
  parseGhlWorkflowPayload,
  detectWorkflowEvent,
  classifyCallOutcome,
  adAttribution,
  ensureLeadForContact,
  handleInboundCall,
  processWorkflowWebhook,
};
