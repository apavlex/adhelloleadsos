const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  PRESET_IDS,
  resolveWorkspacePipelineColumnDefaults,
  normalizePipelineColumnPreset,
  defaultPresetForRoiProfile,
  visibilityForPreset,
} = require('../services/pipelineColumnPresets');
const { buildEffectivePipelineTablePrefs } = require('../services/pipelineTablePrefs');

describe('pipelineColumnPresets', () => {
  it('infers carriers layout from trucking workspace names', () => {
    const d = resolveWorkspacePipelineColumnDefaults({
      name: 'Truckers Ins.',
      prospecting: {},
    });
    assert.equal(d.presetId, PRESET_IDS.CARRIERS);
    assert.equal(d.vis.reviewSnippet, false);
    assert.equal(d.vis.sponsored, false);
    assert.equal(d.vis.category, true);
    assert.equal(d.vis.phone, true);
  });

  it('keeps agency Maps columns for agency_gap workspaces', () => {
    const d = resolveWorkspacePipelineColumnDefaults({
      name: 'AdHello Agency',
      prospecting: { roiProfile: 'agency_gap' },
    });
    assert.equal(d.presetId, PRESET_IDS.LOCAL_AGENCY);
    assert.equal(d.vis.reviewSnippet, true);
    assert.equal(d.vis.sponsored, true);
  });

  it('honors an explicit saved pipelineColumnPreset', () => {
    const d = resolveWorkspacePipelineColumnDefaults({
      name: 'Truckers Ins.',
      prospecting: { pipelineColumnPreset: 'local_agency' },
    });
    assert.equal(d.presetId, PRESET_IDS.LOCAL_AGENCY);
  });

  it('maps license_renewal goal to contractors columns', () => {
    assert.equal(defaultPresetForRoiProfile('license_renewal'), PRESET_IDS.CONTRACTORS);
    assert.equal(normalizePipelineColumnPreset('fmcsa'), PRESET_IDS.CARRIERS);
  });

  it('contractors preset shows city + CCB / license column', () => {
    const vis = visibilityForPreset(PRESET_IDS.CONTRACTORS);
    assert.equal(vis.ccbLicense, true);
    assert.equal(vis.city, true);
    assert.equal(vis.state, true);
  });

  it('buildEffectivePipelineTablePrefs merges user overrides onto workspace defaults', () => {
    const ws = { name: 'Truckers Ins.', prospecting: {} };
    const effective = buildEffectivePipelineTablePrefs(ws, {
      vis: { socials: true },
      widths: {},
      density: 'comfortable',
      updatedAt: 100,
    });
    assert.equal(effective.vis.reviewSnippet, false);
    assert.equal(effective.vis.socials, true);
    assert.equal(effective.fromWorkspaceDefault, false);
  });

  it('visibilityForPreset hides GBP columns for carriers', () => {
    const vis = visibilityForPreset('carriers');
    assert.equal(vis.claimStatus, false);
    assert.equal(vis.optimizationScore, false);
    assert.equal(vis.company, true);
  });
});
