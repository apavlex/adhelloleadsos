const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'member-appt-link-'));
process.env.APP_DATA_DIR = tmpDir;

const dbService = require('../services/database');
const appointmentPackages = require('../services/appointmentPackages');
const { findPackageForMember, normName } = require('../services/memberAppointmentLink');

describe('memberAppointmentLink', () => {
  before(async () => {
    await dbService.saveWorkspace('ws_link', { id: 'ws_link', members: {} });
  });

  after(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('normalizes company names for fuzzy match', () => {
    assert.equal(normName('Handymen LLC'), 'handymen llc');
    assert.equal(normName('  Floor-Co!! '), 'floor co');
  });

  it('matches member to package by leadKey, email, name, or explicit id', async () => {
    const a = await appointmentPackages.createPackage('ws_link', {
      businessName: 'Spark Electric',
      trade: 'Electrician',
      purchased: 5,
      leadKey: 'lead_spark',
      contactEmail: 'spark@example.com',
      leadsPurchased: 10,
    });
    const b = await appointmentPackages.createPackage('ws_link', {
      businessName: 'Floor Co Showroom',
      trade: 'Flooring',
      purchased: 3,
      contactEmail: 'floor@example.com',
      leadsPurchased: 5,
    });

    const byLead = await findPackageForMember('ws_link', { leadKey: 'lead_spark' });
    assert.equal(byLead.id, a.id);

    const byEmail = await findPackageForMember('ws_link', { email: 'floor@example.com' });
    assert.equal(byEmail.id, b.id);

    const byName = await findPackageForMember('ws_link', { companyName: 'Spark Electric Co' });
    assert.equal(byName.id, a.id);

    const byId = await findPackageForMember('ws_link', { appointmentPackageId: b.id });
    assert.equal(byId.id, b.id);

    const miss = await findPackageForMember('ws_link', { companyName: 'Nobody LLC' });
    assert.equal(miss, null);
  });
});
