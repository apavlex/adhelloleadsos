/**
 * Bridge website forms → Reviews when GHL only creates a contact (Lead Connector
 * widget) and never fires Form Submitted / ContactCreate at AdHello.
 *
 * Prefers GHL form *submissions* (one notify per submission id) so the same
 * person filling the form again (e.g. Alex → Alex Pavlenko) still alerts.
 * Falls back to recent contacts for first-time Lead Connector creates.
 */
const dbService = require('./database');
const ghlClient = require('./ghlClient');
const workspaceIntegrations = require('./workspaceIntegrations');
const { appendInboundEvent } = require('./inboundEvents');
const { notifyInboundEvent } = require('./inboundPush');
const { websiteFormLabel } = require('./websiteFormLabel');
const { findLocalLeadMatch, pullContactToLead } = require('./ghlSync');
const {
  answersFromContact,
  answersFromSubmission,
  answersPreview,
  normalizeFormAnswers,
} = require('./ghlFormAnswers');

const THROTTLE_MS = 45 * 1000;
/** How far back to scan GHL contacts for the Reviews inbox. */
const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** First sync after deploy: only phone-notify contacts newer than this. */
const DEFAULT_NOTIFY_MAX_AGE_MS = 2 * 60 * 60 * 1000;
const DEFAULT_LIMIT = 40;

function throttleKey(wid) {
  return `ghlFormLeadSync:${wid}`;
}

function contactAddedMs(contact) {
  const raw = contact && (
    contact.dateAdded
    || contact.dateCreated
    || contact.createdAt
    || contact.date_added
  );
  const t = Date.parse(String(raw || ''));
  return Number.isFinite(t) ? t : 0;
}

function contactUpdatedMs(contact) {
  const raw = contact && (
    contact.dateUpdated
    || contact.updatedAt
    || contact.lastActivity
    || contact.date_updated
  );
  const t = Date.parse(String(raw || ''));
  return Number.isFinite(t) ? t : 0;
}

function submissionCreatedMs(submission) {
  const raw = submission && (
    submission.createdAt
    || submission.submittedAt
    || submission.dateAdded
    || submission.updatedAt
  );
  const t = Date.parse(String(raw || ''));
  return Number.isFinite(t) ? t : 0;
}

function lastFormEventMs(lead) {
  const prior = Array.isArray(lead && lead.inboundEvents) ? lead.inboundEvents : [];
  let best = 0;
  for (const e of prior) {
    if (!e || String(e.type || '') !== 'form') continue;
    const t = Date.parse(String(e.at || ''));
    if (Number.isFinite(t) && t > best) best = t;
  }
  return best;
}

function ymd(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function sourceHint(contact) {
  return String(
    (contact && (
      contact.source
      || contact.contactSource
      || contact.type
      || contact.attributionSource
      || (contact.attributionSource && contact.attributionSource.sessionSource)
    )) || '',
  ).trim().slice(0, 120);
}

function looksLikeWebsiteForm(contact) {
  const hint = `${sourceHint(contact)} ${Array.isArray(contact && contact.tags) ? contact.tags.join(' ') : ''}`.toLowerCase();
  // Prefer form/web sources; still accept blank source for brand-new contacts
  // (Lead Connector forms often leave source empty).
  if (!hint.trim()) return true;
  if (/manual|import|csv|api|bulk|referral.?partner|teammate/.test(hint)) return false;
  return /form|website|web|facebook|fb|lead|landing|funnel|survey|chat|widget|typeform|jotform|inbound|paid.?social|google|ads|ai_?studio|studio/.test(hint)
    || hint.length > 0;
}

function hasFormEvent(lead, formEventId) {
  const prior = Array.isArray(lead && lead.inboundEvents) ? lead.inboundEvents : [];
  return prior.some((e) => e && e.id === formEventId);
}

async function resolveLeadForContact(contact, wid, localLeads, integrationEnv) {
  let lead = findLocalLeadMatch(localLeads, contact);
  if (lead) return lead;
  try {
    const pulled = await pullContactToLead(contact, wid, localLeads, integrationEnv);
    if (pulled && pulled.skipped) return null;
    lead = pulled.lead || (pulled.key ? await dbService.getLead(pulled.key, wid) : null);
    if (lead && !localLeads.some((l) => l && l.key === lead.key)) localLeads.push(lead);
    return lead || null;
  } catch (err) {
    console.warn('[ghlFormLeadSync] pull failed:', err && err.message);
    return null;
  }
}

/**
 * Stamp a form inbound event + Reviews notify. Returns { synced, notified }.
 */
async function stampFormLead({
  wid,
  lead,
  localLeads,
  formEventId,
  at,
  label,
  answers,
  contact,
}) {
  const prior = Array.isArray(lead.inboundEvents) ? lead.inboundEvents : [];
  if (prior.some((e) => e && e.id === formEventId)) {
    return { synced: 0, notified: 0 };
  }
  const formEvent = {
    id: formEventId,
    type: 'form',
    at,
    label,
    preview: answersPreview(answers),
    answers: normalizeFormAnswers(answers),
    source: 'ghl',
    ghlContactId: String((contact && contact.id) || lead.ghlContactId || '').trim() || undefined,
  };
  const patch = {
    inboundSource: 'ghl',
    inboundAt: at,
    inboundFormName: label,
    inboundEvents: appendInboundEvent(prior, formEvent),
    ghlContactId: lead.ghlContactId || formEvent.ghlContactId || '',
    formAnswers: normalizeFormAnswers(answers),
    inboundHandledAt: '',
  };
  // Enrich title/name when the new submission has a fuller name (Alex → Alex Pavlenko).
  const subName = String(
    (contact && (contact.name || contact.fullName || [contact.firstName, contact.lastName].filter(Boolean).join(' ')))
    || '',
  ).trim();
  if (subName && subName.length > String(lead.title || '').trim().length) {
    patch.title = subName.slice(0, 120);
  }

  const updated = await dbService.updateLead(lead.key, patch, wid);
  const next = updated || { ...lead, ...patch };
  const idx = localLeads.findIndex((l) => l && l.key === lead.key);
  if (idx >= 0) localLeads[idx] = next;

  try {
    const appointmentPackages = require('./appointmentPackages');
    const name = String(
      subName || next.title || 'Lead',
    ).trim().slice(0, 120) || 'Lead';
    await appointmentPackages.attachFormLead(wid, {
      leadKey: next.key,
      name,
      phone: (contact && contact.phone) || next.phone || null,
      email: (contact && contact.email) || next.email || null,
      formName: label,
      preview: formEvent.preview,
      answers: formEvent.answers,
      source: 'ghl',
      at,
      status: 'open',
      id: formEventId,
    }, {
      lead: next,
      formName: label,
      contactEmail: (contact && contact.email) || next.email,
      silent: true,
    });
  } catch (attachErr) {
    console.warn('[ghlFormLeadSync] attach failed:', attachErr && attachErr.message);
  }

  await notifyInboundEvent({ workspaceId: wid, lead: next, event: formEvent });
  return { synced: 1, notified: 1 };
}

/**
 * @returns {{ synced: number, notified: number, skipped?: string }}
 */
async function syncRecentFormLeads(workspaceId, opts = {}) {
  const wid = String(workspaceId || '').trim();
  if (!wid) return { synced: 0, notified: 0, skipped: 'no_workspace' };

  const now = Date.now();
  const minInterval = Number(opts.minIntervalMs) > 0 ? Number(opts.minIntervalMs) : THROTTLE_MS;
  const rawKv = dbService.getKvSync(throttleKey(wid));
  let rawState = rawKv;
  if (typeof rawKv === 'string') {
    try { rawState = JSON.parse(rawKv); } catch (_) { rawState = null; }
  }
  const priorState = {
    at: Number(rawState && rawState.at) || 0,
    watermarkMs: Number(rawState && rawState.watermarkMs) || 0,
  };
  if (!opts.force) {
    if (priorState.at && now - priorState.at < minInterval) {
      return { synced: 0, notified: 0, skipped: 'throttled' };
    }
  }

  const integrationEnv = await workspaceIntegrations.getResolvedIntegrationEnv(wid);
  if (!ghlClient.isConfigured(integrationEnv)) {
    dbService.setKvSync(throttleKey(wid), { at: now, watermarkMs: priorState.watermarkMs });
    return { synced: 0, notified: 0, skipped: 'no_ghl' };
  }

  const maxAgeMs = Number(opts.maxAgeMs) > 0 ? Number(opts.maxAgeMs) : DEFAULT_MAX_AGE_MS;
  const notifyMaxAgeMs = Number(opts.notifyMaxAgeMs) > 0
    ? Number(opts.notifyMaxAgeMs)
    : DEFAULT_NOTIFY_MAX_AGE_MS;
  const scanCutoff = now - maxAgeMs;
  const notifyFloor = now - notifyMaxAgeMs;
  let watermarkMs = Number(priorState.watermarkMs);
  if (!Number.isFinite(watermarkMs) || watermarkMs <= 0) {
    watermarkMs = notifyFloor;
  }
  const limit = Math.min(100, Math.max(5, Number(opts.limit) || DEFAULT_LIMIT));

  let fieldCatalog = [];
  try {
    fieldCatalog = await ghlClient.listLocationContactCustomFields(integrationEnv);
  } catch (err) {
    console.warn('[ghlFormLeadSync] custom field catalog failed:', err && err.message);
  }

  const localLeads = await dbService.getAllLeads(wid);
  let synced = 0;
  let notified = 0;
  let maxSeenAdded = watermarkMs;
  const seenContactIds = new Set();

  // ── 1) Form submissions (re-submits by the same contact get a new id) ──────
  let submissions = [];
  let submissionsFailed = false;
  async function pullSubmissions(query) {
    const batch = await ghlClient.listFormSubmissions(integrationEnv, query);
    return Array.isArray(batch.submissions) ? batch.submissions : [];
  }
  try {
    // GHL startAt/endAt are YYYY-MM-DD; endAt defaults to "today" — use today, not tomorrow.
    submissions = await pullSubmissions({
      limit,
      startAt: ymd(Math.min(scanCutoff, notifyFloor)),
      endAt: ymd(now),
    });
  } catch (err) {
    console.warn('[ghlFormLeadSync] listFormSubmissions (dated) failed:', err && err.message);
  }
  try {
    // Retry bare when dated call failed or returned nothing (wrong Version / date filter quirks).
    if (!submissions.length) {
      submissions = await pullSubmissions({ limit });
    }
  } catch (err) {
    submissionsFailed = true;
    console.warn('[ghlFormLeadSync] listFormSubmissions failed:', err && err.message);
  }

  const recentSubs = submissions
    .filter((s) => s && String(s.id || '').trim())
    .filter((s) => {
      const created = submissionCreatedMs(s);
      // Missing timestamps: still treat as notify-eligible (Lead Connector quirks).
      return !created || created >= notifyFloor;
    })
    .sort((a, b) => submissionCreatedMs(b) - submissionCreatedMs(a));

  for (const sub of recentSubs) {
    const subId = String(sub.id || '').trim();
    const formEventId = `form:ghl-sub:${subId}`;
    const ghlId = String(sub.contactId || '').trim();
    let contact = {
      id: ghlId,
      name: sub.name || '',
      email: sub.email || '',
      phone: sub.phone || '',
    };
    if (ghlId) {
      seenContactIds.add(ghlId);
      try {
        // eslint-disable-next-line no-await-in-loop
        const remote = await ghlClient.getContact(ghlId, integrationEnv);
        if (remote && typeof remote === 'object') {
          contact = {
            ...remote,
            name: sub.name || remote.name || contact.name,
            email: sub.email || remote.email || contact.email,
            phone: sub.phone || remote.phone || contact.phone,
          };
        }
      } catch (err) {
        console.warn('[ghlFormLeadSync] getContact for submission failed:', err && err.message);
      }
    }

    // eslint-disable-next-line no-await-in-loop
    const lead = await resolveLeadForContact(contact, wid, localLeads, integrationEnv);
    if (!lead || !lead.key) continue;
    if (hasFormEvent(lead, formEventId)) continue;

    const answers = answersFromSubmission(sub, fieldCatalog);
    const at = new Date(now).toISOString();
    const label = websiteFormLabel({
      formName: sourceHint(contact) || sub.name,
      label: sourceHint(contact),
      websiteUrl: contact.website || contact.websiteUrl || '',
      businessName: contact.companyName || '',
    });
    try {
      // eslint-disable-next-line no-await-in-loop
      const out = await stampFormLead({
        wid,
        lead,
        localLeads,
        formEventId,
        at,
        label,
        answers: answers.length ? answers : answersFromContact(contact, fieldCatalog),
        contact,
      });
      synced += out.synced;
      notified += out.notified;
      const created = submissionCreatedMs(sub);
      if (created > maxSeenAdded) maxSeenAdded = created;
    } catch (err) {
      console.warn('[ghlFormLeadSync] submission stamp failed:', err && err.message);
    }
  }

  // ── 2) Fallback: brand-new contacts with no submission row yet ────────────
  let contacts = [];
  try {
    const batch = await ghlClient.listContacts(integrationEnv, { limit });
    contacts = Array.isArray(batch.contacts) ? batch.contacts : [];
  } catch (err) {
    console.warn('[ghlFormLeadSync] listContacts failed:', err && err.message);
    dbService.setKvSync(throttleKey(wid), { at: now, watermarkMs: priorState.watermarkMs });
    return { synced, notified, skipped: synced || notified ? undefined : 'list_failed' };
  }

  const recent = contacts
    .filter((c) => c && contactAddedMs(c) >= scanCutoff)
    .filter((c) => looksLikeWebsiteForm(c))
    .sort((a, b) => contactAddedMs(b) - contactAddedMs(a));

  for (const contact of recent) {
    const ghlId = String(contact.id || '').trim();
    if (!ghlId) continue;
    const addedMs = contactAddedMs(contact) || now;
    if (addedMs > maxSeenAdded) maxSeenAdded = addedMs;
    // Already handled via a fresh submission above.
    if (seenContactIds.has(ghlId)) continue;

    const formEventId = `form:ghl-contact:${ghlId}`;
    const updatedMs = contactUpdatedMs(contact);
    // Re-touch: same contact updated again (form re-fill without a new submission id).
    const retouchId = (updatedMs >= notifyFloor && updatedMs > addedMs + 5000)
      ? `form:ghl-touch:${ghlId}:${updatedMs}`
      : '';
    const shouldNotifyNew = addedMs >= notifyFloor;
    const shouldNotifyTouch = !!retouchId;

    // eslint-disable-next-line no-await-in-loop
    const lead = await resolveLeadForContact(contact, wid, localLeads, integrationEnv);
    if (!lead || !lead.key) continue;

    let eventId = '';
    if (shouldNotifyNew && !hasFormEvent(lead, formEventId)) {
      eventId = formEventId;
    } else if (shouldNotifyTouch && !hasFormEvent(lead, retouchId) && hasFormEvent(lead, formEventId)) {
      // Only retouch when the once-per-contact stamp already exists (true re-fill).
      eventId = retouchId;
    } else {
      continue;
    }

    let fullContact = contact;
    try {
      // eslint-disable-next-line no-await-in-loop
      const remote = await ghlClient.getContact(ghlId, integrationEnv);
      if (remote && typeof remote === 'object') fullContact = remote;
    } catch (err) {
      console.warn('[ghlFormLeadSync] getContact failed:', err && err.message);
    }
    let answers = answersFromContact(fullContact, fieldCatalog);
    if (!answers.length || answers.every((a) => ['Company', 'Source', 'Address', 'Website', 'Type'].includes(a.q))) {
      try {
        const { fetchContactFormAnswers } = require('./ghlFormAnswers');
        // eslint-disable-next-line no-await-in-loop
        const richer = await fetchContactFormAnswers(fullContact, integrationEnv, {
          catalog: fieldCatalog,
          email: fullContact.email,
          phone: fullContact.phone,
          includeCoreFallback: false,
        });
        if (richer.length) answers = richer;
      } catch (_) { /* keep contact-derived answers */ }
    }

    const at = new Date(now).toISOString();
    const label = websiteFormLabel({
      formName: sourceHint(fullContact),
      label: sourceHint(fullContact),
      websiteUrl: fullContact.website || fullContact.websiteUrl || '',
      businessName: fullContact.companyName || '',
    });
    try {
      // eslint-disable-next-line no-await-in-loop
      const out = await stampFormLead({
        wid,
        lead,
        localLeads,
        formEventId: eventId,
        at,
        label,
        answers,
        contact: fullContact,
      });
      synced += out.synced;
      notified += out.notified;
    } catch (err) {
      console.warn('[ghlFormLeadSync] stamp failed:', err && err.message);
    }
  }

  // ── 3) Retouch known form leads (submissions empty / contact not on first page) ─
  // Same person filling again often keeps dateAdded old, so listContacts misses them.
  // Pull each already-stamped form contact by id and notify on a fresh dateUpdated.
  const knownFormLeads = localLeads.filter((l) => {
    if (!l || !String(l.ghlContactId || '').trim()) return false;
    const events = Array.isArray(l.inboundEvents) ? l.inboundEvents : [];
    return events.some((e) => e && String(e.type || '') === 'form');
  });
  for (const priorLead of knownFormLeads) {
    const ghlId = String(priorLead.ghlContactId || '').trim();
    if (!ghlId || seenContactIds.has(ghlId)) continue;
    let fullContact = null;
    try {
      // eslint-disable-next-line no-await-in-loop
      fullContact = await ghlClient.getContact(ghlId, integrationEnv);
    } catch (err) {
      console.warn('[ghlFormLeadSync] retouch getContact failed:', err && err.message);
      continue;
    }
    if (!fullContact || typeof fullContact !== 'object') continue;
    const updatedMs = contactUpdatedMs(fullContact);
    if (!updatedMs || updatedMs < notifyFloor) continue;
    const lastForm = lastFormEventMs(priorLead);
    if (lastForm && updatedMs <= lastForm + 5000) continue;
    const retouchId = `form:ghl-touch:${ghlId}:${updatedMs}`;
    if (hasFormEvent(priorLead, retouchId)) continue;

    let answers = answersFromContact(fullContact, fieldCatalog);
    if (!answers.length || answers.every((a) => ['Company', 'Source', 'Address', 'Website', 'Type'].includes(a.q))) {
      try {
        const { fetchContactFormAnswers } = require('./ghlFormAnswers');
        // eslint-disable-next-line no-await-in-loop
        const richer = await fetchContactFormAnswers(fullContact, integrationEnv, {
          catalog: fieldCatalog,
          email: fullContact.email,
          phone: fullContact.phone,
          includeCoreFallback: false,
        });
        if (richer.length) answers = richer;
      } catch (_) { /* keep contact-derived answers */ }
    }
    const at = new Date(now).toISOString();
    const label = websiteFormLabel({
      formName: sourceHint(fullContact),
      label: sourceHint(fullContact),
      websiteUrl: fullContact.website || fullContact.websiteUrl || '',
      businessName: fullContact.companyName || '',
    });
    try {
      // eslint-disable-next-line no-await-in-loop
      const out = await stampFormLead({
        wid,
        lead: priorLead,
        localLeads,
        formEventId: retouchId,
        at,
        label,
        answers,
        contact: fullContact,
      });
      synced += out.synced;
      notified += out.notified;
      seenContactIds.add(ghlId);
    } catch (err) {
      console.warn('[ghlFormLeadSync] retouch stamp failed:', err && err.message);
    }
  }

  if (submissionsFailed && !synced && !notified) {
    console.warn('[ghlFormLeadSync] no form submissions available — ensure GHL private integration has forms.readonly');
  }

  dbService.setKvSync(throttleKey(wid), {
    at: now,
    watermarkMs: Math.max(watermarkMs, maxSeenAdded),
  });

  return { synced, notified };
}

module.exports = {
  syncRecentFormLeads,
  contactAddedMs,
  contactUpdatedMs,
  looksLikeWebsiteForm,
  sourceHint,
  THROTTLE_MS,
  DEFAULT_NOTIFY_MAX_AGE_MS,
};
