/**
 * Reviews customer profile: GHL call + SMS activity for synced contacts.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const activity = require('../services/memberCustomerGhlActivity');

describe('memberCustomerGhlActivity', () => {
  it('normalizes SMS and call messages from GHL', () => {
    const sms = activity.normalizeMessage({
      id: 'm1',
      messageType: 'TYPE_SMS',
      direction: 'inbound',
      body: 'Can you come Tuesday?',
      dateAdded: '2026-10-19T12:00:00.000Z',
      conversationId: 'c1',
    });
    assert.equal(sms.kind, 'sms');
    assert.equal(sms.direction, 'inbound');
    assert.match(sms.title, /Text received/);
    assert.match(sms.body, /Tuesday/);

    const missed = activity.normalizeMessage({
      id: 'm2',
      messageType: 'TYPE_CALL',
      direction: 'inbound',
      body: '',
      status: 'no-answer',
      dateAdded: '2026-10-19T11:00:00.000Z',
    });
    assert.equal(missed.kind, 'call');
    assert.equal(missed.title, 'Missed call');

    const email = activity.normalizeMessage({
      id: 'm3',
      messageType: 'TYPE_EMAIL',
      body: 'hello',
    });
    assert.equal(email, null);
  });

  it('returns unlinked when customer has no ghlContactId', async () => {
    const out = await activity.listForCustomer(
      { ownerWorkspaceId: 'ws_x' },
      { id: 'c1', name: 'Pat' },
    );
    assert.equal(out.available, true);
    assert.equal(out.linked, false);
    assert.equal(out.items.length, 0);
  });

  it('customer profile and routes expose Calls & texts for synced GHL contacts', () => {
    const view = fs.readFileSync(path.join(root, 'views/member_app/customer.ejs'), 'utf8');
    const css = fs.readFileSync(path.join(root, 'public/css/member-app.css'), 'utf8');
    const route = fs.readFileSync(path.join(root, 'routes/memberApp.js'), 'utf8');
    const js = fs.readFileSync(path.join(root, 'public/js/member-app.js'), 'utf8');

    assert.match(view, /Calls &amp; texts/);
    assert.match(view, /maCustomerGhlActivity/);
    assert.match(view, /ma-ghl-feed/);
    assert.match(view, /ghlContactId/);
    assert.match(view, /Open in GHL/);
    assert.match(view, /data-ma-ghl-activity-url/);
    assert.match(css, /\.ma-ghl-feed/);
    assert.match(route, /memberCustomerGhlActivity/);
    // Profile paints first; history loads via JSON so the tap is not blocked on GHL.
    assert.match(route, /loadGhlActivity:\s*false/);
    assert.match(route, /customers\/c\/:id\/ghl-activity\.json/);
    assert.match(js, /bootGhlActivity|data-ma-ghl-activity-url/);
  });
});

