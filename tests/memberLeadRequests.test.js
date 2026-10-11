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
    assert.equal(await memberLeadRequests.planAllowsLeadRequests({ ownerWorkspaceId: 'ws1' }, {}), false);
  });

  it('allows requests when the agency workspace plan is active', async () => {
    const trials = require('../services/trials');
    const dbService = require('../services/database');
    mock.method(dbService, 'getWorkspace', async () => ({ id: 'ws1', trial: { activatedAt: '2026-01-01T00:00:00.000Z' } }));
    mock.method(trials, 'isRestricted', () => false);
    assert.equal(await memberLeadRequests.planAllowsLeadRequests({ ownerWorkspaceId: 'ws1' }, {}), true);
  });

  it('denies lead requests for public free-app members', async () => {
    const trials = require('../services/trials');
    const dbService = require('../services/database');
    mock.method(dbService, 'getWorkspace', async () => ({ id: 'ws1', trial: { activatedAt: '2026-01-01T00:00:00.000Z' } }));
    mock.method(trials, 'isRestricted', () => false);
    assert.equal(
      await memberLeadRequests.planAllowsLeadRequests({ ownerWorkspaceId: 'ws1' }, { plan: 'app_free' }),
      false,
    );
    assert.equal(
      await memberLeadRequests.planAllowsLeadDetails({ ownerWorkspaceId: 'ws1' }, { plan: 'app_free' }),
      false,
    );
  });

  it('teases form leads and referrals with project name only when locked', () => {
    const lockedLead = memberLeadRequests.presentFormLead({
      id: 'fl1',
      name: 'Kitchen remodel',
      phone: '5035550199',
      email: 'a@b.com',
      preview: 'Needs quote ASAP',
      formName: 'Contact',
      source: 'ghl',
      status: 'open',
      at: '2026-10-11T00:00:00.000Z',
    }, { detailsAllowed: false });
    assert.equal(lockedLead.name, 'Kitchen remodel');
    assert.equal(lockedLead.phone, '');
    assert.equal(lockedLead.email, '');
    assert.equal(lockedLead.preview, '');
    assert.equal(lockedLead.detailsLocked, true);

    const openLead = memberLeadRequests.presentFormLead({
      id: 'fl1', name: 'Kitchen remodel', phone: '5035550199',
    }, { detailsAllowed: true });
    assert.equal(openLead.phone, '5035550199');
    assert.equal(openLead.detailsLocked, false);

    const lockedRef = memberLeadRequests.presentReferralTeaser({
      id: 'r1',
      trade: 'Plumbing',
      customer: { name: 'Sam Hose', phone: '555', email: 'x@y.z', note: 'leak' },
      actions: ['claim'],
      notes: [{ text: 'secret' }],
      statusLabel: 'Open · Claim',
    }, { detailsAllowed: false });
    assert.equal(lockedRef.customer.name, 'Sam Hose');
    assert.equal(lockedRef.customer.phone, undefined);
    assert.deepEqual(lockedRef.actions, []);
    assert.deepEqual(lockedRef.notes, []);
    assert.equal(lockedRef.detailsLocked, true);
  });

  it('cooldowns after a recent leadRequestAt', () => {
    const recent = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    assert.equal(memberLeadRequests.onCooldown({ leadRequestAt: recent }), true);
    assert.equal(memberLeadRequests.onCooldown({ leadRequestAt: '' }), false);
  });

  it('wires home + Leads & Referrals callout and POST /leads/request', () => {
    const home = fs.readFileSync(path.join(__dirname, '../views/member_app/home.ejs'), 'utf8');
    const referrals = fs.readFileSync(path.join(__dirname, '../views/member_app/referrals.ejs'), 'utf8');
    const callout = fs.readFileSync(path.join(__dirname, '../views/member_app/_lead_request_callout.ejs'), 'utf8');
    const route = fs.readFileSync(path.join(__dirname, '../routes/memberApp.js'), 'utf8');
    const css = fs.readFileSync(path.join(__dirname, '../public/css/member-app.css'), 'utf8');
    const notify = fs.readFileSync(path.join(__dirname, '../services/networkNotify.js'), 'utf8');
    const portal = fs.readFileSync(path.join(__dirname, '../services/contractorPortal.js'), 'utf8');

    assert.match(home, /_lead_request_callout/);
    assert.match(home, /href="<%= base %>\/referrals"/);
    assert.doesNotMatch(home, /Claim pool/);
    assert.doesNotMatch(home, /referrals\?view=pool/);
    assert.match(referrals, /_lead_request_callout/);
    assert.match(referrals, /Website &amp; agency/);
    assert.match(callout, /Need more leads/);
    assert.match(callout, /Request leads/);
    assert.match(callout, /monthly workspace/);
    assert.match(callout, /href="\/signup"/);
    assert.match(route, /leads\/request/);
    assert.match(route, /memberLeadRequests\.requestMoreLeads/);
    assert.match(route, /redirect\(303,\s*`\$\{ctx\.base\}\/referrals/);
    assert.match(css, /\.ma-leadask/);
    assert.match(notify, /notifyLeadRequest/);
    assert.match(notify, /ready for more work/);
    assert.match(portal, /ready for more work/);
  });
});
