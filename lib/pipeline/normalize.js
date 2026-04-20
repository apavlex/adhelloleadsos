/**
 * Validate & normalize pipeline stage rows from LLM or user input.
 */

const { PALETTE } = require('./presets');

const PALETTE_VALUES = new Set(Object.values(PALETTE));

const MIN_STAGES = 3;
const MAX_STAGES = 12;

function snakeCaseKey(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

function coerceColor(input) {
  const s = String(input || '').trim().toLowerCase();
  if (PALETTE_VALUES.has(s)) return s;
  if (/^#[0-9a-f]{6}$/i.test(s) && [...PALETTE_VALUES].some((v) => v.toLowerCase() === s)) return s;
  return PALETTE.slate;
}

function clampSla(h) {
  if (h == null || h === '') return null;
  const n = typeof h === 'number' ? h : parseInt(String(h), 10);
  if (!Number.isFinite(n)) return null;
  if (n < 1) return null;
  return Math.min(720, n);
}

function truncateName(name) {
  const s = String(name || '').trim();
  return s.length > 30 ? s.slice(0, 30) : s;
}

/**
 * @param {Array<object>} rawStages
 * @returns {Array<{ key: string, name: string, color: string, sortOrder: number, isWon: boolean, isLost: boolean, slaHours: number|null }>}
 */
function normalizeStages(rawStages) {
  let arr = Array.isArray(rawStages) ? rawStages.slice() : [];
  if (arr.length > MAX_STAGES) arr = arr.slice(0, MAX_STAGES);

  const out = [];
  const seenKeys = new Map();

  for (let i = 0; i < arr.length; i += 1) {
    const row = arr[i] || {};
    let key = snakeCaseKey(row.key != null ? row.key : row.name);
    if (!key) key = `stage_${i + 1}`;

    let base = key;
    let n = 2;
    while (seenKeys.has(key)) {
      key = `${base}_${n}`;
      n += 1;
    }
    seenKeys.set(key, true);

    let name = truncateName(row.name || key.replace(/_/g, ' '));
    if (!name) name = 'Stage';

    const isWon = !!row.isWon;
    const isLost = !!row.isLost;
    const color = coerceColor(row.color);
    const slaHours = clampSla(row.slaHours);

    out.push({
      key,
      name,
      color,
      sortOrder: out.length,
      isWon,
      isLost,
      slaHours,
    });
  }

  if (out.length > MAX_STAGES) {
    return normalizeStages(out.slice(0, MAX_STAGES));
  }

  const nonTerminal = out.filter((s) => !s.isWon && !s.isLost);
  if (nonTerminal.length === 0 || (out[0] && (out[0].isWon || out[0].isLost))) {
    out.unshift({
      key: 'new',
      name: 'New',
      color: PALETTE.slate,
      sortOrder: 0,
      isWon: false,
      isLost: false,
      slaHours: 24,
    });
  }

  for (let i = 0; i < out.length; i += 1) {
    out[i].sortOrder = i;
  }

  if (!out.some((s) => s.isWon)) {
    out.push({
      key: 'won',
      name: 'Won',
      color: PALETTE.green,
      sortOrder: out.length,
      isWon: true,
      isLost: false,
      slaHours: null,
    });
  }

  for (let i = 0; i < out.length; i += 1) {
    out[i].sortOrder = i;
  }

  if (out.length < MIN_STAGES) {
    while (out.length < MIN_STAGES) {
      const idx = out.length;
      out.splice(out.length - 1, 0, {
        key: `qualification_${idx}`,
        name: `Stage ${idx + 1}`,
        color: PALETTE.blue,
        sortOrder: idx,
        isWon: false,
        isLost: false,
        slaHours: 48,
      });
      for (let j = 0; j < out.length; j += 1) {
        out[j].sortOrder = j;
      }
    }
  }

  return out.slice(0, MAX_STAGES);
}

/**
 * Sanitize an ordered stage list from the settings UI without inserting stages
 * (preserves row count and alignment with client-provided ids).
 * @throws {Error} message for user-visible validation failures
 */
function coerceStageDefinitionsForSave(rawList) {
  const arr = Array.isArray(rawList) ? rawList.slice(0, MAX_STAGES) : [];
  if (arr.length < MIN_STAGES) {
    throw new Error(`At least ${MIN_STAGES} pipeline stages are required.`);
  }
  if (arr.length > MAX_STAGES) {
    throw new Error(`At most ${MAX_STAGES} pipeline stages are allowed.`);
  }

  const seenKeys = new Map();
  const out = [];

  for (let i = 0; i < arr.length; i += 1) {
    const row = arr[i] || {};
    let key = snakeCaseKey(row.key != null ? row.key : row.name);
    if (!key) key = `stage_${i + 1}`;

    let base = key;
    let n = 2;
    while (seenKeys.has(key)) {
      key = `${base}_${n}`;
      n += 1;
    }
    seenKeys.set(key, true);

    let name = truncateName(row.name || key.replace(/_/g, ' '));
    if (!name) name = 'Stage';

    out.push({
      key,
      name,
      color: coerceColor(row.color),
      sortOrder: i,
      isWon: !!row.isWon,
      isLost: !!row.isLost,
      slaHours: clampSla(row.slaHours),
    });
  }

  const nonTerminal = out.filter((s) => !s.isWon && !s.isLost);
  if (nonTerminal.length === 0) {
    throw new Error('At least one non-terminal pipeline stage is required.');
  }
  if (out[0].isWon || out[0].isLost) {
    throw new Error('The first pipeline stage cannot be Won or Lost.');
  }
  if (!out.some((s) => s.isWon)) {
    throw new Error('At least one Won stage is required.');
  }

  return out;
}

module.exports = {
  normalizeStages,
  coerceStageDefinitionsForSave,
  PALETTE_VALUES,
  MIN_STAGES,
  MAX_STAGES,
};
