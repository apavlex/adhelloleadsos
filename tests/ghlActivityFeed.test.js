const test = require('node:test');
const assert = require('node:assert/strict');
const {
  listGhlCallSmsItems,
  pendingInboundItems,
  normalizeInboundEvent,
} = require('../services/inboundEvents');
const { leadConnectorOpenUrl } = require('../services/ghlDeepLinks');

test('leadConnectorOpenUrl builds contact and conversation URLs', () => {
  const contact = leadConnectorOpenUrl({
    dashboardUrl: 'https://my.adhello.io',
    locationId: 'loc1',
    contactId: 'c1',
  });
  assert.equal(contact, 'https://my.adhello.io/v2/location/loc1/contacts/detail/c1');

  const conv = leadConnectorOpenUrl({
    dashboardUrl: 'https://my.adhello.io',
    locationId: 'loc1',
    contactId: 'c1',
    conversationId: 'cv9',
    preferConversation: true,
  });
  assert.equal(conv, 'https://my.adhello.io/v2/location/loc1/conversations/conversations/cv9');
});

test('normalizeInboundEvent keeps ghl ids', () => {
  const e = normalizeInboundEvent({
    type: 'sms',
    at: '2026-10-01T12:00:00.000Z',
    ghlContactId: 'ghl_c',
    conversationId: 'ghl_cv',
    preview: 'hi',
  });
  assert.equal(e.ghlContactId, 'ghl_c');
  assert.equal(e.conversationId, 'ghl_cv');
});

test('listGhlCallSmsItems lists every missed call and SMS including handled', () => {
  const now = Date.parse('2026-10-13T12:00:00.000Z');
  const leads = [
    {
      key: 'lead:1',
      title: 'Dana',
      phone: '+15551112222',
      ghlContactId: 'gc1',
      inboundHandledAt: '2026-10-12T18:00:00.000Z',
      inboundEvents: [
        { id: 'm1', type: 'missed_call', at: '2026-10-12T10:00:00.000Z', ghlContactId: 'gc1' },
        { id: 's1', type: 'sms', at: '2026-10-12T11:00:00.000Z', preview: 'Yes', conversationId: 'cv1' },
        { id: 'f1', type: 'form', at: '2026-10-12T09:00:00.000Z' },
      ],
    },
    {
      key: 'lead:2',
      title: 'Pat',
      phone: '+15553334444',
      inboundEvents: [{ id: 'm2', type: 'voicemail', at: '2026-10-13T08:00:00.000Z' }],
    },
  ];
  const rows = listGhlCallSmsItems(leads, {
    now,
    locationId: 'locA',
    dashboardUrl: 'https://my.adhello.io',
  });
  assert.equal(rows.length, 3);
  assert.deepEqual(
    rows.map((r) => r.id),
    ['m2', 's1', 'm1'],
  );
  const sms = rows.find((r) => r.id === 's1');
  assert.equal(sms.callOpensLeadConnector, true);
  assert.match(sms.callHref, /conversations\/conversations\/cv1/);
  assert.equal(sms.handled, true);

  const miss = rows.find((r) => r.id === 'm1');
  assert.match(miss.callHref, /contacts\/detail\/gc1/);
  assert.equal(miss.callExternal, true);

  const vm = rows.find((r) => r.id === 'm2');
  assert.equal(vm.callOpensLeadConnector, false);
  assert.equal(vm.callHref, 'tel:+15553334444');
});

test('pendingInboundItems Call uses Lead Connector when contact is linked', () => {
  const now = Date.parse('2026-10-13T12:00:00.000Z');
  const leads = [
    {
      key: 'lead:z',
      title: 'Zed',
      phone: '+15550001111',
      ghlContactId: 'gcZ',
      inboundEvents: [{ id: '1', type: 'missed_call', at: '2026-10-13T11:00:00.000Z' }],
    },
  ];
  const rows = pendingInboundItems(leads, {
    now,
    locationId: 'locZ',
    dashboardUrl: 'https://my.adhello.io',
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].callOpensLeadConnector, true);
  assert.equal(rows[0].callHref, 'https://my.adhello.io/v2/location/locZ/contacts/detail/gcZ');
});
