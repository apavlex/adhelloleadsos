const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  buildEngagementInbox,
  inferSignalTypeFromUpdate,
  DEFAULT_WINDOW_DAYS,
} = require('../services/engagementInbox');

const NOW = new Date('2026-08-05T12:00:00.000Z');

function leadWithSignals(key, updates, engagementSignals) {
  return {
    key,
    title: 'Acme Co',
    updates: updates || [],
    engagementSignals: engagementSignals || {},
  };
}

test('buildEngagementInbox flattens update timeline events', () => {
  const leads = [
    leadWithSignals('lead:acme', [
      {
        type: 'engagement_signal',
        signalType: 'sms_reply',
        timestamp: '2026-08-04T10:00:00.000Z',
        value: 'SMS reply from prospect',
      },
      {
        type: 'engagement_signal',
        signalType: 'link_click',
        timestamp: '2026-08-03T10:00:00.000Z',
        value: 'Link click — audit',
      },
    ]),
  ];
  const inbox = buildEngagementInbox(leads, { now: NOW, windowDays: 7 });
  assert.equal(inbox.events.length, 2);
  assert.equal(inbox.summary.uniqueLeads, 1);
  assert.equal(inbox.summary.byType.sms_reply, 1);
  assert.equal(inbox.summary.byType.link_click, 1);
});

test('buildEngagementInbox keeps multiple events per lead', () => {
  const leads = [
    leadWithSignals('lead:acme', [
      {
        type: 'engagement_signal',
        signalType: 'email_open',
        timestamp: '2026-08-04T09:00:00.000Z',
        value: 'Email open',
      },
      {
        type: 'engagement_signal',
        signalType: 'audit_open',
        timestamp: '2026-08-04T11:00:00.000Z',
        value: 'Audit open',
      },
    ]),
  ];
  const inbox = buildEngagementInbox(leads, { now: NOW });
  assert.equal(inbox.events.length, 2);
  assert.ok(inbox.events.every((e) => e.leadKey === 'lead:acme'));
});

test('buildEngagementInbox excludes stale signals outside window', () => {
  const leads = [
    leadWithSignals('lead:old', [
      {
        type: 'engagement_signal',
        signalType: 'sms_reply',
        timestamp: '2026-07-01T10:00:00.000Z',
        value: 'Old reply',
      },
    ]),
  ];
  const inbox = buildEngagementInbox(leads, { now: NOW, windowDays: DEFAULT_WINDOW_DAYS });
  assert.equal(inbox.events.length, 0);
});

test('buildEngagementInbox sorts by priority then recency', () => {
  const leads = [
    leadWithSignals('lead:mix', [
      {
        type: 'engagement_signal',
        signalType: 'email_open',
        timestamp: '2026-08-05T11:00:00.000Z',
        value: 'Email open',
      },
      {
        type: 'engagement_signal',
        signalType: 'sms_reply',
        timestamp: '2026-08-04T11:00:00.000Z',
        value: 'SMS reply',
      },
    ]),
  ];
  const inbox = buildEngagementInbox(leads, { now: NOW });
  assert.equal(inbox.events[0].signalType, 'sms_reply');
  assert.equal(inbox.events[1].signalType, 'email_open');
});

test('buildEngagementInbox filters by signal type', () => {
  const leads = [
    leadWithSignals('lead:acme', [
      {
        type: 'engagement_signal',
        signalType: 'mail_scan',
        timestamp: '2026-08-04T10:00:00.000Z',
        value: 'Postcard QR scan',
      },
      {
        type: 'engagement_signal',
        signalType: 'email_reply',
        timestamp: '2026-08-04T11:00:00.000Z',
        value: 'Email reply',
      },
    ]),
  ];
  const inbox = buildEngagementInbox(leads, { now: NOW, signalType: 'mail_scan' });
  assert.equal(inbox.events.length, 1);
  assert.equal(inbox.events[0].signalType, 'mail_scan');
});

test('buildEngagementInbox synthesizes from engagementSignals fields', () => {
  const leads = [
    leadWithSignals('lead:field', [], {
      auditOpenedAt: '2026-08-04T08:00:00.000Z',
      lastSignalType: 'audit_open',
      lastSignalAt: '2026-08-04T08:00:00.000Z',
    }),
  ];
  const inbox = buildEngagementInbox(leads, { now: NOW });
  assert.equal(inbox.events.length, 1);
  assert.equal(inbox.events[0].signalType, 'audit_open');
  assert.match(inbox.events[0].href, /\/focus\?lead=/);
});

test('buildEngagementInbox dedupes synthesized when update exists', () => {
  const at = '2026-08-04T08:00:00.000Z';
  const leads = [
    leadWithSignals(
      'lead:dup',
      [
        {
          type: 'engagement_signal',
          signalType: 'audit_open',
          timestamp: at,
          value: 'Audit open',
        },
      ],
      { auditOpenedAt: at },
    ),
  ];
  const inbox = buildEngagementInbox(leads, { now: NOW });
  assert.equal(inbox.events.length, 1);
});

test('inferSignalTypeFromUpdate parses legacy value strings', () => {
  assert.equal(
    inferSignalTypeFromUpdate({ value: 'Postcard QR scan — lob' }),
    'mail_scan',
  );
  assert.equal(inferSignalTypeFromUpdate({ signalType: 'email_reply' }), 'email_reply');
});
