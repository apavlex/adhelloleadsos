/**
 * Phone/push alert to everyone in the workspace with alerts on when inbound activity arrives
 * (new form/ad lead, missed call, voicemail, text, email).
 */
const dbService = require('./database');
const push = require('./pushNotifications');
const { userCanAccessWorkspace } = require('./workspaceBootstrap');
const ghlNotificationPrefs = require('./ghlNotificationPrefs');

const TITLES = {
  form: 'New lead',
  missed_call: 'Missed call',
  voicemail: 'New voicemail',
  sms: 'New text',
  email: 'New email',
  missed_call_text_sent: 'Missed-call text sent',
};

function cleanContact(v) {
  const s = String(v || '').trim();
  return s && s.toUpperCase() !== 'N/A' ? s : '';
}

function inboundPushPayload(lead, event, workspaceId) {
  const type = event && event.type;
  if (!TITLES[type] || !lead || !lead.key) return null;
  const short = String(lead.key).replace(/^lead:/i, '');
  const who = String(lead.title || '').trim() || cleanContact(lead.phone) || cleanContact(lead.email) || 'Unknown contact';
  const label = String(event.label || '').trim();
  const preview = String(event.preview || '').replace(/\s+/g, ' ').trim();
  let body;
  if (type === 'form') body = [label, preview].filter(Boolean).join(' — ') || 'Call them in the next 5 minutes.';
  else if (type === 'missed_call' || type === 'voicemail') body = [label, 'Tap to call back.'].filter(Boolean).join(' · ');
  else if (type === 'missed_call_text_sent') {
    body = preview || label || 'Text-back sent via GHL. Waiting for reply.';
  } else body = preview || label || 'Tap to reply.';
  const smsChannel = type === 'sms' || type === 'email' || type === 'missed_call_text_sent';
  const focus = `/focus?lead=${encodeURIComponent(short)}${smsChannel ? '' : '&channel=call'}`;
  return {
    title: `${TITLES[type]}: ${who}`,
    body,
    url: workspaceId
      ? `/workspaces/open?workspaceId=${encodeURIComponent(workspaceId)}&next=${encodeURIComponent(focus)}`
      : focus,
    tag: `inbound-${short}-${type}`,
  };
}

/** Fire-and-forget push when Agency OS sends a missed-call text-back via GHL. */
function notifyMissedCallTextSent({ workspaceId, lead, preview, outcome }) {
  const label = outcome === 'voicemail' ? 'After voicemail' : 'After missed call';
  return notifyInboundEvent({
    workspaceId,
    lead,
    event: {
      type: 'missed_call_text_sent',
      label,
      preview: String(preview || '').replace(/\s+/g, ' ').trim().slice(0, 160),
    },
  });
}

/** One phone ping per contact even when ContactCreate + Form sync both fire. */
const FORM_NOTIFY_DEDUPE_MS = 15 * 60 * 1000;

function formNotifyDedupeKey(workspaceId, lead) {
  const wid = String(workspaceId || '').trim();
  const ghlId = String((lead && lead.ghlContactId) || '').trim();
  const leadKey = String((lead && lead.key) || '').trim();
  const id = ghlId || leadKey;
  if (!wid || !id) return '';
  return `formLeadNotify:${wid}:${id}`;
}

function formEventNotifyKey(workspaceId, eventId) {
  const wid = String(workspaceId || '').trim();
  const id = String(eventId || '').trim();
  if (!wid || !id) return '';
  return `formLeadNotify:${wid}:${id}`;
}

function readFormNotifyClaim(key) {
  const raw = dbService.getKvSync(key);
  if (!raw) return null;
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (_) {
    return null;
  }
}

/**
 * Contact-level claims: legacy rows (no `sent`) count as delivered so we don't
 * re-blast everyone after deploy. Event-level claims: only `sent > 0` counts —
 * a pre-push claim burn must not block retries.
 */
function contactClaimDelivered(claim) {
  if (!claim || !(Number(claim.at) > 0)) return false;
  if (!Object.prototype.hasOwnProperty.call(claim, 'sent')) return true;
  return Number(claim.sent) > 0;
}

function eventClaimDelivered(claim) {
  if (!claim || !(Number(claim.at) > 0)) return false;
  return Number(claim.sent) > 0;
}

/**
 * True when Reviews should attempt a form phone push.
 * Does NOT write claims — record after the send so a 0-send cannot burn the slot.
 */
function shouldAttemptFormNotify(workspaceId, lead, opts = {}) {
  const wid = String(workspaceId || '').trim();
  const key = formNotifyDedupeKey(workspaceId, lead);
  const windowMs = Number(opts.windowMs) > 0 ? Number(opts.windowMs) : FORM_NOTIFY_DEDUPE_MS;
  const now = Date.now();
  const eventId = String((opts.event && opts.event.id) || '').trim();
  const isResubmitEvent = /^(form:ghl-sub:|form:ghl-touch:)/i.test(eventId);

  if (isResubmitEvent) {
    const eventKey = formEventNotifyKey(wid, eventId);
    if (eventKey) {
      const sameEvent = readFormNotifyClaim(eventKey);
      if (eventClaimDelivered(sameEvent) && now - Number(sameEvent.at) < windowMs) {
        return false;
      }
    }
    const prior = key ? readFormNotifyClaim(key) : null;
    const deliveredRecently = contactClaimDelivered(prior) && now - Number(prior.at) < windowMs;
    if (deliveredRecently) {
      const priorForms = (Array.isArray(lead && lead.inboundEvents) ? lead.inboundEvents : [])
        .filter((e) => e && String(e.type || '') === 'form' && String(e.id || '') !== eventId);
      // ContactCreate / contact stamp + later form:ghl-sub are the SAME first fill
      // arriving on two pipes (webhook/contact list, then submissions poll ~2–4 min).
      // Only treat as a true re-fill when a prior real submission already exists.
      const hasPriorRealSubmission = priorForms.some((e) => {
        const id = String(e.id || '');
        return id && !/^(form:ghl-contact:|form:contact-create:)/i.test(id);
      });
      if (!hasPriorRealSubmission) {
        return false;
      }
    }
    return true;
  }

  if (!key) return true;
  const prior = readFormNotifyClaim(key);
  if (contactClaimDelivered(prior) && now - Number(prior.at) < windowMs) {
    return false;
  }
  return true;
}

/** Persist attempt outcome after notifyEnabledMembers runs. */
function recordFormNotifyAttempt(workspaceId, lead, opts = {}) {
  const wid = String(workspaceId || '').trim();
  const key = formNotifyDedupeKey(workspaceId, lead);
  const eventId = String((opts.event && opts.event.id) || '').trim();
  const sent = Math.max(0, Number(opts.sent) || 0);
  const now = Date.now();
  const payload = { at: now, sent, leadKey: String((lead && lead.key) || '') };
  const isResubmitEvent = /^(form:ghl-sub:|form:ghl-touch:)/i.test(eventId);
  const eventKey = formEventNotifyKey(wid, eventId);
  if (eventKey) dbService.setKvSync(eventKey, payload);
  // Only advance the contact-level dedupe slot when a push actually went out
  // (or for non-resubmit first stamps). Failed sends must stay retryable.
  if (key && (sent > 0 || !isResubmitEvent)) {
    dbService.setKvSync(key, payload);
  }
}

/**
 * True when a stamped form event never got a successful Reviews push — sync
 * should call notify again without re-stamping.
 */
function formEventNeedsNotifyRetry(workspaceId, eventId) {
  const eventKey = formEventNotifyKey(workspaceId, eventId);
  if (!eventKey) return true;
  return !eventClaimDelivered(readFormNotifyClaim(eventKey));
}

/** @deprecated Use shouldAttemptFormNotify — kept for callers/tests. */
function claimFormLeadNotify(workspaceId, lead, opts = {}) {
  return shouldAttemptFormNotify(workspaceId, lead, opts);
}

/** Fire-and-forget; never throws. */
function notifyInboundEvent({ workspaceId, lead, event }) {
  const wid = String(workspaceId || (lead && lead.workspaceId) || '').trim();
  const eventType = String((event && event.type) || '').trim().toLowerCase();
  // Website form leads belong in the Reviews / member app only — do not also
  // ring the Agency OS workspace PWA (duplicate lock-screen banners).
  const reviewsOnly = eventType === 'form';
  const payload = wid && !reviewsOnly ? inboundPushPayload(lead, event, wid) : null;
  return (async () => {
    let sent = 0;
    if (payload && push.matchingSubscriptions({ workspaceId: wid }).length) {
      const ws = await dbService.getWorkspace(wid);
      if (ws) {
        const result = await push.sendPush(
          {
            workspaceId: wid,
            allowEmail: (email) => ghlNotificationPrefs.allowPushEmail(
              email,
              eventType,
              (em) => userCanAccessWorkspace(ws, em),
            ),
          },
          payload,
        );
        sent = (result && result.sent) || 0;
      }
    }
    if (eventType === 'form' && !shouldAttemptFormNotify(wid, lead, { event })) {
      return { sent, deduped: true };
    }
    try {
      const memberResult = await require('./memberGhlAlerts').notifyEnabledMembers({
        workspaceId: wid,
        lead,
        event,
      });
      sent += (memberResult && memberResult.sent) || 0;
    } catch (_) { /* ignore */ }
    if (eventType === 'form') {
      recordFormNotifyAttempt(wid, lead, { event, sent });
    }
    return { sent };
  })().catch((e) => {
    console.warn('[inboundPush] failed:', e && e.message);
    return { sent: 0 };
  });
}

module.exports = {
  inboundPushPayload,
  notifyInboundEvent,
  notifyMissedCallTextSent,
  claimFormLeadNotify,
  shouldAttemptFormNotify,
  recordFormNotifyAttempt,
  formEventNeedsNotifyRetry,
  formNotifyDedupeKey,
  formEventNotifyKey,
  FORM_NOTIFY_DEDUPE_MS,
};
