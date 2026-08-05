const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  resolveDialRetryPrefs,
  resolveNoAnswerRetryAt,
  formatRetryDelayLabel,
  isLeadDeferredForRetry,
} = require('../services/dialRetryPrefs');
const { buildFocusQueue } = require('../services/focusQueue');

describe('dialRetryPrefs', () => {
  it('defaults auto no-answer on dial', () => {
    const prefs = resolveDialRetryPrefs({});
    assert.equal(prefs.autoNoAnswerOnDial, true);
    assert.equal(prefs.retrySchedule, '18h');
    assert.equal(prefs.queueMode, 'continue_list');
  });

  it('resolveNoAnswerRetryAt supports 3 day schedule', () => {
    const now = new Date('2026-08-05T14:00:00.000Z');
    const prefs = resolveDialRetryPrefs({ dialRetry: { retrySchedule: '3d', retryAtHourLocal: 10 } });
    const at = resolveNoAnswerRetryAt(prefs, now);
    assert.ok(at.getTime() > now.getTime());
    const diffDays = Math.round((at.getTime() - now.getTime()) / 86400000);
    assert.equal(diffDays, 3);
  });

  it('isLeadDeferredForRetry when nextActionAt is in future', () => {
    const lead = { nextActionAt: new Date(Date.now() + 86400000).toISOString() };
    assert.equal(isLeadDeferredForRetry(lead, 'continue_list'), true);
    assert.equal(isLeadDeferredForRetry(lead, 'retry_when_due'), false);
  });

  it('formatRetryDelayLabel shows days for long windows', () => {
    const now = new Date('2026-08-05T10:00:00.000Z');
    const label = formatRetryDelayLabel('2026-08-08T10:00:00.000Z', now);
    assert.match(label, /3 day/);
  });
});

describe('buildFocusQueue dial retry deferral', () => {
  it('puts deferred retry leads after fresh leads in continue_list mode', () => {
    const fresh = { key: 'lead:1', pipelineStage: 1, title: 'Fresh' };
    const deferred = {
      key: 'lead:2',
      pipelineStage: 1,
      title: 'Deferred',
      nextActionAt: new Date(Date.now() + 3 * 86400000).toISOString(),
    };
    const ordered = buildFocusQueue([deferred, fresh], 10, { queueMode: 'continue_list' });
    assert.equal(ordered[0].key, 'lead:1');
    assert.equal(ordered[1].key, 'lead:2');
  });

  it('excludes deferred leads in retry_when_due mode', () => {
    const fresh = { key: 'lead:1', pipelineStage: 1, title: 'Fresh' };
    const deferred = {
      key: 'lead:2',
      pipelineStage: 1,
      title: 'Deferred',
      nextActionAt: new Date(Date.now() + 3 * 86400000).toISOString(),
    };
    const ordered = buildFocusQueue([deferred, fresh], 10, { queueMode: 'retry_when_due' });
    assert.equal(ordered.length, 1);
    assert.equal(ordered[0].key, 'lead:1');
  });
});
