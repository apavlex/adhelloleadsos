const { describe, it, before, mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'member-cust-ghl-'));
process.env.APP_DATA_DIR = tmpDir;

const work = require('../services/memberWork');
const ghlClient = require('../services/ghlClient');
const ghlMessaging = require('../services/ghlMessaging');
const workspaceIntegrations = require('../services/workspaceIntegrations');
const memberCustomerGhl = require('../services/memberCustomerGhl');

const NET = { id: 'netghl1', ownerWorkspaceId: 'ws_ghl_cust' };
const MEM = 'memghl1';

describe('member customer GHL sync', () => {
  before(async () => {
    await work.listCustomers(NET.id, MEM);
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

  it('pulls contacts into the member customer list', async () => {
    mock.method(workspaceIntegrations, 'getResolvedIntegrationEnv', async () => ({
      GHL_API_KEY: 'test',
      GHL_LOCATION_ID: 'loc1',
    }));
    mock.method(ghlClient, 'isConfigured', () => true);
    mock.method(ghlClient, 'listContacts', async () => ({
      contacts: [
        { id: 'ghl_a', firstName: 'Ada', lastName: 'Lovelace', phone: '3605550111', email: 'ada@example.com' },
        { id: 'ghl_b', name: 'Bob Homeowner', phone: '3605550222', email: '' },
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

    mock.restoreAll();
  });

  it('pushes a local customer and stores ghlContactId', async () => {
    mock.method(workspaceIntegrations, 'getResolvedIntegrationEnv', async () => ({
      GHL_API_KEY: 'test',
      GHL_LOCATION_ID: 'loc1',
    }));
    mock.method(ghlClient, 'isConfigured', () => true);
    mock.method(ghlMessaging, 'ensureGhlContactForPerson', async () => ({ contactId: 'ghl_new_99' }));

    const created = await work.saveCustomer(NET.id, MEM, {
      name: 'Local Pat',
      phone: '5035550333',
      email: 'pat@example.com',
    }, { source: 'manual' });
    assert.equal(created.ok, true);
    assert.equal(created.customer.ghlContactId, '');

    const pushed = await memberCustomerGhl.pushCustomerToGhl(NET, MEM, created.customer);
    assert.equal(pushed.ok, true);
    assert.equal(pushed.contactId, 'ghl_new_99');
    assert.equal(pushed.customer.ghlContactId, 'ghl_new_99');

    mock.restoreAll();
  });
});
