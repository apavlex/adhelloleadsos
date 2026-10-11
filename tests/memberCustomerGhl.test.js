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
      ],
      nextStartAfterId: null,
    }));

    const out = await memberCustomerGhl.pullCustomersFromGhl(NET, MEM, { maxPages: 1 });
    assert.equal(out.ok, true);
    assert.equal(out.created, 2);

    const list = await work.listCustomers(NET.id, MEM);
    assert.equal(list.length, 2);
    const ada = list.find((c) => c.ghlContactId === 'ghl_a');
    assert.ok(ada);
    assert.equal(ada.name, 'Ada Lovelace');
    assert.equal(ada.source, 'ghl');
    assert.deepEqual(ada.tags, [activeTag.key]);

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
});
