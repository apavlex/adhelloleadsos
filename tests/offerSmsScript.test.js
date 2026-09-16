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
const {
  MAX_SMS_SUGGESTION_LEN,
  stripEmailFurniture,
  stripSuggestionWrapper,
  clampSmsText,
  normalizeSmsSuggestion,
  condenseCallScriptToSms,
  mergeTagsIn,
} = require('../services/smsScriptSuggest');

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

describe('smsScriptSuggest', () => {
  const CALL_SCRIPT =
    'Hi {{name}}, I noticed {{company}} in {{city}} — great reputation in the area. ' +
    'Quick question: are you actively booking in-home estimates each week, or is most work still coming from referrals?\n\n' +
    'What types of jobs do you prefer — residential remodel, new construction, or commercial?';

  it('condenses a call script into a short SMS that keeps its merge tags', () => {
    const sms = condenseCallScriptToSms(CALL_SCRIPT);
    assert.ok(sms.length > 0);
    assert.ok(sms.length <= MAX_SMS_SUGGESTION_LEN);
    assert.ok(!sms.includes('\n'));
    assert.deepEqual(mergeTagsIn(sms), ['{{name}}', '{{company}}', '{{city}}']);
  });

  it('condenses rich-editor HTML without leaking tags', () => {
    const sms = condenseCallScriptToSms('<p>Hi <strong>{{name}}</strong>, quick question.</p><br>More detail here.');
    assert.equal(sms.includes('<'), false);
    assert.ok(sms.startsWith('Hi {{name}}, quick question.'));
  });

  it('strips subject lines and signature blocks', () => {
    const out = stripEmailFurniture(
      'Subject: Following up\nHi {{name}}, quick question about {{company}}.\n\nBest,\n[your name]\nAdHello',
    );
    assert.equal(out, 'Hi {{name}}, quick question about {{company}}.');
  });

  it('strips model wrappers like quotes and SMS labels', () => {
    assert.equal(stripSuggestionWrapper('SMS: "Hi {{name}}, got a minute?"'), 'Hi {{name}}, got a minute?');
    assert.equal(stripSuggestionWrapper('  Hi {{name}}  '), 'Hi {{name}}');
  });

  it('clamps long copy at a word boundary and never leaves a half-written merge tag', () => {
    const long = `${'word '.repeat(80)}{{company}} tail`;
    const clamped = clampSmsText(long);
    assert.ok(clamped.length <= MAX_SMS_SUGGESTION_LEN);
    assert.equal(/\{\{[^}]*$/.test(clamped), false);
    assert.equal(/\s$/.test(clamped), false);

    const tagAtBoundary = clampSmsText(`${'a'.repeat(315)} {{company}}`, 320);
    assert.equal(tagAtBoundary.includes('{{'), false);
  });

  it('normalizeSmsSuggestion enforces one clamped paragraph with no email furniture', () => {
    const messy = `Subject: quick idea\n"Hi {{name}} — ${'x'.repeat(400)}"\n\nThanks,\nAlex`;
    const out = normalizeSmsSuggestion(messy);
    assert.ok(out.startsWith('Hi {{name}}'));
    assert.ok(out.length <= MAX_SMS_SUGGESTION_LEN);
    assert.equal(out.includes('Thanks,'), false);
    assert.equal(out.includes('Subject:'), false);
    assert.equal(out.includes('\n'), false);
  });

  it('returns empty for a blank call script so callers can refuse to overwrite', () => {
    assert.equal(condenseCallScriptToSms(''), '');
    assert.equal(condenseCallScriptToSms('<p><br></p>'), '');
    assert.equal(condenseCallScriptToSms('Subject: nothing but furniture\nBest,\nAlex'), '');
  });
});
