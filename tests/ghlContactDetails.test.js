const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghl-contact-details-'));
process.env.APP_DATA_DIR = tmpDataDir;

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const ghlClient = require('../services/ghlClient');
const {
  buildGhlContactDetails,
  planContactDetailsPush,
  pushLeadContactDetails,
  ALL_EMAILS_FIELD,
  CONTACTS_FIELD,
} = require('../services/ghlContactDetails');

const ENV = { GHL_API_KEY: 'test-key', GHL_LOCATION_ID: 'loc-test' };

const genesis = () => ({
  title: 'Genesis Homes NW LLC',
  email: 'admin@genesishomesnw.com',
  phone: '(360) 818-9429',
  decisionMakerName: 'Kip Walker',
  decisionMakerTitle: 'Owner',
  contacts: [
    { role: 'Email', name: '', email: 'Warranty@GenesisHomesNW.com', phone: '', primary: false },
    { role: 'Office Manager', name: 'Dana Lee', email: 'dana@genesishomesnw.com', phone: '360-555-0100', primary: false },
    { role: 'Email', name: '', email: 'ADMIN@genesishomesnw.com', primary: false },
    { role: 'Email', name: '', email: 'banner@2x.jpg', primary: false },
  ],
  aiWebsiteAnalysis: { emails: ['sales@genesishomesnw.com'] },
});

/** Minimal in-memory LeadConnector: records every request, never touches the network. */
function mockGhl() {
  const state = { calls: [], contacts: {}, fields: [], nextId: 1, reject: null };
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const fetchMock = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : undefined;
    state.calls.push({ method, path: u.pathname, query: Object.fromEntries(u.searchParams), body });
    const p = u.pathname;
    if (state.reject) {
      const r = state.reject(method, p, body);
      if (r) return json(r.status, r.body);
    }
    if (p === '/contacts/' && method === 'GET') {
      const q = String(u.searchParams.get('query') || '').toLowerCase();
      const hits = Object.values(state.contacts).filter((c) => q && (c.email === q || String(c.phone || '').includes(q)));
      return json(200, { contacts: hits });
    }
    if (p === '/contacts/' && method === 'POST') {
      const id = `ghl-${state.nextId++}`;
      state.contacts[id] = { id, tags: [], customFields: [], ...body };
      return json(201, { contact: state.contacts[id] });
    }
    const m = p.match(/^\/contacts\/([^/]+)(\/tags)?$/);
    if (m && state.contacts[m[1]]) {
      const c = state.contacts[m[1]];
      if (m[2] && method === 'POST') c.tags = [...new Set([...c.tags, ...body.tags])];
      else if (m[2] && method === 'DELETE') c.tags = c.tags.filter((t) => !body.tags.includes(t));
      else if (method === 'PUT') {
        const { customFields, ...rest } = body;
        Object.assign(c, rest);
        (customFields || []).forEach((f) => {
          c.customFields = c.customFields.filter((x) => x.id !== f.id).concat({ id: f.id, value: f.value });
        });
      }
      return json(200, { contact: c });
    }
    if (/\/locations\/[^/]+\/customFields$/.test(p)) {
      if (method === 'POST') {
        const field = { id: `cf-${state.fields.length + 1}`, name: body.name, dataType: body.dataType };
        state.fields.push(field);
        return json(201, { customField: field });
      }
      return json(200, { customFields: state.fields });
    }
    return json(200, {});
  };
  return { state, fetchMock };
}

describe('lead → GHL email / phone collection', () => {
  it('collects every valid email once, main first, lowercased', () => {
    assert.deepEqual(ghlClient.collectLeadEmailsForGhl(genesis()), [
      'admin@genesishomesnw.com',
      'dana@genesishomesnw.com',
      'warranty@genesishomesnw.com',
      'sales@genesishomesnw.com',
    ]);
  });

  it('collects the main phone then contact phones in E.164', () => {
    assert.deepEqual(ghlClient.collectLeadPhonesForGhl(genesis()), ['+13608189429', '+13605550100']);
  });

  it('contact payload falls back to the first contact email / phone when the main ones are missing', () => {
    const payload = ghlClient.leadToGhlContactPayload(
      { title: 'Acme', email: 'N/A', phone: 'N/A', contacts: [{ name: 'Dana', email: 'dana@acmeroofing.com', phone: '5035550123' }] },
      'loc',
    );
    assert.equal(payload.email, 'dana@acmeroofing.com');
    assert.equal(payload.phone, '+15035550123');
    assert.equal(payload.companyName, 'Acme');
  });
});

describe('buildGhlContactDetails / planContactDetailsPush', () => {
  it('splits primary vs additional and lists people for the Contacts field', () => {
    const d = buildGhlContactDetails(genesis());
    assert.equal(d.primaryEmail, 'admin@genesishomesnw.com');
    assert.deepEqual(d.additionalEmails, ['dana@genesishomesnw.com', 'warranty@genesishomesnw.com', 'sales@genesishomesnw.com']);
    assert.deepEqual(d.additionalPhones, ['+13605550100']);
    assert.equal(d.allEmailsText.split('\n').length, 4);
    assert.deepEqual(d.contactsText.split('\n'), [
      'Kip Walker — Owner',
      'Dana Lee — Office Manager · dana@genesishomesnw.com · +13605550100',
    ]);
  });

  it('caps additional emails at GHL’s 10 but keeps every email in the All Emails text', () => {
    const lead = { title: 'Big Co', email: 'main@bigco.com', contacts: [] };
    for (let i = 0; i < 14; i += 1) lead.contacts.push({ role: 'Email', name: '', email: `e${i}@bigco.com` });
    const d = buildGhlContactDetails(lead);
    assert.equal(d.additionalEmails.length, 10);
    assert.equal(d.allEmailsText.split('\n').length, 15);
  });

  it('plans nothing when GHL already matches (idempotent re-sync)', () => {
    const d = buildGhlContactDetails(genesis());
    const remote = {
      email: 'admin@genesishomesnw.com',
      phone: '+13608189429',
      additionalEmails: d.additionalEmails.slice().reverse().map((email) => ({ email: email.toUpperCase() })),
      additionalPhones: [{ phone: '+1 (360) 555-0100' }],
      customFields: [
        { id: 'f-all', value: d.allEmailsText },
        { id: 'f-people', value: d.contactsText },
      ],
    };
    const plan = planContactDetailsPush(d, remote, { allEmails: 'f-all', contacts: 'f-people' });
    assert.equal(plan.channels, null);
    assert.deepEqual(plan.customFields, []);
  });

  it('keeps extra emails someone added by hand in GHL', () => {
    const d = buildGhlContactDetails(genesis());
    const plan = planContactDetailsPush(d, { email: d.primaryEmail, additionalEmails: [{ email: 'billing@genesishomesnw.com' }] }, {});
    assert.deepEqual(plan.channels.additionalEmails, [...d.additionalEmails, 'billing@genesishomesnw.com']);
    assert.deepEqual(plan.channels.additionalPhones, ['+13605550100']);
  });
});

describe('pushLeadContactDetails (mocked GHL)', () => {
  let realFetch;
  let ghl;
  before(() => {
    realFetch = global.fetch;
  });
  after(() => {
    global.fetch = realFetch;
  });
  beforeEach(() => {
    ghl = mockGhl();
    global.fetch = ghl.fetchMock;
  });

  it('writes additionalEmails/Phones + custom fields once, then makes no writes on re-sync', async () => {
    ghl.state.contacts['c-1'] = { id: 'c-1', email: 'admin@genesishomesnw.com', phone: '+13608189429', tags: [], customFields: [] };
    const first = await pushLeadContactDetails('c-1', genesis(), ENV);
    assert.equal(first.ok, true);
    assert.equal(first.channels.status, 'updated');
    assert.equal(first.customFieldsWritten, 2);

    const puts = ghl.state.calls.filter((c) => c.method === 'PUT');
    const channelPut = puts.find((c) => c.body.additionalEmails);
    assert.deepEqual(channelPut.body.additionalEmails, [
      { email: 'dana@genesishomesnw.com' },
      { email: 'warranty@genesishomesnw.com' },
      { email: 'sales@genesishomesnw.com' },
    ]);
    assert.deepEqual(channelPut.body.additionalPhones, [{ phone: '+13605550100' }]);
    const fieldPut = puts.find((c) => c.body.customFields);
    assert.equal(fieldPut.body.customFields.length, 2);
    assert.deepEqual(
      ghl.state.fields.map((f) => [f.name, f.dataType]),
      [
        [ALL_EMAILS_FIELD.name, 'LARGE_TEXT'],
        [CONTACTS_FIELD.name, 'LARGE_TEXT'],
      ],
    );

    ghl.state.calls.length = 0;
    const again = await pushLeadContactDetails('c-1', genesis(), ENV);
    assert.equal(again.channels.status, 'unchanged');
    assert.equal(again.customFieldsWritten, 0);
    assert.deepEqual(ghl.state.calls.map((c) => c.method), ['GET']);
  });

  it('falls back per field when GHL rejects additionalEmails, and stops retrying it', async () => {
    ghl.state.contacts['c-2'] = { id: 'c-2', email: 'admin@genesishomesnw.com', tags: [], customFields: [] };
    ghl.state.reject = (method, p, body) =>
      method === 'PUT' && body && body.additionalEmails
        ? { status: 422, body: { message: ['property additionalEmails should not exist'], statusCode: 422 } }
        : null;
    const res = await pushLeadContactDetails('c-2', genesis(), ENV);
    assert.equal(res.channels.status, 'partial');
    assert.deepEqual(res.channels.fields, ['additionalPhones']);
    assert.equal(res.channels.errors.additionalEmails, 'unsupported');
    // All Emails custom field still carries every address.
    const allEmails = ghl.state.contacts['c-2'].customFields.map((f) => f.value).join('\n');
    assert.match(allEmails, /warranty@genesishomesnw\.com/);

    ghl.state.calls.length = 0;
    ghl.state.contacts['c-2'].additionalPhones = [];
    await pushLeadContactDetails('c-2', genesis(), ENV);
    assert.equal(ghl.state.calls.some((c) => c.body && c.body.additionalEmails), false);
  });

  it('skips extra requests for a lead with one email and no people', async () => {
    const res = await pushLeadContactDetails('c-3', { title: 'Solo', email: 'solo@soloplumbing.com', phone: '5035550000' }, ENV);
    assert.equal(res.skipped, true);
    assert.equal(ghl.state.calls.length, 0);
  });
});

describe('ghlSync.pushLeadToGhl end to end (mocked GHL)', () => {
  let realFetch;
  before(() => {
    realFetch = global.fetch;
  });
  after(() => {
    global.fetch = realFetch;
    fs.rmSync(tmpDataDir, { recursive: true, force: true });
  });

  it('sends catalog tag names (not keys), all emails, and re-syncs without duplicates', async () => {
    const ghl = mockGhl();
    global.fetch = ghl.fetchMock;
    const dbService = require('../services/database');
    const ghlSync = require('../services/ghlSync');
    const E2E_ENV = { GHL_API_KEY: 'test-key', GHL_LOCATION_ID: 'loc-e2e' };
    const wid = `ws-ghl-details-${Date.now()}`;
    const tag = await dbService.createTag(wid, 'Hot Builder');
    const key = await dbService.saveLead({ ...genesis(), workspaceId: wid, status: 'Not Contacted', pipelineStage: 1, tags: [tag.key] });

    // Messaging path: no prepareLeadForGhlPush → names must still be resolved from the catalog.
    const first = await ghlSync.pushLeadToGhl(await dbService.getLead(key), E2E_ENV, { listSyncFast: true });
    const creates = ghl.state.calls.filter((c) => c.method === 'POST' && c.path === '/contacts/');
    assert.equal(creates.length, 1);
    assert.equal(creates[0].body.email, 'admin@genesishomesnw.com');
    assert.equal(creates[0].body.companyName, 'Genesis Homes NW LLC');
    const contact = ghl.state.contacts[first.ghlContactId];
    assert.ok(contact.tags.includes('Hot Builder'), `tags: ${contact.tags.join(', ')}`);
    assert.equal(contact.tags.some((t) => t.startsWith('tag:')), false);
    assert.equal(contact.additionalEmails.length, 3);
    assert.equal(first.contactDetails.channels.status, 'updated');

    const saved = await dbService.getLead(key);
    assert.equal(saved.ghlContactId, first.ghlContactId);
    assert.ok(saved.tags.includes(tag.key));
    assert.equal(saved.tags.includes('Hot Builder'), false);

    ghl.state.calls.length = 0;
    const second = await ghlSync.pushLeadToGhl(saved, E2E_ENV, { listSyncFast: true });
    assert.equal(second.ghlContactId, first.ghlContactId);
    assert.equal(ghl.state.calls.filter((c) => c.method === 'POST' && c.path === '/contacts/').length, 0);
    assert.equal(ghl.state.calls.some((c) => c.body && (c.body.additionalEmails || c.body.additionalPhones)), false);
    assert.equal(second.contactDetails.customFieldsWritten, 0);
    assert.equal(Object.keys(ghl.state.contacts).length, 1);
  });
});
