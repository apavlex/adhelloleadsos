const { clampPipelineStage } = require('./pipelineConstants');

function pick(obj, paths) {
  for (const p of paths) {
    const keys = p.split('.');
    let cur = obj;
    for (const k of keys) {
      cur = cur && cur[k];
    }
    if (cur !== undefined && cur !== null && cur !== '') return typeof cur === 'string' ? cur.trim() : cur;
  }
  return '';
}

/** Beehiiv / ConvertKit / generic POST — subscriber → lead */
function fromNewsletterPayload(body) {
  const rawEmail = pick(body, ['email', 'subscriber.email', 'contact.email', 'payload.email']);
  const email = rawEmail ? String(rawEmail).toLowerCase().trim() : '';
  const name =
    pick(body, [
      'name',
      'full_name',
      'subscriber.name',
      'contact.name',
      'payload.name',
      'first_name',
    ]) ||
    (pick(body, ['subscriber.first_name']) && pick(body, ['subscriber.last_name'])
      ? `${pick(body, ['subscriber.first_name'])} ${pick(body, ['subscriber.last_name'])}`.trim()
      : '');

  const utm_source = pick(body, ['utm_source', 'subscriber.utm_source', 'utm.utm_source']);
  const utm_medium = pick(body, ['utm_medium', 'subscriber.utm_medium']);
  const utm_campaign = pick(body, ['utm_campaign', 'subscriber.utm_campaign']);

  const title =
    pick(body, ['company', 'organization', 'subscriber.company']) ||
    (email ? email.split('@')[1] || 'Newsletter signup' : 'Newsletter signup');

  return {
    title,
    email: email || 'N/A',
    phone: pick(body, ['phone']) || 'N/A',
    website: pick(body, ['website', 'company_website']) || 'N/A',
    city: pick(body, ['city']) || '',
    state: pick(body, ['state', 'region']) || '',
    categoryName: 'Lead magnet / newsletter',
    source: 'webhook_newsletter',
    pipelineStage: clampPipelineStage(body.pipelineStage ?? 2),
    signalMetadata: {
      utm_source,
      utm_medium,
      utm_campaign,
      subscriberName: name || undefined,
      rawProvider: pick(body, ['provider', 'source']),
    },
    buyingSignals: ['Newsletter subscriber'],
    status: 'Lead Captured',
  };
}

/** Calendly / Cal.com-style booking → CQI-ready */
function fromBookingPayload(body) {
  const rawInvitee = pick(body, [
    'email',
    'invitee.email',
    'payload.email',
    'attendees.0.email',
    'booking.attendee_email',
  ]);
  const inviteeEmail = rawInvitee ? String(rawInvitee).toLowerCase().trim() : '';
  const inviteeName = pick(body, [
    'name',
    'invitee.name',
    'payload.name',
    'attendees.0.name',
  ]);
  const title =
    inviteeName ||
    (inviteeEmail ? inviteeEmail.split('@')[0] : 'Booked call');

  const eventStart =
    pick(body, [
      'start_time',
      'event.start_time',
      'booking.start_time',
      'scheduled_event.start_time',
    ]) || '';

  return {
    title,
    email: inviteeEmail || 'N/A',
    phone: pick(body, ['phone', 'invitee.phone']) || 'N/A',
    website: pick(body, ['website']) || 'N/A',
    city: pick(body, ['city']) || '',
    state: pick(body, ['state']) || '',
    categoryName: 'Booked discovery',
    source: body.source === 'cal_com' || pick(body, ['provider']) === 'cal.com' ? 'webhook_cal_com' : 'webhook_calendly',
    pipelineStage: clampPipelineStage(body.pipelineStage ?? 4),
    signalMetadata: {
      eventStart,
      eventType: pick(body, ['event_type.name', 'event_type', 'booking.event_type']),
      utm_source: pick(body, ['utm_source']),
      utm_medium: pick(body, ['utm_medium']),
      utm_campaign: pick(body, ['utm_campaign']),
    },
    buyingSignals: ['Booked call'],
    status: 'Discovery Done',
  };
}

/** Typeform / Tally / generic qualification form (same fields as newsletter + form id) */
function fromInboundFormPayload(body) {
  const base = fromNewsletterPayload(body);
  const formId = pick(body, ['form_id', 'formId', 'payload.form_id']);
  return {
    ...base,
    source: body.source || 'webhook_typeform',
    categoryName: pick(body, ['form_name', 'formName']) || 'Qualification form',
    signalMetadata: {
      ...base.signalMetadata,
      formId: formId || undefined,
    },
  };
}

module.exports = {
  fromNewsletterPayload,
  fromBookingPayload,
  fromInboundFormPayload,
};
