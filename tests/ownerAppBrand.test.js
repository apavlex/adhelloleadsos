const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');
const fs = require('fs');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adhello-owner-app-brand-'));
process.env.APP_DATA_DIR = tmpDir;
process.env.SESSION_SECRET = 'test-owner-app-brand-secret';

const dbService = require('../services/database');
const networkBrand = require('../services/networkBrand');
const ownerAppBrand = require('../services/ownerAppBrand');

describe('ownerAppBrand', () => {
  before(async () => {
    await dbService.saveWorkspace('ws_floor_brand', {
      id: 'ws_floor_brand',
      name: 'Flooring Co',
      slug: 'flooring',
      accentColor: '#2F5B98',
      accentTextColor: '#FFFFFF',
      whiteLabel: { appName: 'TPR Flooring', logoVersion: '123' },
      members: { 'alex@example.com': { role: 'owner' } },
    });
  });

  after(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('overlays workspace white-label for the owner member', async () => {
    const network = {
      id: 'net1',
      name: 'Flooring network',
      ownerWorkspaceId: 'ws_floor_brand',
      ownerEmail: 'alex@example.com',
      brand: { accent: '#f26b1d', appName: '' },
    };
    const member = { id: 'owner', email: 'alex@example.com', companyName: 'Flooring Co' };
    const base = networkBrand.brandView(network, member);
    assert.equal(base.appName, 'Flooring network');

    const brand = await ownerAppBrand.applyWorkspaceBrand(base, network, member);
    assert.equal(brand.appName, 'TPR Flooring');
    assert.equal(brand.heroName, 'TPR Flooring');
    assert.equal(brand.accent.toLowerCase(), '#2f5b98');
    assert.equal(brand.onAccent.toLowerCase(), '#ffffff');
    assert.match(brand.logoUrl, /\/brand\/ws\/ws_floor_brand\/logo\.png/);
    assert.equal(brand.fromWorkspace, true);
  });

  it('leaves partner members on network branding', async () => {
    const network = {
      id: 'net1',
      name: 'Flooring network',
      ownerWorkspaceId: 'ws_floor_brand',
      brand: { accent: '#f26b1d', appName: 'Partner App' },
    };
    const partner = { id: 'm_partner', email: 'partner@example.com', companyName: 'RK Homes' };
    const base = networkBrand.brandView(network, partner);
    const brand = await ownerAppBrand.applyWorkspaceBrand(base, network, partner);
    assert.equal(brand.appName, 'Partner App');
    assert.equal(brand.accent.toLowerCase(), '#f26b1d');
    assert.notEqual(brand.fromWorkspace, true);
  });

  it('skips free-app members', async () => {
    const network = {
      id: 'net1',
      name: 'Agency network',
      ownerWorkspaceId: 'ws_floor_brand',
    };
    const free = { id: 'owner', plan: 'app_free', companyName: 'Sunrise' };
    const base = networkBrand.brandView(network, free);
    const brand = await ownerAppBrand.applyWorkspaceBrand(base, network, free);
    assert.equal(brand.appName, 'AdHello Reviews App');
    assert.notEqual(brand.fromWorkspace, true);
  });
});
