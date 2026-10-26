/**
 * Bridge website forms → Reviews when GHL only creates a contact (Lead Connector
 * widget) and never fires Form Submitted / ContactCreate at AdHello.
 *
 * Pulls recent GHL contacts, stamps a form inbound event once per contact, and
 * fans out through notifyInboundEvent (Reviews network notify path only).
 */
const dbService = require('./database');
const ghlClient = require('./ghlClient');
const workspaceIntegrations = require('./workspaceIntegrations');
const { appendInboundEvent } = require('./inboundEvents');
const { notifyInboundEvent } = require('./inboundPush');
const { findLocalLeadMatch, pullContactToLead } = require('./ghlSync');

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

/**
 * @returns {{ synced: number, notified: number, skipped?: string }}
 */
async function syncRecentFormLeads(workspaceId, opts = {}) {
  const wid = String(workspaceId || '').trim();
  if (!wid) return { synced: 0, notified: 0, skipped: 'no_workspace' };

  const now = Date.now();
  const minInterval = Number(opts.minIntervalMs) > 0 ? Number(opts.minIntervalMs) : THROTTLE_MS;
  const rawState = dbService.getKvSync(throttleKey(wid));
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
  // High-water mark so we never re-blast old contacts on every bell open.
  let watermarkMs = Number(priorState.watermarkMs);
  if (!Number.isFinite(watermarkMs) || watermarkMs <= 0) {
    watermarkMs = now - notifyMaxAgeMs;
  }
  const notifyCutoff = Math.max(scanCutoff, watermarkMs);
  const limit = Math.min(100, Math.max(5, Number(opts.limit) || DEFAULT_LIMIT));

  let contacts = [];
  try {
    const batch = await ghlClient.listContacts(integrationEnv, { limit });
    contacts = Array.isArray(batch.contacts) ? batch.contacts : [];
  } catch (err) {
    console.warn('[ghlFormLeadSync] listContacts failed:', err && err.message);
    dbService.setKvSync(throttleKey(wid), { at: now, watermarkMs: priorState.watermarkMs });
    return { synced: 0, notified: 0, skipped: 'list_failed' };
  }

  const recent = contacts
    .filter((c) => c && contactAddedMs(c) >= scanCutoff)
    .filter((c) => looksLikeWebsiteForm(c))
    .sort((a, b) => contactAddedMs(b) - contactAddedMs(a));

  const localLeads = await dbService.getAllLeads(wid);
  let synced = 0;
  let notified = 0;
  let maxSeenAdded = watermarkMs;

  for (const contact of recent) {
    const ghlId = String(contact.id || '').trim();
    if (!ghlId) continue;
    const addedMs = contactAddedMs(contact) || now;
    if (addedMs > maxSeenAdded) maxSeenAdded = addedMs;
    const formEventId = `form:ghl-contact:${ghlId}`;
    const shouldNotify = addedMs > notifyCutoff;

    let lead = findLocalLeadMatch(localLeads, contact);
    if (!lead) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const pulled = await pullContactToLead(contact, wid, localLeads, integrationEnv);
        if (pulled && pulled.skipped) continue;
        lead = pulled.lead || (pulled.key ? await dbService.getLead(pulled.key, wid) : null);
        if (lead && !localLeads.some((l) => l && l.key === lead.key)) localLeads.push(lead);
      } catch (err) {
        console.warn('[ghlFormLeadSync] pull failed:', err && err.message);
        continue;
      }
    }
    if (!lead || !lead.key) continue;

    const prior = Array.isArray(lead.inboundEvents) ? lead.inboundEvents : [];
    if (prior.some((e) => e && e.id === formEventId)) continue;

    // Older than the notify window: leave alone (avoid flooding Waiting on a reply
    // with historical GHL contacts). Only brand-new ones get stamped + pushed.
    if (!shouldNotify) continue;

    const at = new Date(addedMs).toISOString();
    const label = sourceHint(contact) || 'Website form';
    const formEvent = {
      id: formEventId,
      type: 'form',
      at,
      label,
      preview: '',
      source: 'ghl',
      ghlContactId: ghlId,
    };
    const patch = {
      inboundSource: 'ghl',
      inboundAt: at,
      inboundFormName: label,
      inboundEvents: appendInboundEvent(prior, formEvent),
      ghlContactId: lead.ghlContactId || ghlId,
    };
    try {
      // eslint-disable-next-line no-await-in-loop
      const updated = await dbService.updateLead(lead.key, patch, wid);
      const next = updated || { ...lead, ...patch };
      const idx = localLeads.findIndex((l) => l && l.key === lead.key);
      if (idx >= 0) localLeads[idx] = next;
      synced += 1;

      try {
        const appointmentPackages = require('./appointmentPackages');
        const name = String(
          (contact.name || contact.fullName || contact.companyName)
          || next.title
          || 'Lead',
        ).trim().slice(0, 120) || 'Lead';
        // eslint-disable-next-line no-await-in-loop
        await appointmentPackages.attachFormLead(wid, {
          leadKey: next.key,
          name,
          phone: contact.phone || next.phone || null,
          email: contact.email || next.email || null,
          formName: label,
          preview: '',
          source: 'ghl',
          at,
          status: 'open',
          id: formEventId,
        }, {
          lead: next,
          formName: label,
          contactEmail: contact.email || next.email,
          silent: true, // notify once via notifyInboundEvent (Reviews only)
        });
      } catch (attachErr) {
        console.warn('[ghlFormLeadSync] attach failed:', attachErr && attachErr.message);
      }

      // Reviews-only phone push (Agency OS workspace push skipped for forms).
      // eslint-disable-next-line no-await-in-loop
      await notifyInboundEvent({ workspaceId: wid, lead: next, event: formEvent });
      notified += 1;
    } catch (err) {
      console.warn('[ghlFormLeadSync] stamp failed:', err && err.message);
    }
  }

  dbService.setKvSync(throttleKey(wid), {
    at: now,
    watermarkMs: Math.max(watermarkMs, maxSeenAdded, now - 5000),
  });

  return { synced, notified };
}

module.exports = {
  syncRecentFormLeads,
  contactAddedMs,
  looksLikeWebsiteForm,
  sourceHint,
  THROTTLE_MS,
  DEFAULT_NOTIFY_MAX_AGE_MS,
};
