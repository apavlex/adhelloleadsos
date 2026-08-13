/**
 * Bidirectional sync between Agency OS leads and Go High Level contacts.
 */

const dbService = require('./database');
const ghlClient = require('./ghlClient');
const phoneLineType = require('./phoneLineType');
const workspaceIntegrations = require('./workspaceIntegrations');
const { handleInboundReply } = require('./inboundReplyRules');
const { applyEngagementSignal } = require('./engagementSignals');
const { hasUsableWebsite } = require('./leadListFilters');
const {
  mergeTagLists,
  normalizeGhlLogSync,
  logFingerprint,
  formatLogAsNoteBody,
  isAgencyOsNoteBody,
  shouldPushLog,
  ghlNoteToLogEntry,
  buildGhlSyncActivityNote,
} = require('./ghlSyncHelpers');
const { isActionTag, computeActionTagsFromLead, formatNextActionNote } = require('./ghlActionTags');
const ghlProspectSync = require('./ghlProspectSync');
const { pushLastProspectedField } = require('./ghlLastProspectedField');
const { pushReviewFields } = require('./ghlReviewFields');
const { pushPhoneLineFields } = require('./ghlPhoneLineFields');
const { pushOutreachProfileFields } = require('./ghlOutreachProfileFields');
const { normalizeGhlSyncDirection } = require('./ghlSyncDirection');

const GHL_TAG_NO_WEBSITE = 'no website';
const GHL_TAG_PROSPECTED = 'AO: Prospected';

/** Serialize GHL pushes per lead so disposition auto-sync and manual Sync GHL do not race. */
const ghlPushInFlight = new Map();

async function withGhlPushLock(leadKey, fn) {
  const lockKey = String(leadKey || '').trim();
  if (!lockKey) return fn();
  const prev = ghlPushInFlight.get(lockKey) || Promise.resolve();
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const chain = prev.then(() => gate);
  ghlPushInFlight.set(lockKey, chain);
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (ghlPushInFlight.get(lockKey) === chain) ghlPushInFlight.delete(lockKey);
  }
}

function normalizeEmail(email) {
  if (!email || email === 'N/A') return '';
  return String(email).trim().toLowerCase();
}

function normalizePhoneKey(phone) {
  return ghlClient.normalizePhoneE164(phone && phone !== 'N/A' ? phone : '').replace(/\D/g, '');
}

function findLocalLeadMatch(leads, contact) {
  const ghlId = String(contact.id || '').trim();
  if (ghlId) {
    const byId = leads.find((l) => String(l.ghlContactId || '') === ghlId);
    if (byId) return byId;
  }
  const email = normalizeEmail(contact.email);
  if (email) {
    const byEmail = leads.find((l) => normalizeEmail(l.email) === email);
    if (byEmail) return byEmail;
  }
  const phoneKey = normalizePhoneKey(contact.phone);
  if (phoneKey) {
    const byPhone = leads.find((l) => normalizePhoneKey(l.phone) === phoneKey);
    if (byPhone) return byPhone;
  }
  return null;
}

async function pushNotesToGhl(lead, contactId, integrationEnv) {
  const syncState = normalizeGhlLogSync(lead);
  const logs = Array.isArray(lead.logs) ? lead.logs : [];
  const updates = Array.isArray(lead.updates) ? lead.updates : [];
  const fromUpdates = updates
    .filter((entry) => {
      const type = String((entry && entry.type) || '').trim();
      return type === 'note' || type === 'quick_log';
    })
    .map((entry) => ({
      type: entry.type,
      message: entry.value || entry.message,
      value: entry.value,
      timestamp: entry.timestamp,
      source: entry.source,
    }));
  const combined = [...logs, ...fromUpdates];
  const pending = combined.filter((log) => shouldPushLog(log, syncState));
  if (!pending.length) {
    return { pushed: 0, syncState };
  }

  let pushed = 0;
  for (const log of pending) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await ghlClient.createContactNote(contactId, formatLogAsNoteBody(log), integrationEnv);
      const fp = logFingerprint(log);
      if (fp && !syncState.pushedFingerprints.includes(fp)) {
        syncState.pushedFingerprints.push(fp);
      }
      pushed += 1;
    } catch (e) {
      /* continue with remaining notes */
    }
  }

  return { pushed, syncState };
}

async function pullNotesFromGhl(lead, contactId, integrationEnv) {
  const syncState = normalizeGhlLogSync(lead);
  let notes = [];
  try {
    notes = await ghlClient.listContactNotes(contactId, integrationEnv);
  } catch (e) {
    return { pulled: 0, newLogs: [], syncState };
  }

  const newLogs = [];
  for (const note of notes) {
    const noteId = String((note && note.id) || '').trim();
    if (!noteId || syncState.pulledNoteIds.includes(noteId)) continue;
    const body = String((note && note.body) || '').trim();
    if (!body || isAgencyOsNoteBody(body)) {
      syncState.pulledNoteIds.push(noteId);
      continue;
    }
    const entry = ghlNoteToLogEntry(note);
    if (!entry) continue;
    newLogs.push(entry);
    syncState.pulledNoteIds.push(noteId);
  }

  return { pulled: newLogs.length, newLogs, syncState };
}

async function pushSyncActivityNote(lead, contactId, integrationEnv) {
  const actionTags = computeActionTagsFromLead(lead);
  const actionLabel = actionTags.length
    ? actionTags[0].replace(/^AO:\s*/, '')
    : 'Follow-up';
  const body = buildGhlSyncActivityNote(lead, { actionLabel });
  if (!body) return { pushed: false };
  try {
    await ghlClient.createContactNote(contactId, body, integrationEnv);
    return { pushed: true };
  } catch (e) {
    return { pushed: false, error: e && e.message ? e.message : 'note_failed' };
  }
}

function buildGhlFollowUpTaskPayload(lead) {
  const dueRaw = lead && lead.nextActionAt ? String(lead.nextActionAt).trim() : '';
  if (!dueRaw) return null;
  const dueDate = new Date(dueRaw);
  if (Number.isNaN(dueDate.getTime())) return null;

  const actionTags = computeActionTagsFromLead(lead);
  const actionLabel = actionTags.length
    ? actionTags[0].replace(/^AO:\s*/, '')
    : 'Follow-up';
  const title = `Follow up: ${String((lead && lead.title) || 'Lead').trim()} — ${actionLabel}`;
  const notes = String((lead && lead.lastDispositionNotes) || '').trim();
  const body = notes || formatNextActionNote(lead) || '';
  return {
    title,
    body,
    dueDate: dueDate.toISOString(),
  };
}

async function syncFollowUpTaskToGhl(lead, contactId, integrationEnv) {
  const payload = buildGhlFollowUpTaskPayload(lead);
  if (!payload) return { skipped: true, reason: 'no_follow_up' };

  const dueKey = payload.dueDate;
  const existingTaskId = String((lead && lead.ghlFollowUpTaskId) || '').trim();
  const existingDue = String((lead && lead.ghlFollowUpTaskDueAt) || '').trim();
  if (existingTaskId && existingDue === dueKey) {
    return { skipped: true, reason: 'unchanged', taskId: existingTaskId, dueAt: dueKey };
  }

  try {
    if (existingTaskId) {
      await ghlClient.updateContactTask(contactId, existingTaskId, payload, integrationEnv);
      return { taskId: existingTaskId, dueAt: dueKey, action: 'updated' };
    }
    const created = await ghlClient.createContactTask(contactId, payload, integrationEnv);
    const taskId = String((created && created.id) || '').trim();
    if (!taskId) throw new Error('GHL did not return a task id');
    return { taskId, dueAt: dueKey, action: 'created' };
  } catch (e) {
    if (existingTaskId && (e.status === 404 || e.status === 422)) {
      const created = await ghlClient.createContactTask(contactId, payload, integrationEnv);
      const taskId = String((created && created.id) || '').trim();
      if (!taskId) throw new Error('GHL did not return a task id');
      return { taskId, dueAt: dueKey, action: 'recreated' };
    }
    throw e;
  }
}

async function pushLeadToGhl(lead, integrationEnv) {
  if (!lead || !lead.key) throw new Error('Invalid lead');
  return withGhlPushLock(lead.key, () => pushLeadToGhlInner(lead, integrationEnv));
}

async function pushLeadToGhlInner(lead, integrationEnv) {
  if (!lead || !lead.key) throw new Error('Invalid lead');
  let contactId = String(lead.ghlContactId || '').trim();
  let mergedTags = mergeTagLists(lead.tags);

  if (phoneLineType.hasUsablePhone(lead.phone) && phoneLineType.needsRefresh(lead, null)) {
    const linePatch = await phoneLineType.refreshIfNeeded(lead, null);
    if (linePatch) {
      lead = { ...lead, ...linePatch };
      await dbService.updateLead(lead.key, linePatch);
    }
  }

  if (contactId) {
    try {
      await ghlClient.updateContact(contactId, lead, integrationEnv);
    } catch (e) {
      if (e.status === 404) contactId = '';
      else throw e;
    }
  }

  if (!contactId) {
    const existing = await ghlClient.searchContactByEmailOrPhone(lead, integrationEnv);
    if (existing && existing.id) {
      contactId = String(existing.id);
      await ghlClient.updateContact(contactId, lead, integrationEnv);
    } else {
      const created = await ghlClient.createContact(lead, integrationEnv);
      contactId = String((created && created.id) || '');
    }
  }

  if (!contactId) throw new Error('GHL did not return a contact id');

  let tagsForPush = lead.ghlTagNamesForPush || mergeTagLists(lead.tags);
  tagsForPush = mergeTagLists(tagsForPush, [GHL_TAG_PROSPECTED, ghlClient.syncedDateTagFor()]);
  if (Array.isArray(lead.ghlExtraTagNames) && lead.ghlExtraTagNames.length) {
    tagsForPush = mergeTagLists(tagsForPush, lead.ghlExtraTagNames);
  }

  mergedTags = await ghlClient.syncContactTags(contactId, tagsForPush, integrationEnv, {
    replaceActionTags: true,
    isActionTag,
  });
  const syncActivityNote = await pushSyncActivityNote(lead, contactId, integrationEnv);
  const lastProspected = await pushLastProspectedField(contactId, integrationEnv);
  const reviewFields = await pushReviewFields(contactId, lead, integrationEnv);
  const phoneLineFields = await pushPhoneLineFields(contactId, lead, integrationEnv);
  const outreachProfileFields = await pushOutreachProfileFields(
    contactId,
    lead,
    integrationEnv,
    lead.workspaceId,
  );
  const notePush = await pushNotesToGhl(lead, contactId, integrationEnv);
  const notePull = await pullNotesFromGhl(lead, contactId, integrationEnv);
  const followUpTask = await syncFollowUpTaskToGhl(lead, contactId, integrationEnv);

  const ghlLogSync = notePush.syncState;
  notePull.syncState.pulledNoteIds.forEach((id) => {
    if (!ghlLogSync.pulledNoteIds.includes(id)) ghlLogSync.pulledNoteIds.push(id);
  });

  const patch = {
    ghlContactId: contactId,
    ghlSyncedAt: new Date().toISOString(),
    ghlSyncDirection: 'push',
    ghlLogSync,
  };
  if (Array.isArray(lead.ghlActionTags)) {
    patch.ghlActionTags = lead.ghlActionTags;
  }
  if (followUpTask && followUpTask.taskId) {
    patch.ghlFollowUpTaskId = followUpTask.taskId;
    patch.ghlFollowUpTaskDueAt = followUpTask.dueAt || '';
  }
  if (!lead.ghlTagNamesForPush) {
    patch.tags = mergedTags;
  }
  if (notePull.newLogs.length) patch.logs = notePull.newLogs;

  const updated = await dbService.updateLead(lead.key, patch);

  return {
    lead: updated,
    ghlContactId: contactId,
    action: 'pushed',
    notesPushed: notePush.pushed + (syncActivityNote.pushed ? 1 : 0),
    notesPulled: notePull.pulled,
    followUpTask,
    syncActivityNote,
    lastProspected,
    reviewFields,
    phoneLineFields,
    outreachProfileFields,
  };
}

async function pullContactToLead(contact, workspaceId, localLeads, integrationEnv) {
  const existing = findLocalLeadMatch(localLeads, contact);
  const patch = ghlClient.ghlContactToLeadPatch(contact, existing);
  if (!patch) return { skipped: true, reason: 'empty_contact' };

  const ghlTags = Array.isArray(contact.tags) ? contact.tags : [];
  if (ghlTags.length) {
    patch.tags = await ghlProspectSync.resolveGhlTagNamesToLeadKeys(
      workspaceId,
      ghlTags,
      existing && Array.isArray(existing.tags) ? existing.tags : patch.tags,
    );
  }

  const contactId = String(patch.ghlContactId || contact.id || '').trim();
  let notePull = { pulled: 0, newLogs: [], syncState: normalizeGhlLogSync(existing) };

  if (contactId && ghlClient.isConfigured(integrationEnv)) {
    notePull = await pullNotesFromGhl(existing || { ghlLogSync: {} }, contactId, integrationEnv);
  }

  if (existing) {
    const merged = await dbService.updateLead(existing.key, {
      ...patch,
      workspaceId: existing.workspaceId || workspaceId,
      ghlSyncDirection: 'pull',
      ghlLogSync: notePull.syncState,
      ...(notePull.newLogs.length ? { logs: notePull.newLogs } : {}),
    });
    return { lead: merged, action: 'updated', key: existing.key, notesPulled: notePull.pulled };
  }

  const key = await dbService.saveLead({
    ...patch,
    workspaceId,
    status: 'Not Contacted',
    pipelineStage: 1,
    savedAt: new Date().toISOString(),
    ghlLogSync: notePull.syncState,
    logs: notePull.newLogs,
  });
  const saved = await dbService.getLead(key);
  return { lead: saved, action: 'created', key, notesPulled: notePull.pulled };
}

/**
 * Push leads to GHL.
 * @param {{ workspaceId: string, integrationEnv: object, leadKeys?: string[], limit?: number }} opts
 */
async function pushLeads(opts) {
  const wid = opts.workspaceId || 'default';
  const integrationEnv = opts.integrationEnv;
  if (!ghlClient.isConfigured(integrationEnv)) {
    throw new Error('GHL is not configured. Set API key and location ID in Workspace → Integrations.');
  }

  let leads = await dbService.getAllLeads(wid);
  if (Array.isArray(opts.leadKeys) && opts.leadKeys.length) {
    const resolved = [];
    const seen = new Set();
    for (const rawKey of opts.leadKeys) {
      const trimmed = String(rawKey || '').trim();
      if (!trimmed) continue;
      // eslint-disable-next-line no-await-in-loop
      const storageKey = await dbService.resolveLeadStorageKey(trimmed, wid);
      if (!storageKey || seen.has(storageKey)) continue;
      // eslint-disable-next-line no-await-in-loop
      const lead = await dbService.getLead(storageKey);
      if (!lead) continue;
      seen.add(storageKey);
      resolved.push(lead);
    }
    leads = resolved;
  }

  const limit = Math.min(parseInt(opts.limit, 10) || 500, 500);
  leads = leads.slice(0, limit);

  const tagNoWebsite = opts.tagNoWebsite === true;
  const results = [];
  for (const lead of leads) {
    try {
      // eslint-disable-next-line no-await-in-loop
      let leadForPush = await ghlProspectSync.prepareLeadForGhlPush(lead, wid);
      if (tagNoWebsite && !hasUsableWebsite(lead)) {
        leadForPush = {
          ...leadForPush,
          ghlTagNamesForPush: mergeTagLists(leadForPush.ghlTagNamesForPush, [GHL_TAG_NO_WEBSITE]),
        };
      }
      // eslint-disable-next-line no-await-in-loop
      const r = await pushLeadToGhl(leadForPush, integrationEnv);
      results.push({
        key: lead.key,
        ok: true,
        ghlContactId: r.ghlContactId,
        actionTags: leadForPush.ghlActionTags || computeActionTagsFromLead(leadForPush),
        lastProspected: r.lastProspected,
        notesPushed: r.notesPushed,
        notesPulled: r.notesPulled,
      });
    } catch (e) {
      results.push({ key: lead.key, ok: false, error: e.message || 'push_failed' });
    }
  }

  const ok = results.filter((r) => r.ok).length;
  return { pushed: ok, failed: results.length - ok, total: results.length, results };
}

/**
 * Pull contacts from GHL into workspace leads.
 */
async function pullContacts(opts) {
  const wid = opts.workspaceId || 'default';
  const integrationEnv = opts.integrationEnv;
  if (!ghlClient.isConfigured(integrationEnv)) {
    throw new Error('GHL is not configured. Set API key and location ID in Workspace → Integrations.');
  }

  const maxPages = Math.min(parseInt(opts.maxPages, 10) || 5, 20);
  const pageSize = Math.min(parseInt(opts.limit, 10) || 100, 100);
  let startAfterId = opts.startAfterId ? String(opts.startAfterId) : undefined;

  const localLeads = await dbService.getAllLeads(wid);
  const results = [];
  let pulled = 0;
  let created = 0;
  let updated = 0;
  let notesPulled = 0;

  for (let page = 0; page < maxPages; page += 1) {
    // eslint-disable-next-line no-await-in-loop
    const batch = await ghlClient.listContacts(integrationEnv, {
      limit: pageSize,
      startAfterId,
    });
    const contacts = batch.contacts || [];
    if (!contacts.length) break;

    for (const contact of contacts) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const r = await pullContactToLead(contact, wid, localLeads, integrationEnv);
        if (r.skipped) {
          results.push({ ghlContactId: contact.id, ok: false, skipped: true });
          continue;
        }
        pulled += 1;
        notesPulled += r.notesPulled || 0;
        if (r.action === 'created') created += 1;
        if (r.action === 'updated') updated += 1;
        if (r.lead) localLeads.push(r.lead);
        results.push({
          ghlContactId: contact.id,
          ok: true,
          action: r.action,
          key: r.key,
          notesPulled: r.notesPulled || 0,
        });
      } catch (e) {
        results.push({ ghlContactId: contact.id, ok: false, error: e.message || 'pull_failed' });
      }
    }

    startAfterId = batch.nextStartAfterId || undefined;
    if (!startAfterId || contacts.length < pageSize) break;
  }

  return { pulled, created, updated, notesPulled, results };
}

async function syncBoth(opts) {
  const pullResult = await pullContacts({ ...opts, maxPages: opts.pullMaxPages || 3 });
  const pushResult = await pushLeads({ ...opts, limit: opts.pushLimit || 200 });
  return { pull: pullResult, push: pushResult };
}

/** Run pull, push, or both based on workspace sync direction. */
async function runDirectionalSync(opts) {
  const direction = normalizeGhlSyncDirection(opts && opts.direction);
  if (direction === 'push') {
    const push = await pushLeads(opts);
    return { direction, push };
  }
  if (direction === 'pull') {
    const pull = await pullContacts(opts);
    return { direction, pull };
  }
  const result = await syncBoth(opts);
  return { direction, ...result };
}

function statusFromEnv(integrationEnv) {
  const { apiKey, locationId, emailFrom, smsFromNumber } = ghlClient.resolveConfig(integrationEnv);
  const configured = ghlClient.isConfigured(integrationEnv);
  return {
    configured,
    hasApiKey: !!apiKey,
    hasLocationId: !!locationId,
    locationIdMasked: locationId ? `${locationId.slice(0, 6)}…${locationId.slice(-4)}` : '',
    hasEmailFrom: !!emailFrom,
    hasSmsFromNumber: !!smsFromNumber,
    smsReady: configured,
    emailReady: configured && !!emailFrom,
  };
}

function parseGhlWebhookPayload(body) {
  if (!body || typeof body !== 'object') return null;
  const type = String(body.type || body.event || '').trim();
  const locationId = String(
    body.locationId || body.location_id || (body.contact && body.contact.locationId) || '',
  ).trim();
  const contactId = String(body.id || body.contactId || (body.contact && body.contact.id) || '').trim();

  if (/delete/i.test(type)) {
    return { type, locationId, contactId, delete: true };
  }

  const contact =
    body.contact && typeof body.contact === 'object'
      ? { ...body.contact, id: body.contact.id || contactId, locationId: body.contact.locationId || locationId }
      : { ...body, id: contactId || body.id, locationId: locationId || body.locationId };

  const hasIdentity = !!(contactId || contact.email || contact.phone || contact.name || contact.companyName);
  if (!hasIdentity) return { type, locationId, ignored: true };

  return { type, locationId, contact, contactId: String(contact.id || contactId || '').trim() };
}

function extractEmailAddress(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  const angle = s.match(/<([^<>\s]+@[^<>\s]+)>/);
  if (angle) return normalizeEmail(angle[1]);
  if (s.includes('@') && !/\s/.test(s)) return normalizeEmail(s);
  const bare = s.match(/([^\s<>]+@[^\s<>]+)/);
  return bare ? normalizeEmail(bare[1]) : '';
}

function stripHtmlToText(html) {
  return String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parse GHL InboundMessage / OutboundMessage webhooks (SMS + Email).
 * Email payloads use emailMessageId (not messageId) and often HTML bodies.
 */
function parseGhlMessageWebhook(body) {
  if (!body || typeof body !== 'object') return null;
  const type = String(
    body.type || body.event || body.eventType || body.webhookType || '',
  ).trim();
  if (!/^(InboundMessage|OutboundMessage)$/i.test(type)) return null;

  const messageTypeRaw = String(
    body.messageType || body.messageTypeString || body.channel || '',
  ).toUpperCase();
  let channel = 'sms';
  if (messageTypeRaw.includes('EMAIL')) {
    channel = 'email';
  } else if (
    messageTypeRaw &&
    !messageTypeRaw.includes('SMS') &&
    !messageTypeRaw.includes('PHONE')
  ) {
    // Ignore CALL / FB / IG / Live Chat / etc. — not engagement reply channels.
    return null;
  }

  const locationId = String(body.locationId || body.location_id || '').trim();
  const contactId = String(body.contactId || (body.contact && body.contact.id) || '').trim();
  const rawBody = String(
    body.body || body.message || body.text || body.plainText || body.bodyPlain || '',
  ).trim();
  const html = String(body.html || '').trim();
  const subject = String(body.subject || '').trim();
  let content = rawBody;
  // Prefer plain text when the body is HTML (GHL email webhooks).
  if (content && /<\/?[a-z][\s\S]*>/i.test(content)) {
    content = stripHtmlToText(content) || content;
  }
  if (!content && html) content = stripHtmlToText(html);
  if (!content && subject) content = subject;
  // Email replies sometimes arrive with empty body (attachment-only / provider quirks).
  if (!content && channel === 'email') content = '(email reply)';

  const messageId = String(
    body.messageId || body.emailMessageId || body.threadId || body.id || '',
  ).trim();
  if (!contactId || !content) return null;

  let direction = String(body.direction || '').trim().toLowerCase();
  if (!direction) direction = /inbound/i.test(type) ? 'inbound' : 'outbound';

  const fromRaw = body.from || body.fromEmail || (body.contact && body.contact.email) || '';
  const fromEmail = extractEmailAddress(fromRaw);
  const fromPhoneDigits = normalizePhoneKey(
    body.from || body.phone || (body.contact && body.contact.phone) || '',
  );

  return {
    type,
    channel,
    locationId,
    contactId,
    body: content,
    messageId,
    direction,
    conversationId: String(body.conversationId || '').trim(),
    dateAdded: body.dateAdded || body.timestamp || body.createdAt || '',
    status: String(body.status || '').trim(),
    subject,
    fromEmail,
    fromPhone: fromPhoneDigits || '',
  };
}

/** Match webhook contact to a local lead by GHL id, then email, then phone. */
function findLeadForGhlMessage(localLeads, parsed) {
  if (!parsed) return null;
  let lead = findLocalLeadMatch(localLeads, { id: parsed.contactId });
  if (lead) return lead;
  if (parsed.fromEmail) {
    lead = findLocalLeadMatch(localLeads, { email: parsed.fromEmail });
    if (lead) return lead;
  }
  if (parsed.fromPhone) {
    lead = findLocalLeadMatch(localLeads, { phone: parsed.fromPhone });
    if (lead) return lead;
  }
  return null;
}

function parseGhlEngagementWebhook(body) {
  if (!body || typeof body !== 'object') return null;
  const type = String(body.type || body.event || body.eventType || '').trim();
  const blob = type.toLowerCase();
  let signalType = null;
  if (/link.*click|clicked.*link|lc.*link/i.test(blob) || /linkclick/i.test(blob)) {
    signalType = 'link_click';
  } else if (/email.*open|opened.*email|lc.*open|emailopen/i.test(blob)) {
    signalType = 'email_open';
  } else if (body.emailEvent && typeof body.emailEvent === 'object') {
    const ev = String(body.emailEvent.event || body.emailEvent.type || '').toLowerCase();
    if (ev.includes('open')) signalType = 'email_open';
    if (ev.includes('click')) signalType = 'link_click';
  }
  if (!signalType) return null;

  const locationId = String(
    body.locationId || body.location_id || (body.contact && body.contact.locationId) || '',
  ).trim();
  const contactId = String(
    body.contactId || body.id || (body.contact && body.contact.id) || '',
  ).trim();
  if (!contactId) return null;

  return {
    type,
    signalType,
    locationId,
    contactId,
    messageId: String(body.messageId || body.emailMessageId || body.id || '').trim(),
    linkUrl: String(body.linkUrl || body.url || body.link || '').trim(),
    timestamp: body.dateAdded || body.timestamp || body.createdAt || '',
  };
}

/**
 * Handle GHL email open / link click webhooks.
 */
async function processEngagementWebhook(payload, opts = {}) {
  const parsed = parseGhlEngagementWebhook(payload);
  if (!parsed) return { ok: true, ignored: true, reason: 'not_engagement_event' };

  let wid = String(opts.workspaceId || '').trim();
  if (parsed.locationId) {
    const match = await workspaceIntegrations.findWorkspaceIdByGhlLocationId(parsed.locationId);
    if (match) wid = match;
  }
  if (!wid) wid = 'default';

  const localLeads = await dbService.getAllLeads(wid);
  const contactEmail = extractEmailAddress(
    payload.email ||
      payload.from ||
      (payload.contact && (payload.contact.email || payload.contact.Email)) ||
      '',
  );
  const lead =
    findLocalLeadMatch(localLeads, { id: parsed.contactId, email: contactEmail }) ||
    (contactEmail ? findLocalLeadMatch(localLeads, { email: contactEmail }) : null);
  if (!lead || !lead.key) {
    return { ok: true, workspaceId: wid, ignored: true, reason: 'lead_not_found' };
  }

  const applied = await applyEngagementSignal({
    lead,
    workspaceId: wid,
    signalType: parsed.signalType,
    at: parsed.timestamp || new Date().toISOString(),
    createTask: true,
    linkUrl: parsed.linkUrl || '',
    messageId: parsed.messageId || '',
    provider: 'ghl',
  });

  return {
    ok: true,
    workspaceId: wid,
    key: lead.key,
    action: parsed.signalType,
    applied: !!applied.applied,
    taskId: applied.taskId || null,
  };
}

/**
 * Handle inbound/outbound GHL SMS + Email webhooks (InboundMessage / OutboundMessage).
 * @param {object} payload
 * @param {{ workspaceId?: string }} [opts]
 */
async function processMessageWebhook(payload, opts = {}) {
  const parsed = parseGhlMessageWebhook(payload);
  if (!parsed) return { ok: true, ignored: true, reason: 'not_sms_message' };

  let wid = String(opts.workspaceId || '').trim();
  if (parsed.locationId) {
    const match = await workspaceIntegrations.findWorkspaceIdByGhlLocationId(parsed.locationId);
    if (match) wid = match;
  }
  if (!wid) wid = 'default';

  const localLeads = await dbService.getAllLeads(wid);
  const lead = findLeadForGhlMessage(localLeads, parsed);
  if (!lead || !lead.key) {
    return { ok: true, workspaceId: wid, ignored: true, reason: 'lead_not_found' };
  }

  if (parsed.direction === 'inbound') {
    const replyResult = await handleInboundReply({
      lead,
      workspaceId: wid,
      channel: parsed.channel,
      body: parsed.body,
      messageId: parsed.messageId,
      ghlContactId: parsed.contactId,
      conversationId: parsed.conversationId,
      timestamp: parsed.dateAdded || new Date().toISOString(),
    });
    if (replyResult.reason === 'duplicate') {
      return { ok: true, workspaceId: wid, key: lead.key, ignored: true, reason: 'duplicate' };
    }
    if (replyResult.reason === 'opt_out_or_stop') {
      return { ok: true, workspaceId: wid, key: lead.key, ignored: true, reason: 'opt_out_or_stop' };
    }
    return {
      ok: true,
      workspaceId: wid,
      key: lead.key,
      action: parsed.channel === 'email' ? 'email_inbound' : 'sms_inbound',
      messageId: parsed.messageId || null,
      replyHandled: !!replyResult.applied,
      pausedSequence: !!replyResult.pausedSequence,
    };
  }

  const updates = Array.isArray(lead.updates) ? lead.updates : [];
  if (
    parsed.messageId &&
    updates.some(
      (u) =>
        String((u && (u.messageSid || u.ghlMessageId)) || '').trim() === parsed.messageId,
    )
  ) {
    return { ok: true, workspaceId: wid, key: lead.key, ignored: true, reason: 'duplicate' };
  }

  const isSms = parsed.channel === 'sms';
  const entryType = isSms ? 'sms_outbound' : 'email_outbound';

  const newUpdates = [
    ...updates,
    {
      timestamp: parsed.dateAdded || new Date().toISOString(),
      type: entryType,
      value: parsed.body,
      messageSid: parsed.messageId,
      ghlMessageId: parsed.messageId,
      provider: 'ghl',
      ghlContactId: parsed.contactId,
      conversationId: parsed.conversationId,
      status: parsed.status || '',
    },
  ];

  const patch = {
    updates: newUpdates,
    ghlContactId: lead.ghlContactId || parsed.contactId,
    logs: [
      {
        type: entryType,
        message: `Outbound ${isSms ? 'SMS' : 'email'}: ${parsed.body.slice(0, 180)}`,
        timestamp: new Date().toISOString(),
      },
    ],
  };

  await dbService.updateLead(lead.key, patch);

  return {
    ok: true,
    workspaceId: wid,
    key: lead.key,
    action: entryType,
    messageId: parsed.messageId || null,
  };
}

/**
 * Handle inbound GHL contact webhook (ContactCreate / ContactUpdate).
 * @param {object} payload
 * @param {{ workspaceId?: string }} [opts]
 */
async function processWebhook(payload, opts = {}) {
  const parsed = parseGhlWebhookPayload(payload);
  if (!parsed) return { ok: true, ignored: true, reason: 'empty_payload' };
  if (parsed.ignored) return { ok: true, ignored: true, reason: 'unrecognized_payload' };
  if (parsed.delete) return { ok: true, ignored: true, reason: 'contact_delete_skipped' };

  let wid = String(opts.workspaceId || '').trim();
  if (parsed.locationId) {
    const match = await workspaceIntegrations.findWorkspaceIdByGhlLocationId(parsed.locationId);
    if (match) wid = match;
  }
  if (!wid) wid = 'default';

  const integrationEnv = await workspaceIntegrations.getResolvedIntegrationEnv(wid);
  const localLeads = await dbService.getAllLeads(wid);
  const result = await pullContactToLead(parsed.contact, wid, localLeads, integrationEnv);
  if (result.skipped) {
    return { ok: true, workspaceId: wid, ignored: true, reason: result.reason || 'skipped' };
  }
  return {
    ok: true,
    workspaceId: wid,
    action: result.action,
    key: result.key,
    ghlContactId: parsed.contactId || (parsed.contact && parsed.contact.id),
    notesPulled: result.notesPulled || 0,
  };
}

module.exports = {
  GHL_TAG_NO_WEBSITE,
  pushLeadToGhl,
  pushLeads,
  pullContacts,
  syncBoth,
  runDirectionalSync,
  statusFromEnv,
  findLocalLeadMatch,
  findLeadForGhlMessage,
  extractEmailAddress,
  processWebhook,
  processMessageWebhook,
  parseGhlWebhookPayload,
  parseGhlMessageWebhook,
  parseGhlEngagementWebhook,
  processEngagementWebhook,
  pushNotesToGhl,
  pullNotesFromGhl,
};
