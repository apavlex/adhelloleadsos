const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { SCRIPT_LIBRARY } = require('../services/salesConstants');
const {
  buildWorkspaceOfferLibrary,
  sanitizeBlockOverridesForCatalog,
} = require('../services/workspaceSalesScripts');
const { buildOutreachLibrary, scriptForChannel } = require('../services/outreachChannelScripts');
const { composeOfferScriptText, MAX_SMS_LEN } = require('../services/salesScriptsStorage');
const { SCRIPT_PRESETS } = require('../config/workspaceScriptPresets');

describe('per-offer SMS script', () => {
  it('sanitizeBlockOverridesForCatalog keeps sms and clamps it to SMS length', () => {
    const patch = sanitizeBlockOverridesForCatalog(
      { flooring: { opening: 'Call body', sms: 'x'.repeat(MAX_SMS_LEN + 50), bogus: 'nope' } },
      ['flooring'],
    );
    assert.equal(patch.flooring.opening, 'Call body');
    assert.equal(patch.flooring.sms.length, MAX_SMS_LEN);
    assert.ok(!Object.prototype.hasOwnProperty.call(patch.flooring, 'bogus'));
  });

  it('workspace overrides expose sms and keep it out of the composed call script', () => {
    const ws = {
      salesScriptOfferCatalog: [{ key: 'flooring', label: 'Flooring Installation' }],
      salesScriptBlockOverrides: {
        flooring: { opening: 'Hi {{name}}, call script.', sms: 'Hi {{name}} — quick text.' },
      },
    };
    const { library } = buildWorkspaceOfferLibrary(ws, SCRIPT_LIBRARY);
    assert.equal(library.flooring.sms, 'Hi {{name}} — quick text.');
    assert.equal(composeOfferScriptText(library.flooring), 'Hi {{name}}, call script.');
  });

  it('text channel prefers the per-offer sms script and falls back to opening', () => {
    const lib = {
      flooring: { label: 'Flooring', opening: 'OPEN', valueProp: 'VALUE', sms: 'TEXT' },
    };
    const outreach = buildOutreachLibrary(lib, ['flooring']);
    assert.equal(outreach.flooring.channels.text, 'TEXT');
    assert.equal(outreach.flooring.channels.call, 'OPEN');
    assert.equal(outreach.flooring.channels.email, 'VALUE');
    assert.equal(scriptForChannel({ opening: 'OPEN', valueProp: 'VALUE' }, 'text'), 'OPEN');
  });

  it('every script preset seeds an sms body short enough to send', () => {
    Object.keys(SCRIPT_PRESETS).forEach((presetKey) => {
      const preset = SCRIPT_PRESETS[presetKey];
      preset.catalog.forEach((entry) => {
        const block = preset.blockOverrides[entry.key];
        assert.ok(block, `${presetKey}/${entry.key} missing block`);
        const sms = String(block.sms || '').trim();
        assert.ok(sms, `${presetKey}/${entry.key} missing sms seed`);
        assert.ok(sms.length <= 320, `${presetKey}/${entry.key} sms too long (${sms.length})`);
      });
    });
  });
});
