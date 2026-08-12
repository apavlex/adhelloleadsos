const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  inferScriptPresetKey,
  buildWorkspaceScriptSeed,
  seedWorkspaceScriptsOnCreate,
  workspaceHasScriptCatalog,
  applyScriptPresetToWorkspace,
  applySalesIntakeToFirstOffer,
  resolveScriptPresetKeyForCreate,
} = require('../services/workspaceScriptBootstrap');
const { buildWorkspaceOfferLibrary } = require('../services/workspaceSalesScripts');
const { SCRIPT_LIBRARY } = require('../services/salesConstants');

describe('workspaceScriptBootstrap', () => {
  it('infers retail_install for flooring workspace names', () => {
    assert.equal(inferScriptPresetKey({ name: 'Flooring', slug: 'flooring' }), 'retail_install');
  });

  it('infers agency for Adhello Agency workspace', () => {
    assert.equal(
      inferScriptPresetKey({ name: 'Adhello Agency', slug: 'adhello-agency' }),
      'agency',
    );
  });

  it('seeds flooring-specific offers for retail_install preset', () => {
    const ws = { name: 'Premier Flooring', pipelineIntake: { presetKey: 'retail_install' } };
    const seeded = seedWorkspaceScriptsOnCreate({ ...ws });
    assert.ok(workspaceHasScriptCatalog(seeded));
    assert.ok(seeded.salesScriptsSeededAt);
    assert.equal(seeded.salesScriptsPresetKey, 'retail_install');

    const { keys, library } = buildWorkspaceOfferLibrary(seeded, SCRIPT_LIBRARY);
    assert.ok(keys.includes('flooring_install'));
    assert.ok(!keys.includes('reputation'));
    assert.match(library.flooring_install.opening, /flooring|estimate/i);
    assert.equal(seeded.salesScriptOfferCatalog[0].senderBusinessName, 'Premier Flooring');
  });

  it('seeds agency offers from SCRIPT_LIBRARY for agency preset', () => {
    const seed = buildWorkspaceScriptSeed({ name: 'Adhello Agency' }, 'agency');
    assert.ok(seed.salesScriptOfferCatalog.some((row) => row.key === 'reputation'));
    assert.ok(seed.salesScriptBlockOverrides.reputation.opening);
  });

  it('does not overwrite an existing workspace catalog', () => {
    const ws = {
      salesScriptOfferCatalog: [{ key: 'custom', label: 'Custom Offer' }],
      salesScriptBlockOverrides: { custom: { opening: 'Hi' } },
    };
    const seeded = seedWorkspaceScriptsOnCreate({ ...ws });
    assert.deepEqual(seeded.salesScriptOfferCatalog, ws.salesScriptOfferCatalog);
  });

  it('applyScriptPresetToWorkspace replaces catalog with flooring offers', () => {
    const doc = { name: 'Flooring', salesScriptOfferCatalog: [{ key: 'old', label: 'Old' }] };
    const applied = applyScriptPresetToWorkspace(doc, 'retail_install');
    assert.equal(applied.ok, true);
    assert.equal(doc.salesScriptsPresetKey, 'retail_install');
    assert.ok(doc.salesScriptOfferCatalog.some((row) => row.key === 'flooring_install'));
    assert.match(doc.salesScriptBlockOverrides.flooring_install.opening, /estimate|flooring/i);
  });

  it('applySalesIntakeToFirstOffer patches profile and opening script', () => {
    const doc = seedWorkspaceScriptsOnCreate({ name: 'TPR Flooring' }, { presetKey: 'retail_install' });
    applySalesIntakeToFirstOffer(doc, {
      businessName: 'TPR Flooring',
      vertical: 'Flooring',
      offerName: 'Showroom estimate',
      auditLink: 'https://example.com/book',
      openingScript: 'Hi {{name}}, custom flooring script.',
    });
    assert.equal(doc.salesScriptOfferCatalog[0].senderBusinessName, 'TPR Flooring');
    assert.equal(doc.salesScriptOfferCatalog[0].vertical, 'Flooring');
    assert.equal(doc.salesScriptOfferCatalog[0].label, 'Showroom estimate');
    assert.equal(doc.salesScriptBlockOverrides[doc.salesScriptOfferCatalog[0].key].opening, 'Hi {{name}}, custom flooring script.');
  });

  it('resolveScriptPresetKeyForCreate prefers pipeline preset when setupPath is preset', () => {
    const key = resolveScriptPresetKeyForCreate(
      { setupPath: 'preset', presetKey: 'retail_install' },
      { name: 'Generic Co' },
    );
    assert.equal(key, 'retail_install');
  });

  it('resolveScriptPresetKeyForCreate infers from salesIntake vertical', () => {
    const key = resolveScriptPresetKeyForCreate(
      { setupPath: 'ai', salesIntake: { vertical: 'Flooring' } },
      { name: 'My Business', pipelineIntake: {} },
    );
    assert.equal(key, 'retail_install');
  });
});
