/**
 * Reviews customer profile: GHL call + SMS activity for synced contacts.
 */
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

process.env.APP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'member-ghl-activity-'));

const root = path.join(__dirname, '..');
const dbService = require('../services/database');
const activity = require('../services/memberCustomerGhlActivity');

const WID = 'ws_member_ghl_activity';

describe('memberCustomerGhlActivity', () => {
  beforeEach(async () => {
    await dbService.saveWorkspace(WID, {
      id: WID,
      name: 'GHL Activity Test',
      ownerUserId: 'owner@example.com',
      members: [{ email: 'owner@example.com', role: 'admin' }],
    });
  });

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
      { ownerWorkspaceId: WID },
      { id: 'c1', name: 'Pat' },
    );
    assert.equal(out.available, true);
    assert.equal(out.linked, false);
    assert.equal(out.items.length, 0);
  });

  it('surfaces locally stored inbound SMS when live GHL conversations are empty', async () => {
    await dbService.saveLead({
      key: 'lead:hatten',
      workspaceId: WID,
      title: 'C Hattenhauer',
      phone: '+15551234567',
      ghlContactId: 'ghl_hatten',
      inboundEvents: [
        {
          id: 's1',
          type: 'sms',
          at: '2026-10-21T20:00:00.000Z',
          preview: 'MSI Stella La Perla',
        },
      ],
    });

    const local = await activity.localInboundItems(
      { ownerWorkspaceId: WID },
      { id: 'c1', name: 'C Hattenhauer', phone: '+15551234567', ghlContactId: 'ghl_hatten' },
      { locationId: 'loc1', contactId: 'ghl_hatten', openHref: 'https://app.gohighlevel.com/v2/location/loc1/contacts/detail/ghl_hatten' },
    );
    assert.equal(local.length, 1);
    assert.equal(local[0].kind, 'sms');
    assert.match(local[0].body, /MSI Stella La Perla/);
    assert.doesNotMatch(local[0].openHref || '', /\/focus|\/pipeline/i);

    const merged = activity.mergeActivityItems([], local);
    assert.equal(merged.length, 1);
    assert.match(merged[0].body, /MSI Stella La Perla/);
  });

  it('customer profile and routes expose Calls & texts for synced GHL contacts', () => {
    const view = fs.readFileSync(path.join(root, 'views/member_app/customer.ejs'), 'utf8');
    const css = fs.readFileSync(path.join(root, 'public/css/member-app.css'), 'utf8');
    const route = fs.readFileSync(path.join(root, 'routes/memberApp.js'), 'utf8');
    const js = fs.readFileSync(path.join(root, 'public/js/member-app.js'), 'utf8');
    const svc = fs.readFileSync(path.join(root, 'services/memberCustomerGhlActivity.js'), 'utf8');

    assert.match(view, /Calls &amp; texts/);
    assert.match(view, /maCustomerGhlActivity/);
    assert.match(view, /ma-ghl-feed/);
    assert.match(view, /ghlContactId/);
    assert.match(view, /Open in GHL/);
    assert.match(view, /data-ma-ghl-activity-url/);
    assert.match(view, /data-ma-ghl-feed-more/);
    assert.match(view, /_ghlPreview\s*=\s*2/);
    assert.match(css, /\.ma-ghl-feed/);
    assert.match(css, /\.ma-ghl-feed__more/);
    assert.match(route, /memberCustomerGhlActivity/);
    assert.match(route, /ensureCustomerGhlLink/);
    // Profile paints first; history loads via JSON so the tap is not blocked on GHL.
    assert.match(route, /loadGhlActivity:\s*false/);
    assert.match(route, /customers\/c\/:id\/ghl-activity\.json/);
    assert.match(js, /bootGhlActivity|data-ma-ghl-activity-url/);
    assert.match(js, /GHL_FEED_PREVIEW\s*=\s*2/);
    assert.match(js, /data-ma-ghl-feed-more/);
    assert.match(svc, /localInboundItems/);
    assert.match(svc, /ensureCustomerGhlLink/);
  });
});

