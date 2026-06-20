/**
 * Match custom folder names to ServiceTitan trade slugs (e.g. "Electricians PDX" → electrical).
 */

const { TRADE_FOLDERS, BY_SLUG } = require('./tradeFoldersCatalog');

const LOCATION_TOKENS = new Set([
  'pdx',
  'portland',
  'seattle',
  'spokane',
  'vancouver',
  'eugene',
  'salem',
  'beaverton',
  'gresham',
  'hillsboro',
  'tigard',
  'milwaukie',
  'clackamas',
  'oregon',
  'washington',
  'california',
  'texas',
  'florida',
  'denver',
  'atlanta',
  'phoenix',
  'chicago',
  'dallas',
  'houston',
  'miami',
  'boston',
  'nyc',
  'la',
  'sf',
  'sea',
  'por',
  'area',
  'local',
  'near me',
]);

/** Extra stems beyond catalog name/keyword/slug */
const TRADE_ALIASES = {
  hvac: ['hvac', 'heating', 'cooling', 'furnace', 'air conditioning', 'ac repair'],
  plumbing: ['plumber', 'plumbers', 'plumbing', 'drain'],
  electrical: ['electrician', 'electricians', 'electrical', 'electric'],
  garage_door: ['garage door', 'garage doors'],
  chimney_sweep: ['chimney', 'chimney sweep'],
  roofing: ['roofer', 'roofers', 'roofing', 'roof repair'],
  irrigation: ['irrigation', 'sprinkler'],
  water_treatment: ['water treatment', 'water softener', 'water filtration'],
  septic: ['septic', 'sewer'],
  painting: ['painter', 'painters', 'painting'],
  pool_service: ['pool', 'pool service', 'pool cleaning'],
  landscaping: ['landscaper', 'landscapers', 'landscaping', 'landscape'],
  lawn_care: ['lawn', 'lawn care', 'mowing', 'mower'],
  pest_control: ['pest', 'exterminator', 'pest control'],
  air_duct_cleaning: ['duct', 'air duct', 'duct cleaning'],
  kitchen_equipment: ['kitchen equipment', 'commercial kitchen', 'restaurant equipment'],
  audio_visual: ['audio visual', 'av installer', 'home theater'],
  alarm: ['alarm', 'security', 'security system'],
  appliance_repair: ['appliance', 'appliance repair'],
  remodeling: ['remodel', 'remodeling', 'renovation', 'renovations'],
  locksmith: ['locksmith', 'locksmiths'],
  refrigeration: ['refrigeration', 'refrigerator', 'fridge', 'freezer', 'commercial fridge', 'cooler'],
  handyman: ['handyman', 'handymen'],
  gutter: ['gutter', 'gutters'],
  siding: ['siding'],
  dock_door: ['dock', 'dock door', 'loading dock'],
  fire_life_safety: ['fire', 'fire protection', 'fire safety', 'sprinkler'],
  mechanical: ['mechanical', 'mechanical contractor'],
};

function normalizeFolderName(name) {
  let s = String(name || '')
    .toLowerCase()
    .trim()
    .replace(/[^\w\s]/g, ' ');
  const words = s.split(/\s+/).filter(Boolean);
  const filtered = words.filter((w) => !LOCATION_TOKENS.has(w));
  return filtered.join(' ').trim() || s.replace(/\s+/g, ' ').trim();
}

function tradeMatchPatterns(trade) {
  const patterns = new Set();
  patterns.add(String(trade.name || '').toLowerCase());
  patterns.add(String(trade.slug || '').replace(/_/g, ' '));
  for (const word of String(trade.keyword || '').toLowerCase().split(/\s+/)) {
    if (word.length >= 4) patterns.add(word);
  }
  for (const alias of TRADE_ALIASES[trade.slug] || []) {
    patterns.add(alias.toLowerCase());
  }
  return [...patterns].filter(Boolean).sort((a, b) => b.length - a.length);
}

function scoreTradeMatch(normalizedName, trade) {
  if (!normalizedName) return 0;
  const tradeName = String(trade.name || '').toLowerCase();
  if (normalizedName === tradeName) return 100;

  const slugPhrase = String(trade.slug || '').replace(/_/g, ' ');
  if (slugPhrase && normalizedName.includes(slugPhrase)) return 92;

  const keyword = String(trade.keyword || '').toLowerCase();
  if (keyword && normalizedName.includes(keyword)) return 88;

  let best = 0;
  for (const pattern of tradeMatchPatterns(trade)) {
    if (!pattern) continue;
    if (normalizedName === pattern) best = Math.max(best, 95);
    else if (normalizedName.includes(pattern)) best = Math.max(best, 70 + Math.min(pattern.length, 20));
    else if (pattern.length >= 5 && normalizedName.startsWith(pattern)) best = Math.max(best, 75);
  }

  // Stem: "electricians" ↔ "electric"
  if (trade.slug === 'electrical' && /\belectric/i.test(normalizedName)) best = Math.max(best, 82);
  if (trade.slug === 'landscaping' && /\blandscap/i.test(normalizedName)) best = Math.max(best, 82);
  if (trade.slug === 'refrigeration' && /\b(fridge|refriger|cooler|freezer)\b/i.test(normalizedName)) {
    best = Math.max(best, 85);
  }

  return best;
}

const MIN_MATCH_SCORE = 70;

/**
 * @param {string} folderName
 * @returns {{ slug: string, score: number, trade: object } | null}
 */
function matchFolderToTrade(folderName) {
  const normalized = normalizeFolderName(folderName);
  if (!normalized) return null;

  let best = null;
  for (const trade of TRADE_FOLDERS) {
    const score = scoreTradeMatch(normalized, trade);
    if (score < MIN_MATCH_SCORE) continue;
    if (!best || score > best.score) {
      best = { slug: trade.slug, score, trade };
    }
  }
  return best;
}

module.exports = {
  normalizeFolderName,
  matchFolderToTrade,
  TRADE_ALIASES,
  MIN_MATCH_SCORE,
  BY_SLUG,
};
