const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  inferScriptPresetKey,
  buildWorkspaceScriptSeed,
  seedWorkspaceScriptsOnCreate,
  workspaceHasScriptCatalog,
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
});
