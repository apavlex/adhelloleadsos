const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const rolePermissions = require('../services/rolePermissions');
const { filterLeadsForRequest } = require('../services/workspaceService');

describe('rolePermissions', () => {
  it('opens every page by default and keeps SDRs on assigned leads', () => {
    const m = rolePermissions.resolve({});
    for (const role of ['admin', 'sdr', 'viewer']) {
      assert.ok(rolePermissions.PAGE_IDS.every((id) => m[role].pages[id] === true));
    }
    assert.equal(m.sdr.leads, 'assigned');
    assert.equal(m.admin.leads, 'all');
    assert.equal(m.viewer.leads, 'all');
  });

  it('maps URLs to sidebar pages', () => {
    assert.equal(rolePermissions.pageForPath('/opportunities'), 'opportunities');
    assert.equal(rolePermissions.pageForPath('/prospecting'), 'leads');
    assert.equal(rolePermissions.pageForPath('/leads/find'), 'leads');
    assert.equal(rolePermissions.pageForPath('/workspace/team'), 'settings');
    assert.equal(rolePermissions.pageForPath('/sales/personas/offers'), 'scripts');
    assert.equal(rolePermissions.pageForPath('/todayish'), '');
    assert.ok(rolePermissions.isAlwaysOpen('/workspace/invite/abc'));
  });

  it('applies stored choices but never limits owners', () => {
    const ws = { rolePermissions: { viewer: { pages: { reports: false }, leads: 'assigned' }, sdr: { leads: 'all' } } };
    assert.equal(rolePermissions.canAccessPage(ws, 'viewer', 'reports'), false);
    assert.equal(rolePermissions.canAccessPage(ws, 'viewer', 'tasks'), true);
    assert.equal(rolePermissions.canAccessPage(ws, 'owner', 'reports'), true);
    assert.equal(rolePermissions.leadScope(ws, 'viewer'), 'assigned');
    assert.equal(rolePermissions.leadScope(ws, 'sdr'), 'all');
    assert.equal(rolePermissions.leadScope(ws, 'owner'), 'all');
  });

  it('sends a role without Today to its first open page', () => {
    const ws = { rolePermissions: { sdr: { pages: { today: false } } } };
    assert.equal(rolePermissions.homePath(ws, 'sdr'), '/opportunities');
  });

  it('reads the Team page form', () => {
    const perms = rolePermissions.fromForm({ 'page.sdr.opportunities': 'on', 'leads.sdr': 'assigned', 'leads.admin': 'all' });
    assert.equal(perms.sdr.pages.opportunities, true);
    assert.equal(perms.sdr.pages.reports, false);
    assert.equal(perms.sdr.leads, 'assigned');
    assert.equal(perms.viewer.pages.today, false);
    assert.equal(perms.viewer.leads, 'all');
  });

  it('filters leads by the role setting', () => {
    const leads = [
      { key: 'a', workspaceId: 'w1', assignedTo: 'sam@x.com' },
      { key: 'b', workspaceId: 'w1', assignedTo: '' },
    ];
    const req = (role, perms) => ({
      workspaceId: 'w1',
      workspaceRole: role,
      workspace: { id: 'w1', rolePermissions: perms },
      user: { emails: [{ value: 'sam@x.com' }] },
    });
    assert.deepEqual(filterLeadsForRequest(req('sdr'), leads).map((l) => l.key), ['a']);
    assert.deepEqual(filterLeadsForRequest(req('sdr', { sdr: { leads: 'all' } }), leads).map((l) => l.key), ['a', 'b']);
    assert.deepEqual(filterLeadsForRequest(req('viewer', { viewer: { leads: 'assigned' } }), leads).map((l) => l.key), ['a']);
    assert.deepEqual(filterLeadsForRequest(req('owner', { owner: { leads: 'assigned' } }), leads).map((l) => l.key), ['a', 'b']);
  });
});
