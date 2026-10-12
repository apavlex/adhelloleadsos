/**
 * Manager role: owners/admins hire/promote/demote; managers assign leads + referrals.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rolePermissions = require('../services/rolePermissions');
const workspaceService = require('../services/workspaceService');

const root = path.join(__dirname, '..');

describe('manager role', () => {
  it('is an editable Team role with assign-work capabilities', () => {
    assert.ok(rolePermissions.EDITABLE_ROLES.includes('manager'));
    assert.equal(rolePermissions.ROLE_LABELS.manager, 'Manager');
    assert.match(rolePermissions.ROLE_HINTS.manager, /Assign leads and referrals/i);

    assert.equal(workspaceService.canManageTeam('manager'), false);
    assert.equal(workspaceService.canManageTeam('admin'), true);
    assert.equal(workspaceService.canManageTeam('owner'), true);

    assert.equal(workspaceService.canAssignWork('manager'), true);
    assert.equal(workspaceService.canAssignWork('admin'), true);
    assert.equal(workspaceService.canAssignWork('owner'), true);
    assert.equal(workspaceService.canAssignWork('sdr'), false);
    assert.equal(workspaceService.canAssignWork('viewer'), false);
  });

  it('defaults managers to all leads and includes them in the round-robin pool', () => {
    const m = rolePermissions.resolve({});
    assert.equal(m.manager.leads, 'all');
    assert.ok(rolePermissions.PAGE_IDS.every((id) => m.manager.pages[id] === true));

    const pool = workspaceService.assignablePool({
      members: {
        'a@x.com': { role: 'admin' },
        'm@x.com': { role: 'manager' },
        's@x.com': { role: 'sdr' },
        'v@x.com': { role: 'viewer' },
      },
    });
    assert.deepEqual(pool.sort(), ['a@x.com', 'm@x.com', 's@x.com']);
  });

  it('wires invite, role change, lead assign, and network manage for managers', () => {
    const team = fs.readFileSync(path.join(root, 'views/workspace/sections/team.ejs'), 'utf8');
    const workspace = fs.readFileSync(path.join(root, 'routes/workspace.js'), 'utf8');
    const leads = fs.readFileSync(path.join(root, 'routes/leads.js'), 'utf8');
    const network = fs.readFileSync(path.join(root, 'routes/network.js'), 'utf8');
    const mw = fs.readFileSync(path.join(root, 'middleware/withWorkspace.js'), 'utf8');

    assert.match(team, /option value="manager"/);
    assert.match(team, /hired or fired/i);
    assert.match(workspace, /EDITABLE_ROLES/);
    assert.match(workspace, /role === 'manager'/);
    assert.match(leads, /canAssignWork/);
    assert.match(network, /role === 'manager'/);
    assert.match(mw, /canAssignWork/);
  });
});
