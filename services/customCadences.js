/**
 * Workspace-defined cadences that run in GHL. Launching one tags the lead
 * `cadence-<slug>` and syncs it; a GHL workflow triggered by that tag sends
 * the steps. The app generates the setup prompt for that workflow from the steps.
 *
 * Stored on the workspace as `customCadences: [{ id, name, slug, goal, steps, ... }]`.
 * Leads on one carry `ghlCadence: { cadenceId, name, tagName, status, launchedAt }`.
 */

const crypto = require('crypto');
const dbService = require('./database');

const CHANNELS = {
  sms: 'SMS',
  email: 'Email',
  call: 'Call task',
  voicemail: 'Voicemail drop',
};
const MAX_CADENCES = 30;
const MAX_STEPS = 12;
const MAX_DAY = 90;
const MAX_LAUNCH = 200;
const TAG_PREFIX = 'cadence-';

/** Short tokens people type in the builder → GHL merge fields. */
const MERGE_TOKENS = {
  first_name: '{{contact.first_name}}',
  company: '{{contact.company_name}}',
  business_name: '{{contact.company_name}}',
  city: '{{contact.city}}',
  state: '{{contact.state}}',
  website: '{{contact.website}}',
  phone: '{{contact.phone}}',
  sender_business: '{{custom_field.AdHello Sender Business}}',
  sender_pitch: '{{custom_field.AdHello Sender Pitch}}',
  audit_link: '{{custom_field.AdHello Audit Link}}',
  my_name: '[Your name]',
};

function cleanText(value, max) {
  return String(value == null ? '' : value).replace(/\r\n?/g, '\n').trim().slice(0, max);
}

function cleanLine(value, max) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
}

function slugify(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
}

function tagNameFor(cadence) {
  return `${TAG_PREFIX}${cadence.slug}`;
}

function normalizeStep(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const channel = CHANNELS[s.channel] ? s.channel : '';
  const message = cleanText(s.message, 1600);
  if (!channel || !message) return null;
  const day = parseInt(s.dayOffset, 10);
  return {
    dayOffset: Number.isFinite(day) ? Math.max(0, Math.min(MAX_DAY, day)) : 0,
    channel,
    subject: channel === 'email' ? cleanLine(s.subject, 160) : '',
    message,
  };
}

function normalizeCadence(raw) {
  const c = raw && typeof raw === 'object' ? raw : {};
  const steps = (Array.isArray(c.steps) ? c.steps : [])
    .map(normalizeStep)
    .filter(Boolean)
    .slice(0, MAX_STEPS)
    .sort((a, b) => a.dayOffset - b.dayOffset);
  return {
    id: String(c.id || ''),
    name: cleanLine(c.name, 60),
    slug: slugify(c.slug || c.name),
    goal: cleanLine(c.goal, 160),
    steps,
    ghlSetupAt: c.ghlSetupAt || '',
    launchCount: Math.max(0, parseInt(c.launchCount, 10) || 0),
    lastLaunchedAt: c.lastLaunchedAt || '',
    createdAt: c.createdAt || '',
    updatedAt: c.updatedAt || '',
  };
}

function listCadences(ws) {
  const list = ws && Array.isArray(ws.customCadences) ? ws.customCadences : [];
  return list.map(normalizeCadence).filter((c) => c.id && c.name && c.steps.length);
}

function getCadence(ws, id) {
  return listCadences(ws).find((c) => c.id === String(id || '')) || null;
}

async function persist(workspaceId, ws, cadences) {
  await dbService.saveWorkspace(workspaceId, { ...ws, customCadences: cadences });
}

/** Create (no id) or update a cadence. The slug — and so the GHL tag — never changes after creation. */
async function saveCadence(workspaceId, input) {
  const ws = await dbService.getWorkspace(workspaceId);
  if (!ws) return { ok: false, error: 'Workspace not found.' };
  const draft = normalizeCadence(input);
  if (!draft.name) return { ok: false, error: 'Name the cadence.' };
  if (!draft.steps.length) return { ok: false, error: 'Add at least one step with a message.' };
  const list = listCadences(ws);
  const now = new Date().toISOString();
  const existing = draft.id ? list.find((c) => c.id === draft.id) : null;
  if (draft.id && !existing) return { ok: false, error: 'Cadence not found.' };

  let cadence;
  if (existing) {
    cadence = { ...existing, name: draft.name, goal: draft.goal, steps: draft.steps, updatedAt: now };
  } else {
    if (list.length >= MAX_CADENCES) return { ok: false, error: `You can keep up to ${MAX_CADENCES} cadences.` };
    const base = slugify(draft.name) || 'cadence';
    let slug = base;
    for (let i = 2; list.some((c) => c.slug === slug); i += 1) slug = `${base}-${i}`;
    cadence = { ...draft, id: `cc_${crypto.randomBytes(5).toString('hex')}`, slug, createdAt: now, updatedAt: now };
  }
  const next = existing ? list.map((c) => (c.id === cadence.id ? cadence : c)) : list.concat(cadence);
  await persist(workspaceId, ws, next);
  return { ok: true, cadence };
}

async function deleteCadence(workspaceId, id) {
  const ws = await dbService.getWorkspace(workspaceId);
  if (!ws) return { ok: false, error: 'Workspace not found.' };
  const list = listCadences(ws);
  if (!list.some((c) => c.id === id)) return { ok: false, error: 'Cadence not found.' };
  await persist(workspaceId, ws, list.filter((c) => c.id !== id));
  return { ok: true };
}

async function markGhlSetup(workspaceId, id) {
  const ws = await dbService.getWorkspace(workspaceId);
  const list = listCadences(ws);
  const cadence = list.find((c) => c.id === id);
  if (!cadence) return { ok: false, error: 'Cadence not found.' };
  const updated = { ...cadence, ghlSetupAt: new Date().toISOString() };
  await persist(workspaceId, ws, list.map((c) => (c.id === id ? updated : c)));
  return { ok: true, cadence: updated };
}

function toGhlMerge(text) {
  return String(text || '').replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (match, token) => MERGE_TOKENS[token.toLowerCase()] || match);
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** Copy-paste setup prompt for the GHL workflow that runs this cadence. */
function buildGhlPrompt(cadence) {
  const c = normalizeCadence(cadence);
  const tag = tagNameFor(c);
  const rule = '═══════════════════════════════════════';
  const lines = [
    `Set up a Go High Level workflow for the "${c.name}" cadence launched from AdHello / Agency OS.`,
  ];
  if (c.goal) lines.push(`Goal: ${c.goal}`);
  lines.push(
    '',
    rule,
    'TRIGGER',
    rule,
    `• Workflow trigger: Contact tag added — ${tag} (exact)`,
    '• Allow re-entry: off (run once per contact)',
    '• First action: Wait 2 minutes (AdHello syncs the contact and custom fields right after tagging)',
  );

  let prevDay = 0;
  c.steps.forEach((step, i) => {
    const gap = step.dayOffset - prevDay;
    prevDay = step.dayOffset;
    lines.push('', rule, `STEP ${i + 1} — DAY ${step.dayOffset} · ${CHANNELS[step.channel].toUpperCase()}`, rule);
    if (gap > 0) lines.push(`• Before this step: Wait ${plural(gap, 'day')}`);
    if (step.channel === 'sms') {
      lines.push(
        '• Only if custom field "AdHello SMS OK" = Yes (skip landlines)',
        '• Action: Send SMS',
        'Message:',
        toGhlMerge(step.message),
      );
    } else if (step.channel === 'email') {
      lines.push(
        '• Action: Send Email',
        `Subject: ${toGhlMerge(step.subject || `Quick idea for {{company}}`)}`,
        'Body:',
        toGhlMerge(step.message),
      );
    } else if (step.channel === 'call') {
      lines.push(
        '• Action: Create Task, assigned to the contact owner, due the same day',
        `• Task title: Call {{contact.first_name}} at {{contact.company_name}} — ${c.name}`,
        'Talking points:',
        toGhlMerge(step.message),
      );
    } else if (step.channel === 'voicemail') {
      lines.push(
        '• Action: Ringless voicemail (or a call task to leave it manually if RVM is not set up)',
        'Script:',
        toGhlMerge(step.message),
      );
    }
  });

  lines.push(
    '',
    rule,
    'STOP & EXIT RULES',
    rule,
    '• Goal event: contact replies by SMS or email → exit the workflow, notify the contact owner, add tag cadence-replied',
    '• If the contact books an appointment or the opportunity is won → exit the workflow',
    `• When the last step finishes with no reply → add tag ${tag}-done`,
    '• Keep sending hours to 8am–7pm in the contact\'s timezone',
    '',
    rule,
    'MERGE FIELDS USED',
    rule,
    '• {{contact.first_name}}, {{contact.company_name}}, {{contact.city}}, {{contact.website}}',
    '• AdHello Sender Business / Sender Pitch / Audit Link and AdHello SMS OK are custom fields AdHello syncs on every push',
    '• Replace [Your name] with the sender\'s name before publishing',
  );
  return lines.join('\n');
}

function stepSummary(cadence) {
  return normalizeCadence(cadence).steps.map((s) => `Day ${s.dayOffset} ${CHANNELS[s.channel]}`).join(' · ');
}

function fullLeadKey(key) {
  const k = String(key || '').trim();
  if (!k) return '';
  return k.startsWith('lead:') ? k : `lead:${k}`;
}

async function resolveTagKey(workspaceId, name) {
  const tags = await dbService.listTags(workspaceId);
  const found = tags.find((t) => String(t.name || '').trim().toLowerCase() === name);
  if (found && found.key) return found.key;
  const created = await dbService.createTag(workspaceId, name, '#06B6D4');
  return created.key;
}

const SKIP_LABELS = {
  missing_lead: 'lead not found',
  already_on_cadence: 'already on this cadence',
  on_other_ghl_cadence: 'on another GHL cadence',
  on_in_app_cadence: 'on an in-app cadence',
  on_auto_outreach: 'on GHL auto outreach',
};

function activeElsewhere(lead, cadenceId) {
  const g = lead.ghlCadence;
  if (g && g.status === 'active') return g.cadenceId === cadenceId ? 'already_on_cadence' : 'on_other_ghl_cadence';
  if (lead.sequenceState && lead.sequenceState.status === 'active') return 'on_in_app_cadence';
  if (lead.prospecting && lead.prospecting.status === 'active') return 'on_auto_outreach';
  return '';
}

/**
 * Tag leads for a cadence and sync them to GHL. A lead already on another
 * cadence or auto outreach is skipped so nobody is messaged twice.
 */
async function launchCadence({ workspaceId, cadenceId, leadKeys, actorEmail }) {
  const ws = await dbService.getWorkspace(workspaceId);
  const cadence = getCadence(ws, cadenceId);
  if (!cadence) return { ok: false, error: 'Cadence not found.' };
  const keys = [...new Set((Array.isArray(leadKeys) ? leadKeys : []).map(fullLeadKey).filter(Boolean))];
  if (!keys.length) return { ok: false, error: 'Select at least one lead.' };
  if (keys.length > MAX_LAUNCH) return { ok: false, error: `Launch up to ${MAX_LAUNCH} leads at a time.` };

  const tagName = tagNameFor(cadence);
  const tagKey = await resolveTagKey(workspaceId, tagName);
  const syncToGhl = !ws.isDemo;
  const { triggerGhlProspectSync } = require('./ghlProspectSync');
  const now = new Date().toISOString();
  const results = [];
  for (const key of keys) {
    const lead = await dbService.getLead(key, workspaceId);
    if (!lead || !(await dbService.leadBelongsToWorkspace(lead, workspaceId))) {
      results.push({ leadKey: key, launched: false, reason: 'missing_lead' });
      continue;
    }
    const busy = activeElsewhere(lead, cadence.id);
    if (busy) {
      results.push({ leadKey: key, title: lead.title, launched: false, reason: busy });
      continue;
    }
    const tags = dbService.normalizeTagKeys([...(lead.tags || []), tagKey]);
    await dbService.updateLead(
      key,
      {
        tags,
        ghlCadence: { cadenceId: cadence.id, name: cadence.name, tagName, status: 'active', launchedAt: now, launchedBy: actorEmail || '' },
        logs: [{ type: 'ghl_cadence_launch', message: `Launched "${cadence.name}" — tagged ${tagName} for the GHL workflow`, timestamp: now }],
      },
      workspaceId,
    );
    if (syncToGhl) triggerGhlProspectSync(key, workspaceId, { trigger: 'ghl_cadence_launch' });
    results.push({ leadKey: key, title: lead.title, launched: true });
  }

  const launched = results.filter((r) => r.launched).length;
  if (launched) {
    const fresh = await dbService.getWorkspace(workspaceId);
    const list = listCadences(fresh).map((c) =>
      c.id === cadence.id ? { ...c, launchCount: c.launchCount + launched, lastLaunchedAt: now } : c,
    );
    await persist(workspaceId, fresh, list);
  }
  const skipped = results.filter((r) => !r.launched).map((r) => ({ ...r, label: SKIP_LABELS[r.reason] || r.reason }));
  return {
    ok: true,
    cadence: { ...cadence, launchCount: cadence.launchCount + launched },
    tagName,
    launched,
    skipped,
    syncedToGhl: syncToGhl,
    prompt: buildGhlPrompt(cadence),
  };
}

/** Take leads off a cadence: drop the tag here (the next GHL sync removes it there) and mark it stopped. */
async function stopCadenceForLead({ workspaceId, leadKey }) {
  const key = fullLeadKey(leadKey);
  const lead = await dbService.getLead(key, workspaceId);
  if (!lead || !lead.ghlCadence || !(await dbService.leadBelongsToWorkspace(lead, workspaceId))) {
    return { ok: false, error: 'Lead is not on a GHL cadence.' };
  }
  const tagName = lead.ghlCadence.tagName;
  const tags = await dbService.listTags(workspaceId);
  const tag = tags.find((t) => String(t.name || '').trim().toLowerCase() === tagName);
  const now = new Date().toISOString();
  await dbService.updateLead(
    key,
    {
      tags: tag ? dbService.normalizeTagKeys(lead.tags).filter((k) => k !== tag.key) : lead.tags,
      ghlCadence: { ...lead.ghlCadence, status: 'stopped', stoppedAt: now },
      logs: [{ type: 'ghl_cadence_stop', message: `Stopped "${lead.ghlCadence.name}"`, timestamp: now }],
    },
    workspaceId,
  );
  const ws = await dbService.getWorkspace(workspaceId);
  if (ws && !ws.isDemo) {
    require('./ghlProspectSync').triggerGhlProspectSync(key, workspaceId, { trigger: 'ghl_cadence_stop' });
  }
  return { ok: true };
}

/** Cadences with the leads currently on each, for the Cadences page. */
function cadencesWithLeads(ws, leads) {
  const byCadence = {};
  for (const lead of leads || []) {
    const g = lead && lead.ghlCadence;
    if (!g || g.status !== 'active') continue;
    (byCadence[g.cadenceId] = byCadence[g.cadenceId] || []).push({ key: lead.key, title: lead.title, launchedAt: g.launchedAt });
  }
  return listCadences(ws).map((c) => ({
    ...c,
    tagName: tagNameFor(c),
    summary: stepSummary(c),
    prompt: buildGhlPrompt(c),
    leads: (byCadence[c.id] || []).sort((a, b) => String(b.launchedAt).localeCompare(String(a.launchedAt))),
  }));
}

module.exports = {
  CHANNELS,
  MERGE_TOKENS,
  MAX_LAUNCH,
  normalizeCadence,
  listCadences,
  getCadence,
  saveCadence,
  deleteCadence,
  markGhlSetup,
  tagNameFor,
  buildGhlPrompt,
  stepSummary,
  launchCadence,
  stopCadenceForLead,
  cadencesWithLeads,
};
