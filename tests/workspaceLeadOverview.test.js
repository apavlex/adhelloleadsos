/**
 * Workspace Today lead-source overview.
 */
const { describe, it, mock, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const workspaceLeadOverview = require('../services/workspaceLeadOverview');

describe('workspaceLeadOverview', () => {
  beforeEach(() => {
    mock.restoreAll();
  });

  it('aggregates website, agency, referrals, and purchased', async () => {
    const appointmentPackages = require('../services/appointmentPackages');
    const networkStore = require('../services/networkStore');
    mock.method(appointmentPackages, 'loadTodayView', async () => ({
      packages: [
        {
          formLeads: [
            { id: '1', source: 'website', status: 'open' },
            { id: '2', source: 'agency', status: 'open' },
            { id: '3', source: 'website', status: 'closed' },
          ],
        },
      ],
      totals: { remaining: 12, leadCreditsLeft: 4 },
    }));
    mock.method(networkStore, 'getOrCreateNetworkForWorkspace', async () => ({ id: 'net1' }));
    mock.method(networkStore, 'listReferrals', async () => [
      { id: 'r1', status: 'sent' },
      { id: 'r2', status: 'unrouted' },
      { id: 'r3', status: 'accepted' },
    ]);

    const overview = await workspaceLeadOverview.buildOverview({
      workspaceId: 'ws1',
      leads: [
        {
          key: 'lead:a',
          title: 'Form Co',
          inboundEvents: [{ id: 'e1', type: 'form', at: new Date().toISOString() }],
        },
      ],
    });

    assert.equal(overview.websiteCount, 2); // 1 package + 1 inbound
    assert.equal(overview.agencyCount, 1);
    assert.equal(overview.referralCount, 2);
    assert.equal(overview.purchasedLeft, 12);
    assert.equal(overview.needYou, 2 + 1 + 2);
    assert.equal(overview.sources.length, 4);
    assert.equal(overview.sources[0].href, '/appointments');
    assert.equal(overview.sources[2].href, '/network');
  });

  it('wires Today dashboard (not member Home)', () => {
    const root = path.join(__dirname, '..');
    const today = fs.readFileSync(path.join(root, 'views/today.ejs'), 'utf8');
    const route = fs.readFileSync(path.join(root, 'routes/today.js'), 'utf8');
    const home = fs.readFileSync(path.join(root, 'views/member_app/home.ejs'), 'utf8');
    const memberRoute = fs.readFileSync(path.join(root, 'routes/memberApp.js'), 'utf8');

    assert.match(route, /workspaceLeadOverview/);
    assert.match(route, /leadSources/);
    assert.match(today, /Lead sources/);
    assert.match(today, /_srcList\.forEach/);
    assert.match(today, /need you/);
    assert.doesNotMatch(home, /ma-sources/);
    assert.doesNotMatch(memberRoute, /memberHomeOverview/);
    assert.ok(!fs.existsSync(path.join(root, 'services/memberHomeOverview.js')));
  });
});
