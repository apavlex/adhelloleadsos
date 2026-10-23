const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-appt-fw-'));
process.env.APP_DATA_DIR = tmpDir;

const dbService = require('../services/database');
const networkStore = require('../services/networkStore');
const appointmentPool = require('../services/appointmentPool');
const { TOOL_NAMES, executeCrmTool, getOpenAiFunctionTools } = require('../services/mcp/mcpToolExecutor');
const { getOpenAiToolManifest } = require('../services/mcp/mcpServerFactory');
const { APPOINTMENT_TOOL_NAMES } = require('../services/mcp/mcpAppointments');
const { FIELD_WORK_TOOL_NAMES } = require('../services/mcp/mcpFieldWork');

const WID = 'ws_mcp_appt_fw';
const OWNER = 'owner@mcp-appt.test';
const VIEWER = 'viewer@mcp-appt.test';
const owner = { workspaceId: WID, userEmail: OWNER, baseUrl: 'https://leads.example.com' };
const viewer = { workspaceId: WID, userEmail: VIEWER, baseUrl: 'https://leads.example.com' };

describe('Appointments + field work MCP tools', () => {
  before(async () => {
    await dbService.saveWorkspace(WID, {
      id: WID,
      name: 'Appt FW Co',
      members: {
        [OWNER]: { role: 'owner' },
        [VIEWER]: { role: 'viewer' },
      },
    });
    await networkStore.getOrCreateNetworkForWorkspace(WID, {
      name: 'Appt FW Network',
      ownerEmail: OWNER,
    });
  });

  after(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {
      /* ignore */
    }
  });

  it('registers appointment and field-work tools everywhere', () => {
    const fnNames = getOpenAiFunctionTools().map((t) => t.function.name);
    const manifestNames = getOpenAiToolManifest().tools.map((t) => t.name);
    for (const name of [...APPOINTMENT_TOOL_NAMES, ...FIELD_WORK_TOOL_NAMES]) {
      assert.ok(TOOL_NAMES.includes(name), `TOOL_NAMES missing ${name}`);
      assert.ok(fnNames.includes(name), `inline missing ${name}`);
      assert.ok(manifestNames.includes(name), `manifest missing ${name}`);
    }
    assert.equal(new Set(TOOL_NAMES).size, TOOL_NAMES.length);
    assert.equal(getOpenAiToolManifest().version, '1.8.0');
  });

  it('lists packages, creates one, delivers a lead, and buys marketplace slots', async () => {
    const empty = await executeCrmTool(owner, 'list_appointment_packages', {});
    assert.equal(empty.success, true);
    assert.equal(empty.count, 0);

    const denied = await executeCrmTool(viewer, 'create_appointment_package', {
      business_name: 'Nope Floors',
      trade: 'Flooring',
      purchased: 2,
    });
    assert.equal(denied.success, false);
    assert.match(denied.error, /owners and admins/i);

    const created = await executeCrmTool(owner, 'create_appointment_package', {
      business_name: 'Camas Floors',
      trade: 'Flooring',
      purchased: 3,
      booking_url: 'https://book.example.com/camas',
    });
    assert.equal(created.success, true);
    assert.equal(created.package.business_name, 'Camas Floors');
    assert.equal(created.package.purchased, 3);

    const listed = await executeCrmTool(owner, 'list_appointment_packages', {});
    assert.equal(listed.count, 1);

    const delivered = await executeCrmTool(owner, 'deliver_appointment_lead', {
      package_id: created.package.id,
      name: 'Pat Homeowner',
      phone: '3605550100',
      note: 'Kitchen vinyl plank',
      city: 'Camas',
    });
    assert.equal(delivered.success, true);
    assert.equal(delivered.is_new, true);

    const listing = appointmentPool.createListing(
      {
        trade: 'HVAC',
        title: 'Vancouver HVAC pack',
        slotsTotal: 5,
        pricePerSlot: 40,
      },
      { by: OWNER },
    );
    const market = await executeCrmTool(owner, 'list_appointment_marketplace', { trade: 'HVAC' });
    assert.equal(market.success, true);
    assert.ok(market.listings.some((l) => l.id === listing.id));

    const bought = await executeCrmTool(owner, 'buy_appointment_slots', {
      listing_id: listing.id,
      quantity: 2,
    });
    assert.equal(bought.success, true);
    assert.equal(bought.purchase.quantity, 2);
    assert.ok(bought.package.id);
  });

  it('returns field-work overview and empty job list for a fresh network', async () => {
    const overview = await executeCrmTool(owner, 'get_field_work_overview', {});
    assert.equal(overview.success, true);
    assert.equal(overview.totals.open, 0);
    assert.match(overview.field_work_page, /\/network\?/);

    const jobs = await executeCrmTool(owner, 'list_field_work_jobs', { view: 'open' });
    assert.equal(jobs.success, true);
    assert.equal(jobs.count, 0);

    const blocked = await executeCrmTool(viewer, 'get_field_work_overview', {});
    assert.equal(blocked.success, false);
    assert.match(blocked.error, /managers/i);
  });
});
