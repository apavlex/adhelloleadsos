const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeStages, coerceStageDefinitionsForSave } = require('../lib/pipeline/normalize');
const { PALETTE } = require('../lib/pipeline/presets');

describe('normalizeStages', () => {
  it('truncates to max 12', () => {
    const raw = Array.from({ length: 20 }, (_, i) => ({
      key: `s${i}`,
      name: `Stage ${i}`,
      color: PALETTE.slate,
      isWon: false,
      isLost: false,
    }));
    raw.push({ key: 'won', name: 'Won', color: PALETTE.green, isWon: true, isLost: false });
    const out = normalizeStages(raw);
    assert.ok(out.length <= 12);
  });

  it('pads to at least 3 stages', () => {
    const out = normalizeStages([
      { key: 'a', name: 'Only', color: PALETTE.blue, isWon: false, isLost: false },
      { key: 'won', name: 'Won', color: PALETTE.green, isWon: true, isLost: false },
    ]);
    assert.ok(out.length >= 3);
  });

  it('prepends New when first stage is terminal', () => {
    const out = normalizeStages([
      { key: 'won', name: 'Won', color: PALETTE.green, isWon: true, isLost: false },
    ]);
    assert.equal(out[0].key, 'new');
    assert.equal(out[0].isWon, false);
  });

  it('appends Won when missing', () => {
    const out = normalizeStages([
      { key: 'a', name: 'A', color: PALETTE.slate, isWon: false, isLost: false },
      { key: 'b', name: 'B', color: PALETTE.blue, isWon: false, isLost: false },
    ]);
    assert.ok(out.some((s) => s.isWon));
  });

  it('dedupes keys with suffix', () => {
    const out = normalizeStages([
      { key: 'dup', name: 'One', color: PALETTE.slate, isWon: false, isLost: false },
      { key: 'dup', name: 'Two', color: PALETTE.blue, isWon: false, isLost: false },
      { key: 'won', name: 'Won', color: PALETTE.green, isWon: true, isLost: false },
    ]);
    const keys = out.map((s) => s.key);
    assert.equal(new Set(keys).size, keys.length);
    assert.ok(keys.includes('dup'));
    assert.ok(keys.some((k) => k.startsWith('dup_')));
  });

  it('truncates long names', () => {
    const long = 'x'.repeat(50);
    const out = normalizeStages([
      { key: 'x', name: long, color: PALETTE.slate, isWon: false, isLost: false },
      { key: 'won', name: 'Won', color: PALETTE.green, isWon: true, isLost: false },
    ]);
    const row = out.find((s) => s.key === 'x');
    assert.ok(row.name.length <= 30);
  });

  it('coerces bad colors to slate', () => {
    const out = normalizeStages([
      { key: 'a', name: 'A', color: '#ff00ff', isWon: false, isLost: false },
      { key: 'won', name: 'Won', color: PALETTE.green, isWon: true, isLost: false },
    ]);
    const row = out.find((s) => s.key === 'a');
    assert.equal(row.color, PALETTE.slate);
  });

  it('clamps slaHours', () => {
    const out = normalizeStages([
      { key: 'a', name: 'A', color: PALETTE.slate, slaHours: 9999, isWon: false, isLost: false },
      { key: 'won', name: 'Won', color: PALETTE.green, isWon: true, isLost: false },
    ]);
    const row = out.find((s) => s.key === 'a');
    assert.ok(row.slaHours == null || row.slaHours <= 720);
  });

  it('assigns sort_order by index', () => {
    const out = normalizeStages([
      { key: 'a', name: 'A', color: PALETTE.slate, isWon: false, isLost: false },
      { key: 'b', name: 'B', color: PALETTE.blue, isWon: false, isLost: false },
      { key: 'won', name: 'Won', color: PALETTE.green, isWon: true, isLost: false },
    ]);
    out.forEach((s, i) => assert.equal(s.sortOrder, i));
  });
});

describe('coerceStageDefinitionsForSave', () => {
  it('throws when fewer than 3 stages', () => {
    assert.throws(() =>
      coerceStageDefinitionsForSave([
        { key: 'a', name: 'A', color: PALETTE.slate, isWon: false, isLost: false },
        { key: 'won', name: 'Won', color: PALETTE.green, isWon: true, isLost: false },
      ])
    );
  });

  it('accepts three valid rows in order', () => {
    const out = coerceStageDefinitionsForSave([
      { key: 'a', name: 'A', color: PALETTE.slate, isWon: false, isLost: false, slaHours: 24 },
      { key: 'b', name: 'B', color: PALETTE.blue, isWon: false, isLost: false, slaHours: 48 },
      { key: 'won', name: 'Won', color: PALETTE.green, isWon: true, isLost: false, slaHours: null },
    ]);
    assert.equal(out.length, 3);
    assert.equal(out[0].key, 'a');
    assert.equal(out[2].isWon, true);
  });
});
