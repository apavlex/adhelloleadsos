/**
 * Bidirectional sync between Agency OS leads and Go High Level contacts.
 */

const dbService = require('./database');
const ghlClient = require('./ghlClient');
const workspaceIntegrations = require('./workspaceIntegrations');
const {
  mergeTagLists,
  normalizeGhlLogSync,
  logFingerprint,
  formatLogAsNoteBody,
  isAgencyOsNoteBody,
  shouldPushLog,
  ghlNoteToLogEntry,
} = require('./ghlSyncHelpers');

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
  const pending = logs.filter((log) => shouldPushLog(log, syncState));
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

async function pushLeadToGhl(lead, integrationEnv) {
  if (!lead || !lead.key) throw new Error('Invalid lead');
  let contactId = String(lead.ghlContactId || '').trim();
  let mergedTags = mergeTagLists(lead.tags);

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

  mergedTags = await ghlClient.syncContactTags(contactId, lead.tags, integrationEnv);
  const notePush = await pushNotesToGhl(lead, contactId, integrationEnv);
  const notePull = await pullNotesFromGhl(lead, contactId, integrationEnv);

  const ghlLogSync = notePush.syncState;
  notePull.syncState.pulledNoteIds.forEach((id) => {
    if (!ghlLogSync.pulledNoteIds.includes(id)) ghlLogSync.pulledNoteIds.push(id);
  });

  const patch = {
    ghlContactId: contactId,
    ghlSyncedAt: new Date().toISOString(),
    ghlSyncDirection: 'push',
    tags: mergedTags,
    ghlLogSync,
  };
  if (notePull.newLogs.length) patch.logs = notePull.newLogs;

  const updated = await dbService.updateLead(lead.key, patch);

  return {
    lead: updated,
    ghlContactId: contactId,
    action: 'pushed',
    notesPushed: notePush.pushed,
    notesPulled: notePull.pulled,
  };
}

async function pullContactToLead(contact, workspaceId, localLeads, integrationEnv) {
  const existing = findLocalLeadMatch(localLeads, contact);
  const patch = ghlClient.ghlContactToLeadPatch(contact, existing);
  if (!patch) return { skipped: true, reason: 'empty_contact' };

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
    const want = new Set(
      opts.leadKeys.flatMap((k) => {
        const s = String(k || '').trim();
        if (!s) return [];
        return [s, s.startsWith('lead:') ? s : `lead:${s}`, s.startsWith('lead:') ? s.slice(5) : null].filter(Boolean);
      }),
    );
    leads = leads.filter((l) => want.has(l.key) || want.has(String(l.key).replace(/^lead:/, '')));
  }

  const limit = Math.min(parseInt(opts.limit, 10) || 500, 500);
  leads = leads.slice(0, limit);

  const results = [];
  for (const lead of leads) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const r = await pushLeadToGhl(lead, integrationEnv);
      results.push({
        key: lead.key,
        ok: true,
        ghlContactId: r.ghlContactId,
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
  pushLeadToGhl,
  pushLeads,
  pullContacts,
  syncBoth,
  statusFromEnv,
  findLocalLeadMatch,
  processWebhook,
  parseGhlWebhookPayload,
  pushNotesToGhl,
  pullNotesFromGhl,
};
