const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'appt-pool-'));
process.env.APP_DATA_DIR = tmpDir;

const dbService = require('../services/database');
const appointmentPool = require('../services/appointmentPool');
const appointmentPackages = require('../services/appointmentPackages');

describe('appointmentPool marketplace', () => {
  before(async () => {
    await dbService.saveWorkspace('ws_buyer', { id: 'ws_buyer', name: 'Buyer Co', members: {} });
    await dbService.saveWorkspace('ws_buyer2', { id: 'ws_buyer2', name: 'Buyer Two', members: {} });
  });

  after(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('lists inventory with commission and hides archived / sold-out from available', () => {
    const listing = appointmentPool.createListing({
      trade: 'Plumber',
      title: 'Portland plumbing leads',
      commissionNote: '20% of closed job',
      pricePerSlot: 150,
      slotsTotal: 3,
      leadName: 'Sam Homeowner',
    }, { by: 'admin@adhello.com' });

    assert.ok(listing.id);
    assert.equal(listing.status, 'available');
    assert.equal(listing.slotsLeft, 3);
    assert.equal(listing.commissionNote, '20% of closed job');
    assert.ok(appointmentPool.listAvailable().some((l) => l.id === listing.id));

    const archived = appointmentPool.archiveListing(listing.id);
    assert.equal(archived.status, 'archived');
    assert.ok(!appointmentPool.listAvailable().some((l) => l.id === listing.id));
    assert.ok(appointmentPool.listAll().some((l) => l.id === listing.id));
  });

  it('buy creates a package on the buyer workspace and decrements pool slots', async () => {
    const listing = appointmentPool.createListing({
      trade: 'Electrician',
      title: 'Bright lead package',
      commissionNote: '15% commission',
      slotsTotal: 5,
      leadKey: 'lead_bright_1',
      leadName: 'Jordan Owner',
    }, { by: 'manager@adhello.com' });

    const first = await appointmentPool.buyListing(listing.id, 'ws_buyer', {
      quantity: 2,
      by: 'buyer@bright.com',
    });
    assert.equal(first.ok, true);
    assert.equal(first.listing.slotsLeft, 3);
    assert.equal(first.purchase.quantity, 2);
    assert.equal(first.purchase.buyerWorkspaceId, 'ws_buyer');
    assert.ok(first.package && first.package.id);

    const buyerView = await appointmentPackages.loadTodayView('ws_buyer');
    assert.ok(buyerView.packages.some((p) => p.id === first.package.id));
    const pkg = buyerView.packages.find((p) => p.id === first.package.id);
    assert.equal(pkg.counts.purchased, 2);
    assert.match(String(pkg.notes || ''), /15% commission|Commission/i);

    const over = await appointmentPool.buyListing(listing.id, 'ws_buyer2', {
      quantity: 10,
      by: 'other@co.com',
    });
    assert.equal(over.ok, false);
    assert.match(over.error, /Only 3/);

    const rest = await appointmentPool.buyListing(listing.id, 'ws_buyer2', {
      quantity: 3,
      by: 'other@co.com',
    });
    assert.equal(rest.ok, true);
    assert.equal(rest.listing.slotsLeft, 0);
    assert.equal(rest.listing.status, 'sold_out');
    assert.ok(!appointmentPool.listAvailable().some((l) => l.id === listing.id));

    const summary = appointmentPool.poolSummary();
    assert.ok(summary.purchasesTotal >= 2);
    assert.equal(appointmentPool.purchasesForWorkspace('ws_buyer').length, 1);
  });

  it('rejects buy without workspace', async () => {
    const listing = appointmentPool.createListing({
      trade: 'HVAC',
      title: 'HVAC slots',
      slotsTotal: 1,
    }, { by: 'admin@adhello.com' });
    const bad = await appointmentPool.buyListing(listing.id, '', { quantity: 1 });
    assert.equal(bad.ok, false);
    assert.match(bad.error, /Workspace required/i);
  });
});
