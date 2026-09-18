/**
 * @param {string} raw
 * @returns {string|null} canonical #ABCDEF or null
 */
function normalizeWorkspaceAccentHex(raw) {
  const s = String(raw || '').trim();
  if (!/^#[0-9A-Fa-f]{6}$/.test(s)) return null;
  return '#' + s.slice(1).toUpperCase();
}

/** Primary choices shown on Workspace settings (warm amber vs bright yellow). */
const WORKSPACE_UI_ACCENTS = [
  { key: 'amber', label: 'Amber', description: 'Warm brown-gold — default', hex: '#CA8A04' },
  { key: 'yellow', label: 'Bright yellow', description: 'High-energy Agency yellow', hex: '#FFD644' },
];

/** Button / on-accent text presets. */
const WORKSPACE_UI_ACCENT_TEXT = [
  { key: 'dark', label: 'Dark', hex: '#111827' },
  { key: 'white', label: 'White', hex: '#FFFFFF' },
];

/**
 * Relative luminance 0–1 (sRGB). Higher = lighter.
 * @param {string} hex
 * @returns {number|null}
 */
function accentLuminance(hex) {
  const norm = normalizeWorkspaceAccentHex(hex);
  if (!norm) return null;
  const r = parseInt(norm.slice(1, 3), 16) / 255;
  const g = parseInt(norm.slice(3, 5), 16) / 255;
  const b = parseInt(norm.slice(5, 7), 16) / 255;
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/**
 * Readable text on a solid accent fill. Light accents → dark ink; dark accents → white.
 * @param {string} accentHex
 * @returns {string} #111827 or #FFFFFF
 */
function contrastTextForAccent(accentHex) {
  const L = accentLuminance(accentHex);
  if (L == null) return '#111827';
  return L > 0.45 ? '#111827' : '#FFFFFF';
}

/**
 * Resolve saved or auto on-accent text color.
 * @param {string|null|undefined} accentHex
 * @param {string|null|undefined} textHex
 * @returns {string}
 */
function resolveAccentTextColor(accentHex, textHex) {
  const saved = normalizeWorkspaceAccentHex(textHex);
  if (saved) return saved;
  return contrastTextForAccent(accentHex || '#CA8A04');
}

module.exports = {
  normalizeWorkspaceAccentHex,
  WORKSPACE_UI_ACCENTS,
  WORKSPACE_UI_ACCENT_TEXT,
  accentLuminance,
  contrastTextForAccent,
  resolveAccentTextColor,
};
