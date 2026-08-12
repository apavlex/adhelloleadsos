const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { SCRIPT_LIBRARY } = require('../services/salesConstants');
const {
  buildWorkspaceOfferLibrary,
  sanitizeOfferCatalogInput,
  resolveArmsReachScripts,
  sanitizeArmsReachPatch,
  resolveCarsReachSpecialties,
  resolveUpworkServices,
  mergeReachScripts,
} = require('../services/workspaceSalesScripts');

describe('workspaceSalesScripts', () => {
  it('buildWorkspaceOfferLibrary returns empty catalog when workspace has none', () => {
    const { library, keys, catalog } = buildWorkspaceOfferLibrary({}, SCRIPT_LIBRARY);
    assert.deepEqual(keys, []);
    assert.equal(catalog.length, 0);
    assert.equal(Object.keys(library).length, 0);
  });

  it('buildWorkspaceOfferLibrary respects custom offer catalog', () => {
    const ws = {
      salesScriptOfferCatalog: [
        { key: 'flooring', label: 'Flooring Installation', tabLabel: 'Flooring' },
      ],
      salesScriptBlockOverrides: {
        flooring: { opening: 'Hi {{name}}, we install hardwood floors.' },
      },
    };
    const { library, keys, catalog } = buildWorkspaceOfferLibrary(ws, SCRIPT_LIBRARY);
    assert.deepEqual(keys, ['flooring']);
    assert.equal(catalog[0].label, 'Flooring Installation');
    assert.equal(library.flooring.opening, 'Hi {{name}}, we install hardwood floors.');
    assert.ok(!library.reputation);
  });

  it('sanitizeOfferCatalogInput dedupes keys and slugs labels', () => {
    const out = sanitizeOfferCatalogInput([
      { label: 'Hardwood Floors' },
      { label: 'Hardwood Floors' },
    ]);
    assert.equal(out.length, 2);
    assert.equal(out[0].key, 'hardwood_floors');
    assert.equal(out[1].key, 'hardwood_floors_2');
  });

  it('resolveArmsReachScripts prefers workspace facebook posts', () => {
    const defaults = { facebookPosts: ['Default post'], referralSeed: 'Seed {{ownerName}}' };
    const ws = { reachScripts: { armsReach: { facebookPosts: ['Custom post'] } } };
    const arms = resolveArmsReachScripts(ws, defaults);
    assert.deepEqual(arms.facebookPosts, ['Custom post']);
  });

  it('sanitizeArmsReachPatch trims and caps facebook posts', () => {
    const patch = sanitizeArmsReachPatch({
      facebookPosts: ['  One  ', '', 'Two'],
      referralMessage: 'Hello',
    });
    assert.deepEqual(patch.facebookPosts, ['  One  ', 'Two']);
    assert.equal(patch.referralMessage, 'Hello');
  });

  it('resolveCarsReachSpecialties uses workspace list when set', () => {
    const ws = {
      reachScripts: {
        carsReach: {
          specialties: [{ key: 'flooring', label: 'Flooring Sales' }],
        },
      },
    };
    const specs = resolveCarsReachSpecialties(ws, {
      specialties: [{ key: 'seo', label: 'SEO' }],
    });
    assert.deepEqual(specs, [{ key: 'flooring', label: 'Flooring Sales' }]);
  });

  it('resolveUpworkServices uses workspace list when set', () => {
    const ws = {
      reachScripts: {
        computersReach: {
          services: [{ key: 'refinish', label: 'Floor Refinishing' }],
        },
      },
    };
    const services = resolveUpworkServices(ws, [{ key: 'seo', label: 'SEO' }]);
    assert.deepEqual(services, [{ key: 'refinish', label: 'Floor Refinishing' }]);
  });

  it('mergeReachScripts deep-merges carsReach saved fields', () => {
    const ws = {
      reachScripts: {
        carsReach: { saved: { elevator: 'Old', followup: 'Keep' } },
      },
    };
    const next = mergeReachScripts(ws, 'carsReach', { saved: { elevator: 'New' } });
    assert.equal(next.carsReach.saved.elevator, 'New');
    assert.equal(next.carsReach.saved.followup, 'Keep');
  });
});
