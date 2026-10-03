/**
 * Phone/push alert to everyone in the workspace with alerts on when inbound activity arrives
 * (new form/ad lead, missed call, voicemail, text, email).
 */
const dbService = require('./database');
const push = require('./pushNotifications');
const { userCanAccessWorkspace } = require('./workspaceBootstrap');

const TITLES = {
  form: 'New lead',
  missed_call: 'Missed call',
  voicemail: 'New voicemail',
  sms: 'New text',
  email: 'New email',
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
  else body = preview || label || 'Tap to reply.';
  const focus = `/focus?lead=${encodeURIComponent(short)}${type === 'sms' || type === 'email' ? '' : '&channel=call'}`;
  return {
    title: `${TITLES[type]}: ${who}`,
    body,
    url: workspaceId
      ? `/workspaces/open?workspaceId=${encodeURIComponent(workspaceId)}&next=${encodeURIComponent(focus)}`
      : focus,
    tag: `inbound-${short}-${type}`,
  };
}

/** Fire-and-forget; never throws. */
function notifyInboundEvent({ workspaceId, lead, event }) {
  const wid = String(workspaceId || (lead && lead.workspaceId) || '').trim();
  const payload = wid ? inboundPushPayload(lead, event, wid) : null;
  if (!payload) return Promise.resolve({ sent: 0 });
  return (async () => {
    if (!push.matchingSubscriptions({ workspaceId: wid }).length) return { sent: 0 };
    const ws = await dbService.getWorkspace(wid);
    if (!ws) return { sent: 0 };
    return push.sendPush({ workspaceId: wid, allowEmail: (email) => userCanAccessWorkspace(ws, email) }, payload);
  })().catch((e) => {
    console.warn('[inboundPush] failed:', e && e.message);
    return { sent: 0 };
  });
}

module.exports = { inboundPushPayload, notifyInboundEvent };
