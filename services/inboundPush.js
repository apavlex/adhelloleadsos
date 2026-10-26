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
    try {
      const memberResult = await require('./memberGhlAlerts').notifyEnabledMembers({
        workspaceId: wid,
        lead,
        event,
      });
      sent += (memberResult && memberResult.sent) || 0;
    } catch (_) { /* ignore */ }
    return { sent };
  })().catch((e) => {
    console.warn('[inboundPush] failed:', e && e.message);
    return { sent: 0 };
  });
}

module.exports = { inboundPushPayload, notifyInboundEvent, notifyMissedCallTextSent };
