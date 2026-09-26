const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  getQuickLogClientPayload,
  visibleQuickLogItems,
} = require('../services/quickLogConfig');

describe('quickLogConfig agency-only pills', () => {
  it('hides Site audit for non-agency workspaces', () => {
    const payload = getQuickLogClientPayload({ agencySales: false });
    assert.equal(
      payload.items.some((i) => i.disposition === 'site_audit'),
      false
    );
    assert.equal(payload.tagConfig['Site audit'], undefined);
    assert.equal(payload.pillLabelsPattern.includes('Site audit'), false);
  });

  it('includes Site audit for agency workspaces', () => {
    const payload = getQuickLogClientPayload({ agencySales: true });
    assert.equal(
      payload.items.some((i) => i.disposition === 'site_audit'),
      true
    );
    assert.equal(payload.tagConfig['Site audit'].disposition, 'site_audit');
    assert.match(payload.pillLabelsPattern, /Site audit/);
  });

  it('visibleQuickLogItems respects agencySales', () => {
    assert.equal(
      visibleQuickLogItems({ agencySales: false }).some((i) => i.disposition === 'site_audit'),
      false
    );
    assert.equal(
      visibleQuickLogItems({ agencySales: true }).some((i) => i.disposition === 'site_audit'),
      true
    );
  });

  it('includes Connected quick-log pill', () => {
    const payload = getQuickLogClientPayload({ agencySales: false });
    const connected = payload.items.find((i) => i.disposition === 'connected');
    assert.ok(connected);
    assert.equal(connected.label, 'Connected');
    assert.equal(payload.tagConfig.Connected.disposition, 'connected');
    assert.match(payload.pillLabelsPattern, /Connected/);
  });
});
