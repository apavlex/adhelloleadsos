const { describe, it, before, after, mock } = require('node:test');
const assert = require('node:assert/strict');

process.env.WORKSPACE_INTEGRATIONS_SECRET =
  process.env.WORKSPACE_INTEGRATIONS_SECRET || 'test-owner-share-secret-32';

const dbService = require('../services/database');
const { encryptIntegrations } = require('../services/workspaceIntegrationSecrets');

describe('owner sibling integration sharing', () => {
  let getWorkspaceMock;
  let listIdsMock;
  let agencySlugMock;
  let saveWorkspaceMock;
  let workspaceIntegrations;

  before(() => {
    const homeelk = {
      id: 'ws-homeelk',
      ownerUserId: 'alex@adhello.io',
      integrationsCipher: encryptIntegrations({}),
    };
    const adhello = {
      id: 'ws-adhello',
      ownerUserId: 'alex@adhello.ai',
      integrationsCipher: encryptIntegrations({
        bettercontactApiKey: 'bc-from-adhello',
        outscraperApiKey: 'os-from-adhello',
        ghlApiKey: 'ghl-must-not-share',
      }),
    };
    const otherOwner = {
      id: 'ws-other',
      ownerUserId: 'someone@example.com',
      integrationsCipher: encryptIntegrations({
        bettercontactApiKey: 'bc-should-not-leak',
      }),
    };
    const byId = {
      'ws-homeelk': homeelk,
      'ws-adhello': adhello,
      'ws-other': otherOwner,
    };

    getWorkspaceMock = mock.method(dbService, 'getWorkspace', async (id) => byId[id] || null);
    listIdsMock = mock.method(dbService, 'listWorkspaceIds', async () => Object.keys(byId));
    agencySlugMock = mock.method(dbService, 'getWorkspaceIdForSlug', async () => null);
    saveWorkspaceMock = mock.method(dbService, 'saveWorkspace', async () => {});

    // Load after mocks so cache-clearing save is safe if anything touches it
    // eslint-disable-next-line global-require
    workspaceIntegrations = require('../services/workspaceIntegrations');
    // Bust any prior cache from other tests
    return workspaceIntegrations.saveWorkspaceIntegrations('ws-adhello', {
      bettercontactApiKey: 'bc-from-adhello',
      outscraperApiKey: 'os-from-adhello',
      ghlApiKey: 'ghl-must-not-share',
    }).then(() => {
      adhello.integrationsCipher = encryptIntegrations({
        bettercontactApiKey: 'bc-from-adhello',
        outscraperApiKey: 'os-from-adhello',
        ghlApiKey: 'ghl-must-not-share',
      });
    });
  });

  after(() => {
    getWorkspaceMock.mock.restore();
    listIdsMock.mock.restore();
    agencySlugMock.mock.restore();
    saveWorkspaceMock.mock.restore();
  });

  it('HomeElk borrows BetterContact from owner’s AdHello workspace', async () => {
    const env = await workspaceIntegrations.getResolvedIntegrationEnv('ws-homeelk');
    assert.equal(env.BETTERCONTACT_API_KEY, 'bc-from-adhello');
    assert.equal(env.OUTSCRAPER_API_KEY, 'os-from-adhello');
  });

  it('does not share GHL / CRM keys across workspaces', async () => {
    const env = await workspaceIntegrations.getResolvedIntegrationEnv('ws-homeelk');
    assert.notEqual(env.GHL_API_KEY, 'ghl-must-not-share');
  });

  it('lists borrowed enrichers on Integrations', async () => {
    const shared = await workspaceIntegrations.sharedProvidersFor('ws-homeelk');
    assert.ok(shared.includes('BetterContact'));
    assert.ok(shared.includes('Outscraper'));
  });
});
