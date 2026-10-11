/**
 * Member-app freemium lead requests (ping agency when ready for more work).
 */
const { describe, it, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const memberLeadRequests = require('../services/memberLeadRequests');

describe('memberLeadRequests', () => {
  beforeEach(() => {
    mock.restoreAll();
  });

  it('treats unpaid trial workspaces as not plan-active', async () => {
    const trials = require('../services/trials');
    const dbService = require('../services/database');
    mock.method(dbService, 'getWorkspace', async () => ({ id: 'ws1', trial: { endsAt: '2099-01-01T00:00:00.000Z' } }));
    mock.method(trials, 'isRestricted', () => true);
    assert.equal(await memberLeadRequests.planAllowsLeadRequests({ ownerWorkspaceId: 'ws1' }), false);
  });

  it('allows requests when the agency workspace plan is active', async () => {
    const trials = require('../services/trials');
    const dbService = require('../services/database');
    mock.method(dbService, 'getWorkspace', async () => ({ id: 'ws1', trial: { activatedAt: '2026-01-01T00:00:00.000Z' } }));
    mock.method(trials, 'isRestricted', () => false);
    assert.equal(await memberLeadRequests.planAllowsLeadRequests({ ownerWorkspaceId: 'ws1' }), true);
  });

  it('cooldowns after a recent leadRequestAt', () => {
    const recent = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    assert.equal(memberLeadRequests.onCooldown({ leadRequestAt: recent }), true);
    assert.equal(memberLeadRequests.onCooldown({ leadRequestAt: '' }), false);
  });

  it('wires home + leads callout and POST /leads/request', () => {
    const home = fs.readFileSync(path.join(__dirname, '../views/member_app/home.ejs'), 'utf8');
    const leads = fs.readFileSync(path.join(__dirname, '../views/member_app/leads.ejs'), 'utf8');
    const callout = fs.readFileSync(path.join(__dirname, '../views/member_app/_lead_request_callout.ejs'), 'utf8');
    const route = fs.readFileSync(path.join(__dirname, '../routes/memberApp.js'), 'utf8');
    const css = fs.readFileSync(path.join(__dirname, '../public/css/member-app.css'), 'utf8');
    const notify = fs.readFileSync(path.join(__dirname, '../services/networkNotify.js'), 'utf8');
    const portal = fs.readFileSync(path.join(__dirname, '../services/contractorPortal.js'), 'utf8');

    assert.match(home, /_lead_request_callout/);
    assert.match(leads, /_lead_request_callout/);
    assert.match(callout, /Need more leads/);
    assert.match(callout, /Request leads/);
    assert.match(callout, /monthly plan/);
    assert.match(route, /leads\/request/);
    assert.match(route, /memberLeadRequests\.requestMoreLeads/);
    assert.match(css, /\.ma-leadask/);
    assert.match(notify, /notifyLeadRequest/);
    assert.match(notify, /ready for more work/);
    assert.match(portal, /ready for more work/);
  });
});
