const { test } = require('node:test');
const assert = require('node:assert/strict');

const { buildLeadTouchPoints, formatTouchChannelLabel } = require('../services/leadTouchPoints');

const NOW = new Date('2026-08-05T12:00:00.000Z');

test('formatTouchChannelLabel maps known channels', () => {
  assert.equal(formatTouchChannelLabel('call'), 'Phone call');
  assert.equal(formatTouchChannelLabel('direct_mail'), 'Direct mail');
});

test('buildLeadTouchPoints returns recent touches newest first', () => {
  const lead = {
    key: 'lead:acme',
    lastTouchChannel: 'call',
    updates: [
      {
        type: 'quick_log',
        timestamp: '2026-08-04T10:00:00.000Z',
        value: 'Left VM',
        disposition: 'left_vm',
      },
      {
        type: 'engagement_signal',
        signalType: 'sms_reply',
        timestamp: '2026-08-04T11:00:00.000Z',
        value: 'SMS reply from prospect',
      },
    ],
    engagementSignals: {
      lastSignalType: 'sms_reply',
      lastSignalAt: '2026-08-04T11:00:00.000Z',
      smsRepliedAt: '2026-08-04T11:00:00.000Z',
    },
  };
  const tp = buildLeadTouchPoints(lead, { now: NOW, limit: 5 });
  assert.ok(tp.recentTouches.length >= 2);
  assert.match(tp.lastTouch.summary, /Phone call|SMS|Aug/i);
  assert.equal(tp.engagementBadge.label, 'SMS reply');
  assert.ok(tp.totalCount >= 2);
});

test('business replies are pinned first and surfaced as latestReply', () => {
  const lead = {
    key: 'lead:grass',
    updates: [
      { type: 'sms_inbound', timestamp: '2026-08-04T17:03:00.000Z', value: 'This number does not reply to text messages.' },
      { type: 'sms_outbound', timestamp: '2026-08-04T17:04:00.000Z', value: 'Outbound SMS: Thank you for the update!' },
      { type: 'note', timestamp: '2026-08-04T18:00:00.000Z', value: 'Call back Friday' },
    ],
  };
  const tp = buildLeadTouchPoints(lead, { now: NOW, limit: 5 });
  assert.equal(tp.replyCount, 1);
  assert.equal(tp.recentTouches[0].isReply, true);
  assert.match(tp.recentTouches[0].text, /does not reply/);
  assert.ok(tp.latestReply);
  assert.match(tp.latestReply.summary, /reply/i);
  assert.notEqual(tp.lastTouch.at, tp.latestReply.at, 'last touch stays the newest touch overall');
});

test('buildLeadTouchPoints handles empty lead', () => {
  const tp = buildLeadTouchPoints({ key: 'lead:new', updates: [] }, { now: NOW });
  assert.equal(tp.recentTouches.length, 0);
  assert.equal(tp.totalCount, 0);
  assert.equal(tp.engagementBadge, null);
});
