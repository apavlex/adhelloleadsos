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

module.exports = {
  normalizeWorkspaceAccentHex,
  WORKSPACE_UI_ACCENTS,
};
