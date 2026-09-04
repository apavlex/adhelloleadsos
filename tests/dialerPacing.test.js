const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  resolveLeadTimezone,
  tzFromPhone,
  selectCallerIdForDial,
  inAllowedWindow,
} = require('../services/dialerPacing');

describe('dialerPacing lead timezone', () => {
  it('maps 360 WA numbers to Pacific', () => {
    assert.equal(tzFromPhone('+13608313027'), 'America/Los_Angeles');
    assert.equal(tzFromPhone('(360) 831-3027'), 'America/Los_Angeles');
  });

  it('prefers phone/state over a stale New York timezone on the lead', () => {
    assert.equal(
      resolveLeadTimezone(
        { phone: '+13608313027', timezone: 'America/New_York', state: '' },
        'America/New_York',
      ),
      'America/Los_Angeles',
    );
    assert.equal(
      resolveLeadTimezone({ phone: '', state: 'WA', timezone: 'America/New_York' }, 'America/New_York'),
      'America/Los_Angeles',
    );
  });

  it('allows a Pacific lead at 5pm PT when window ends at 8pm local', () => {
    // 2026-09-03 17:14 America/Los_Angeles == 2026-09-04 00:14 UTC
    const now = new Date('2026-09-04T00:14:00.000Z');
    const telephony = {
      numberBank: ['+13607935057'],
      quietHoursStart: '08:00',
      quietHoursEnd: '20:00',
    };
    const result = selectCallerIdForDial({
      workspace: { timezone: 'America/New_York' },
      telephony,
      lead: { phone: '+13608313027', title: 'Signature Hardwood Floors' },
      now,
    });
    assert.equal(result.allowed, true);
    assert.equal(result.leadTimezone, 'America/Los_Angeles');
  });

  it('blocks when local lead time is past dial end', () => {
    assert.equal(inAllowedWindow(20 * 60 + 14, '08:00', '20:00'), false);
    assert.equal(inAllowedWindow(17 * 60 + 14, '08:00', '20:00'), true);
  });
});
