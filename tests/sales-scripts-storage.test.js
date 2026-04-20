const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { SCRIPT_LIBRARY, SCRIPT_LIBRARY_KEYS } = require('../services/salesConstants');
const {
  mergeScriptLibrary,
  sanitizeBlockOverrides,
  buildMergedScriptLibrary,
  normalizeLibraryItem,
} = require('../services/salesScriptsStorage');

describe('salesScriptsStorage', () => {
  it('merges overrides without dropping tab labels', () => {
    const base = SCRIPT_LIBRARY;
    const merged = mergeScriptLibrary(base, {
      reputation: { opening: 'Hello custom' },
    });
    assert.equal(merged.reputation.opening, 'Hello custom');
    assert.equal(merged.reputation.tabLabel, base.reputation.tabLabel);
    assert.equal(merged.aiWebsites.opening, base.aiWebsites.opening);
  });

  it('sanitizeBlockOverrides strips unknown keys', () => {
    const o = sanitizeBlockOverrides(
      { reputation: { opening: 'x' }, evil: { opening: 'n' } },
      SCRIPT_LIBRARY_KEYS
    );
    assert.ok(o.reputation);
    assert.equal(o.reputation.opening, 'x');
    assert.ok(!o.evil);
  });

  it('buildMergedScriptLibrary reads workspace overrides', () => {
    const ws = { salesScriptBlockOverrides: { reputation: { close: 'Bye' } } };
    const m = buildMergedScriptLibrary(ws, SCRIPT_LIBRARY);
    assert.equal(m.reputation.close, 'Bye');
  });

  it('normalizeLibraryItem requires text', () => {
    assert.equal(normalizeLibraryItem({ text: '   ' }, SCRIPT_LIBRARY_KEYS), null);
    const one = normalizeLibraryItem({ text: 'Hi', serviceKey: 'reputation', section: 'opening' }, SCRIPT_LIBRARY_KEYS);
    assert.ok(one && one.id);
    assert.equal(one.text, 'Hi');
  });
});
