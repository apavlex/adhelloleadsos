const { describe, it, before, mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'member-cust-ghl-'));
process.env.APP_DATA_DIR = tmpDir;

const dbService = require('../services/database');
const work = require('../services/memberWork');
const ghlClient = require('../services/ghlClient');
const ghlMessaging = require('../services/ghlMessaging');
const workspaceIntegrations = require('../services/workspaceIntegrations');
const memberCustomerGhl = require('../services/memberCustomerGhl');

const NET = { id: 'netghl1', ownerWorkspaceId: 'ws_ghl_cust' };
const MEM = 'memghl1';

describe('member customer GHL sync', () => {
  let activeTag;
  let inactiveTag;

  before(async () => {
    await work.listCustomers(NET.id, MEM);
    activeTag = await dbService.createTag(NET.ownerWorkspaceId, 'VIP Client', '#16a34a');
    inactiveTag = await dbService.createTag(NET.ownerWorkspaceId, 'Old Lead', '#64748b');
    await dbService.setTagActive(NET.ownerWorkspaceId, inactiveTag.key, false);
  });

  it('maps GHL contacts into customer fields', () => {
    const fields = memberCustomerGhl.contactToFields({
      id: 'c1',
      firstName: 'Kim',
      lastName: 'Lee',
      phone: '5035550100',
      email: 'kim@example.com',
      address1: '1 Main',
      city: 'Portland',
      state: 'OR',
    });
    assert.equal(fields.name, 'Kim Lee');
    assert.equal(fields.phone, '5035550100');
    assert.match(fields.address, /Portland/);
  });

  it('maps GHL tag names to active workspace keys only', async () => {
    const keys = await memberCustomerGhl.activeTagKeysFromGhlNames(NET.ownerWorkspaceId, [
      'VIP Client',
      'Old Lead',
      'Unknown Noise',
      'ao:booked',
    ]);
    assert.deepEqual(keys, [activeTag.key]);
  });

  it('presents and offers only active tags', async () => {
    const customer = {
      tags: [activeTag.key, inactiveTag.key, 'tag:missing'],
    };
    const applied = await memberCustomerGhl.presentCustomerTags(NET.ownerWorkspaceId, customer);
    assert.equal(applied.length, 1);
    assert.equal(applied[0].key, activeTag.key);
    assert.equal(applied[0].name, 'VIP Client');

    const available = await memberCustomerGhl.availableCustomerTags(NET.ownerWorkspaceId, {
      tags: [activeTag.key],
    });
    assert.ok(!available.some((t) => t.key === activeTag.key));
    assert.ok(!available.some((t) => t.key === inactiveTag.key));
  });

  it('pulls contacts into the member customer list with active tags', async () => {
    mock.method(workspaceIntegrations, 'getResolvedIntegrationEnv', async () => ({
      GHL_API_KEY: 'test',
      GHL_LOCATION_ID: 'loc1',
    }));
    mock.method(ghlClient, 'isConfigured', () => true);
    mock.method(ghlClient, 'listContacts', async () => ({
      contacts: [
        {
          id: 'ghl_a',
          firstName: 'Ada',
          lastName: 'Lovelace',
          phone: '3605550111',
          email: 'ada@example.com',
          tags: ['VIP Client', 'Old Lead'],
        },
        { id: 'ghl_b', name: 'Bob Homeowner', phone: '3605550222', email: '', tags: [] },
        {
          id: 'ghl_partner',
          name: 'Camas Flooring Pros',
          phone: '3605550333',
          email: 'partner@example.com',
          tags: ['Referral partner'],
        },
        {
          id: 'ghl_gb_partner',
          name: 'GB Network Biz',
          phone: '3605550444',
          tags: ['GB: Referral Network'],
        },
      ],
      nextStartAfterId: null,
    }));

    const out = await memberCustomerGhl.pullCustomersFromGhl(NET, MEM, { maxPages: 1 });
    assert.equal(out.ok, true);
    assert.equal(out.created, 2);
    assert.equal(out.skippedPartners, 2);

    const list = await work.listCustomers(NET.id, MEM);
    assert.equal(list.length, 2);
    const ada = list.find((c) => c.ghlContactId === 'ghl_a');
    assert.ok(ada);
    assert.equal(ada.name, 'Ada Lovelace');
    assert.equal(ada.source, 'ghl');
    assert.deepEqual(ada.tags, [activeTag.key]);
    assert.equal(ada.isReferralPartner, false);
    assert.ok(!list.some((c) => c.ghlContactId === 'ghl_partner'));
    assert.ok(!list.some((c) => c.ghlContactId === 'ghl_gb_partner'));

    mock.restoreAll();
  });

  it('marks already-imported CRM partners so the list can hide them', async () => {
    const prior = await work.saveCustomer(NET.id, MEM, {
      name: 'Old Partner Co',
      phone: '3605550999',
    }, { source: 'ghl', ghlContactId: 'ghl_old_partner', tags: [] });
    assert.equal(prior.ok, true);

    mock.method(workspaceIntegrations, 'getResolvedIntegrationEnv', async () => ({
      GHL_API_KEY: 'test',
      GHL_LOCATION_ID: 'loc1',
    }));
    mock.method(ghlClient, 'isConfigured', () => true);
    mock.method(ghlClient, 'listContacts', async () => ({
      contacts: [
        {
          id: 'ghl_old_partner',
          name: 'Old Partner Co',
          phone: '3605550999',
          tags: ['Referral partner'],
        },
      ],
      nextStartAfterId: null,
    }));

    const out = await memberCustomerGhl.pullCustomersFromGhl(NET, MEM, { maxPages: 1 });
    assert.equal(out.ok, true);
    assert.equal(out.updated, 1);
    const again = await work.getCustomer(NET.id, MEM, prior.customer.id);
    assert.equal(again.isReferralPartner, true);
    assert.equal(memberCustomerGhl.customerLooksLikePartner(again), true);

    mock.restoreAll();
  });

  it('pushes a local customer and stores ghlContactId', async () => {
    mock.method(workspaceIntegrations, 'getResolvedIntegrationEnv', async () => ({
      GHL_API_KEY: 'test',
      GHL_LOCATION_ID: 'loc1',
    }));
    mock.method(ghlClient, 'isConfigured', () => true);
    mock.method(ghlMessaging, 'ensureGhlContactForPerson', async () => ({ contactId: 'ghl_new_99' }));
    mock.method(ghlClient, 'getContact', async () => ({ id: 'ghl_new_99', tags: [] }));
    mock.method(ghlClient, 'addTagsToContact', async () => ({}));
    mock.method(ghlClient, 'removeTagsFromContact', async () => ({}));

    const created = await work.saveCustomer(NET.id, MEM, {
      name: 'Local Pat',
      phone: '5035550333',
      email: 'pat@example.com',
    }, { source: 'manual', tags: [activeTag.key] });
    assert.equal(created.ok, true);
    assert.equal(created.customer.ghlContactId, '');
    assert.deepEqual(created.customer.tags, [activeTag.key]);

    const pushed = await memberCustomerGhl.pushCustomerToGhl(NET, MEM, created.customer);
    assert.equal(pushed.ok, true);
    assert.equal(pushed.contactId, 'ghl_new_99');
    assert.equal(pushed.customer.ghlContactId, 'ghl_new_99');
    assert.deepEqual(pushed.customer.tags, [activeTag.key]);

    mock.restoreAll();
  });

  it('adds and removes tags with 2-way GHL sync', async () => {
    const created = await work.saveCustomer(NET.id, MEM, {
      name: 'Taggy',
      phone: '5035550444',
      email: 'taggy@example.com',
    }, { source: 'manual', ghlContactId: 'ghl_taggy', tags: [] });

    let remote = [];
    const added = [];
    const removed = [];
    mock.method(workspaceIntegrations, 'getResolvedIntegrationEnv', async () => ({
      GHL_API_KEY: 'test',
      GHL_LOCATION_ID: 'loc1',
    }));
    mock.method(ghlClient, 'isConfigured', () => true);
    mock.method(ghlClient, 'getContact', async () => ({ id: 'ghl_taggy', tags: remote.slice() }));
    mock.method(ghlClient, 'addTagsToContact', async (_id, tags) => {
      added.push(...tags);
      remote = [...remote, ...tags];
      return {};
    });
    mock.method(ghlClient, 'removeTagsFromContact', async (_id, tags) => {
      removed.push(...tags);
      const lower = new Set(tags.map((t) => String(t).toLowerCase()));
      remote = remote.filter((t) => !lower.has(String(t).toLowerCase()));
      return {};
    });

    const add = await memberCustomerGhl.setCustomerTag(
      NET,
      MEM,
      created.customer.id,
      activeTag.key,
      { add: true },
    );
    assert.equal(add.ok, true);
    assert.deepEqual(add.customer.tags, [activeTag.key]);
    assert.equal(add.ghl && add.ghl.pending, true);
    // GHL sync is background — wait briefly for the mock to run.
    for (let i = 0; i < 20 && !added.length; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setImmediate(r));
    }
    assert.deepEqual(added, ['VIP Client']);

    // Inactive tags are reactivated when selected again.
    const revived = await memberCustomerGhl.setCustomerTag(
      NET,
      MEM,
      created.customer.id,
      inactiveTag.key,
      { add: true },
    );
    assert.equal(revived.ok, true);
    assert.ok(revived.customer.tags.includes(inactiveTag.key));
    const inactiveRow = (await dbService.listTags(NET.ownerWorkspaceId)).find((t) => t.key === inactiveTag.key);
    assert.equal(inactiveRow.isActive, true);

    const drop = await memberCustomerGhl.setCustomerTag(
      NET,
      MEM,
      created.customer.id,
      activeTag.key,
      { add: false },
    );
    assert.equal(drop.ok, true);
    assert.ok(!drop.customer.tags.includes(activeTag.key));
    for (let i = 0; i < 20 && !removed.includes('VIP Client'); i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setImmediate(r));
    }
    assert.ok(removed.includes('VIP Client'));

    mock.restoreAll();
  });

  it('creates a new workspace tag by name and assigns it', async () => {
    const created = await work.saveCustomer(NET.id, MEM, {
      name: 'Newbie',
      phone: '5035550555',
      email: 'newbie@example.com',
    }, { source: 'manual', ghlContactId: 'ghl_new_tag', tags: [] });

    mock.method(workspaceIntegrations, 'getResolvedIntegrationEnv', async () => ({
      GHL_API_KEY: 'test',
      GHL_LOCATION_ID: 'loc1',
    }));
    mock.method(ghlClient, 'isConfigured', () => true);
    mock.method(ghlClient, 'getContact', async () => ({ id: 'ghl_new_tag', tags: [] }));
    mock.method(ghlClient, 'addTagsToContact', async () => ({}));
    mock.method(ghlClient, 'removeTagsFromContact', async () => ({}));

    const out = await memberCustomerGhl.setCustomerTag(
      NET,
      MEM,
      created.customer.id,
      '',
      { add: true, tagName: '  Preferred Vendor  ' },
    );
    assert.equal(out.ok, true);
    assert.equal(out.tag.name, 'Preferred Vendor');
    assert.ok(out.customer.tags.includes(out.tag.key));
    const catalog = await dbService.listTags(NET.ownerWorkspaceId);
    assert.ok(catalog.some((t) => t.key === out.tag.key && t.isActive !== false));

    mock.restoreAll();
  });

  it('stampWebsiteFormLead marks lead, sets source, and applies Website form tag', async () => {
    const created = await work.saveCustomer(NET.id, MEM, {
      name: 'Web Form Alex',
      phone: '3605550199',
      email: 'alex@tprflooring.com',
    }, { source: 'ghl' });
    assert.equal(created.ok, true);
    assert.equal(created.customer.isLead, false);

    const stamped = await memberCustomerGhl.stampWebsiteFormLead(NET, MEM, created.customer);
    assert.equal(stamped.ok, true);
    assert.equal(stamped.customer.isLead, true);
    assert.equal(stamped.customer.source, 'website_form');
    assert.equal(work.customerSourceLabel(stamped.customer), 'Website form');

    const tag = await memberCustomerGhl.ensureWebsiteFormTag(NET.ownerWorkspaceId);
    assert.equal(tag.name, 'Website form');
    assert.ok(stamped.customer.tags.includes(tag.key));

    const leads = await work.listContactLeads(NET.id, MEM);
    assert.ok(leads.some((c) => c.id === stamped.customer.id));

    // Idempotent
    const again = await memberCustomerGhl.stampWebsiteFormLead(NET, MEM, stamped.customer);
    assert.equal(again.ok, true);
    assert.equal(again.customer.tags.filter((k) => k === tag.key).length, 1);
  });

  it('stampWebsiteFormLead does not re-add a contact removed from Leads', async () => {
    const created = await work.saveCustomer(NET.id, MEM, {
      name: 'Bob Test',
      phone: '9862387463',
      email: 'bob@tprflooring.com',
    }, { source: 'ghl' });
    assert.equal(created.ok, true);

    const stamped = await memberCustomerGhl.stampWebsiteFormLead(NET, MEM, created.customer);
    assert.equal(stamped.customer.isLead, true);

    const removed = await work.setCustomerKind(NET.id, MEM, stamped.customer.id, 'customer', {
      removeFromLeads: true,
    });
    assert.equal(removed.ok, true);
    assert.equal(removed.customer.isLead, false);
    assert.ok(removed.customer.leadRemovedAt);

    const restamp = await memberCustomerGhl.stampWebsiteFormLead(NET, MEM, removed.customer);
    assert.equal(restamp.ok, true);
    assert.equal(restamp.customer.isLead, false, 'website form sync must not undo Remove from Leads');
    assert.ok(restamp.customer.leadRemovedAt);

    const leads = await work.listContactLeads(NET.id, MEM);
    assert.equal(leads.some((c) => c.id === stamped.customer.id), false);

    // Explicit Mark as lead clears the dismiss and allows stamp again.
    const readded = await work.setCustomerKind(NET.id, MEM, stamped.customer.id, 'lead');
    assert.equal(readded.customer.isLead, true);
    assert.equal(readded.customer.leadRemovedAt, '');
  });

  it('ensureFormAnswersOnCustomer backfills GHL custom fields onto the profile', async () => {
    mock.restoreAll();
    mock.method(workspaceIntegrations, 'getResolvedIntegrationEnv', async () => ({
      GHL_API_KEY: 'test',
      GHL_LOCATION_ID: 'loc1',
    }));
    mock.method(ghlClient, 'isConfigured', () => true);
    mock.method(ghlClient, 'listLocationContactCustomFields', async () => ([
      { id: 'cf_msg', name: 'How can we help?' },
      { id: 'cf_addr', name: 'PROJECT ADDRESS / ZIP' },
    ]));
    mock.method(ghlClient, 'listFormSubmissions', async () => ({
      submissions: [{
        contactId: 'ghl_alex_form',
        name: 'Alex',
        phone: '3605550101',
        others: {
          cf_msg: 'Need hardwood in living room',
          cf_addr: 'Camas, WA 98607',
        },
      }],
    }));
    mock.method(ghlClient, 'getContact', async () => ({
      id: 'ghl_alex_form',
      name: 'Alex',
      phone: '3605550101',
      source: 'Website',
      customFields: [
        { id: 'cf_msg', value: 'Need hardwood in living room' },
        { id: 'cf_addr', value: 'Camas, WA 98607' },
      ],
    }));

    const created = await work.saveCustomer(NET.id, MEM, {
      name: 'Alex',
      phone: '3605550101',
    }, { source: 'website_form', ghlContactId: 'ghl_alex_form' });
    assert.equal(created.ok, true);
    assert.equal((created.customer.formAnswers || []).length, 0);
    assert.equal(created.customer.address || '', '');

    const enriched = await memberCustomerGhl.ensureFormAnswersOnCustomer(
      NET,
      MEM,
      created.customer,
    );
    assert.ok(enriched.formAnswers.some((a) => /hardwood/i.test(a.a)));
    assert.ok(enriched.formAnswers.some((a) => /help/i.test(a.q)));
    assert.match(String(enriched.address || ''), /Camas.*98607/i);

    const again = await memberCustomerGhl.ensureFormAnswersOnCustomer(NET, MEM, enriched);
    assert.equal(again.formAnswers.length, enriched.formAnswers.length);
    mock.restoreAll();
  });

  it('ensureFormAnswersOnCustomer does not invent form Q&A for non-form contacts', async () => {
    mock.restoreAll();
    mock.method(workspaceIntegrations, 'getResolvedIntegrationEnv', async () => ({
      GHL_API_KEY: 'test',
      GHL_LOCATION_ID: 'loc1',
    }));
    mock.method(ghlClient, 'isConfigured', () => true);
    mock.method(ghlClient, 'listLocationContactCustomFields', async () => []);
    mock.method(ghlClient, 'listFormSubmissions', async () => ({ submissions: [] }));
    mock.method(ghlClient, 'getContact', async () => ({
      id: 'ghl_manual_jr',
      companyName: 'jr',
      type: 'lead',
      address1: 'WA',
      country: 'US',
    }));

    const created = await work.saveCustomer(NET.id, MEM, {
      name: 'jr',
      phone: '+13605589058',
    }, {
      source: 'manual',
      ghlContactId: 'ghl_manual_jr',
      formAnswers: [
        { q: 'Company', a: 'jr' },
        { q: 'Type', a: 'lead' },
        { q: 'Address', a: 'WA, US' },
      ],
    });
    assert.equal(created.ok, true);
    assert.ok((created.customer.formAnswers || []).length > 0);

    const cleared = await memberCustomerGhl.ensureFormAnswersOnCustomer(
      NET,
      MEM,
      created.customer,
    );
    assert.equal((cleared.formAnswers || []).length, 0);
    assert.equal(cleared.source, 'manual');
    mock.restoreAll();
  });

  it('ensureFormAnswersOnCustomer keeps real form Q&A even when source is not website_form', async () => {
    mock.restoreAll();
    const created = await work.saveCustomer(NET.id, MEM, {
      name: 'Casey',
      phone: '3605550199',
    }, {
      source: 'ghl',
      ghlContactId: 'ghl_casey_form',
      formAnswers: [
        { q: 'Company', a: 'Casey Co' },
        { q: 'How can we help?', a: 'Need hardwood in living room' },
      ],
    });
    assert.equal(created.ok, true);

    const kept = await memberCustomerGhl.ensureFormAnswersOnCustomer(
      NET,
      MEM,
      created.customer,
    );
    assert.ok(kept.formAnswers.some((a) => /hardwood/i.test(a.a)));
    assert.equal(kept.source, 'ghl');
    mock.restoreAll();
  });

  it('ensureFormAnswersOnCustomer recovers GHL form submission when replacing CRM crumbs', async () => {
    mock.restoreAll();
    mock.method(workspaceIntegrations, 'getResolvedIntegrationEnv', async () => ({
      GHL_API_KEY: 'test',
      GHL_LOCATION_ID: 'loc1',
    }));
    mock.method(ghlClient, 'isConfigured', () => true);
    mock.method(ghlClient, 'listLocationContactCustomFields', async () => ([
      { id: 'cf_msg', name: 'How can we help?' },
    ]));
    mock.method(ghlClient, 'listFormSubmissions', async () => ({
      submissions: [{
        contactId: 'ghl_recover_form',
        name: 'Riley',
        others: { cf_msg: 'Quote for stairs' },
      }],
    }));
    mock.method(ghlClient, 'getContact', async () => ({
      id: 'ghl_recover_form',
      name: 'Riley',
      companyName: 'Riley LLC',
      type: 'lead',
    }));

    const created = await work.saveCustomer(NET.id, MEM, {
      name: 'Riley',
      phone: '3605550188',
    }, {
      source: 'manual',
      ghlContactId: 'ghl_recover_form',
      formAnswers: [
        { q: 'Company', a: 'Riley LLC' },
        { q: 'Type', a: 'lead' },
      ],
    });

    const recovered = await memberCustomerGhl.ensureFormAnswersOnCustomer(
      NET,
      MEM,
      created.customer,
    );
    assert.ok(recovered.formAnswers.some((a) => /stairs/i.test(a.a)));
    assert.equal(recovered.formAnswers.some((a) => a.q === 'Company'), false);
    mock.restoreAll();
  });
});
