/**
 * Default trade catalog for a referral network: one exclusive seat per trade
 * per zone. `folder` points at a TRADE_FOLDERS slug when one exists so open
 * seats can link straight into a recruiting search.
 */

const { BY_SLUG: TRADE_FOLDER_BY_SLUG } = require('./tradeFoldersCatalog');

const DEFAULT_TRADES = [
  { slug: 'hvac', name: 'HVAC', folder: 'hvac', keyword: 'HVAC contractor' },
  { slug: 'plumbing', name: 'Plumbing', folder: 'plumbing', keyword: 'plumber' },
  { slug: 'electrical', name: 'Electrical', folder: 'electrical', keyword: 'electrician' },
  { slug: 'roofing', name: 'Roofing', folder: 'roofing', keyword: 'roofing contractor' },
  { slug: 'pest_control', name: 'Pest control', folder: 'pest_control', keyword: 'pest control' },
  { slug: 'pool_service', name: 'Pools', folder: 'pool_service', keyword: 'pool service' },
  { slug: 'landscaping', name: 'Landscaping', folder: 'landscaping', keyword: 'landscaping' },
  { slug: 'lawn_care', name: 'Lawn care', folder: 'lawn_care', keyword: 'lawn care' },
  { slug: 'painting', name: 'Painting', folder: 'painting', keyword: 'painting contractor' },
  { slug: 'garage_door', name: 'Garage doors', folder: 'garage_door', keyword: 'garage door repair' },
  { slug: 'gutter', name: 'Gutters', folder: 'gutter', keyword: 'gutter installation' },
  { slug: 'siding', name: 'Siding', folder: 'siding', keyword: 'siding contractor' },
  { slug: 'remodeling', name: 'Remodeling', folder: 'remodeling', keyword: 'remodeling contractor' },
  { slug: 'handyman', name: 'Handyman', folder: 'handyman', keyword: 'handyman' },
  { slug: 'appliance_repair', name: 'Appliance repair', folder: 'appliance_repair', keyword: 'appliance repair' },
  { slug: 'air_duct_cleaning', name: 'Air duct cleaning', folder: 'air_duct_cleaning', keyword: 'air duct cleaning' },
  { slug: 'water_treatment', name: 'Water treatment', folder: 'water_treatment', keyword: 'water treatment' },
  { slug: 'septic', name: 'Septic', folder: 'septic', keyword: 'septic service' },
  { slug: 'chimney_sweep', name: 'Chimney', folder: 'chimney_sweep', keyword: 'chimney sweep' },
  { slug: 'locksmith', name: 'Locksmith', folder: 'locksmith', keyword: 'locksmith' },
  { slug: 'security', name: 'Security & alarms', folder: 'alarm', keyword: 'home security alarm' },
  { slug: 'flooring', name: 'Flooring', folder: '', keyword: 'flooring contractor' },
  { slug: 'windows_doors', name: 'Windows & doors', folder: '', keyword: 'window installation' },
  { slug: 'cleaning', name: 'House cleaning', folder: '', keyword: 'house cleaning service' },
  { slug: 'real_estate', name: 'Real estate', folder: '', keyword: 'real estate agent' },
  { slug: 'insurance', name: 'Insurance', folder: '', keyword: 'home insurance agent' },
  { slug: 'interior_design', name: 'Interior design', folder: '', keyword: 'interior designer' },
  { slug: 'cabinets', name: 'Cabinets', folder: '', keyword: 'cabinet maker' },
  { slug: 'countertops', name: 'Countertops', folder: '', keyword: 'countertop installer' },
  { slug: 'tile', name: 'Tile', folder: '', keyword: 'tile contractor' },
  { slug: 'carpet_cleaning', name: 'Carpet cleaning', folder: '', keyword: 'carpet cleaning' },
  { slug: 'pressure_washing', name: 'Pressure washing', folder: '', keyword: 'pressure washing' },
  { slug: 'fencing', name: 'Fencing', folder: '', keyword: 'fence contractor' },
  { slug: 'concrete', name: 'Concrete', folder: '', keyword: 'concrete contractor' },
  { slug: 'junk_removal', name: 'Junk removal', folder: '', keyword: 'junk removal' },
  { slug: 'moving', name: 'Moving', folder: '', keyword: 'moving company' },
  { slug: 'solar', name: 'Solar', folder: '', keyword: 'solar installer' },
  { slug: 'home_inspection', name: 'Home inspection', folder: '', keyword: 'home inspector' },
  { slug: 'mortgage', name: 'Mortgage', folder: '', keyword: 'mortgage broker' },
];

/** Trades a network had before the catalog grew; new built-ins stay opt-in for those networks. */
const ORIGINAL_TRADE_SLUGS = DEFAULT_TRADES.slice(0, 26).map((trade) => trade.slug);

const TRADE_BY_SLUG = DEFAULT_TRADES.reduce((acc, trade) => {
  acc[trade.slug] = trade;
  return acc;
}, {});

const CUSTOM_PREFIX = 'x_';
const CUSTOM_SLUG_RE = /^x_[a-z0-9_]{1,40}$/;
const MAX_CUSTOM_TRADES = 30;

function isCustomSlug(slug) {
  return CUSTOM_SLUG_RE.test(String(slug || ''));
}

function customSlug(name) {
  const base = String(name || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
    .replace(/_+$/g, '');
  return base ? CUSTOM_PREFIX + base : '';
}

function cleanName(value, max) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
}

/** A network's own trades: [{ slug: 'x_…', name, keyword }], no clashes with built-ins. */
function normalizeCustomTrades(raw) {
  const builtInNames = new Set(DEFAULT_TRADES.map((t) => t.name.toLowerCase()));
  const seen = new Set();
  const out = [];
  (Array.isArray(raw) ? raw : []).forEach((row) => {
    const name = cleanName(row && row.name, 40);
    const slug = isCustomSlug(row && row.slug) ? row.slug : customSlug(name);
    if (!name || !slug || seen.has(slug) || builtInNames.has(name.toLowerCase())) return;
    seen.add(slug);
    out.push({ slug, name, folder: '', keyword: cleanName(row.keyword, 80) || name.toLowerCase(), custom: true });
  });
  return out.slice(0, MAX_CUSTOM_TRADES);
}

/** Built-in trades plus the network's custom ones. */
function catalogFor(network) {
  return DEFAULT_TRADES.concat(normalizeCustomTrades(network && network.customTrades));
}

function tradeBySlug(slug, network) {
  const key = String(slug || '').trim();
  if (TRADE_BY_SLUG[key]) return TRADE_BY_SLUG[key];
  if (!isCustomSlug(key) || !network) return null;
  return normalizeCustomTrades(network.customTrades).find((t) => t.slug === key) || null;
}

function tradeLabel(slug, network) {
  const trade = tradeBySlug(slug, network);
  if (trade) return trade.name;
  const words = String(slug || '').replace(/^x_/, '').replace(/_/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : '';
}

/**
 * Dedupe and order trade slugs. With a catalog, only its slugs survive (in
 * catalog order). Without one, built-ins come first and well-formed custom
 * slugs are kept, since members and referrals don't carry the network.
 */
function normalizeTradeSlugs(list, catalog) {
  const given = (Array.isArray(list) ? list : [list])
    .map((slug) => String(slug || '').trim())
    .filter(Boolean);
  const wanted = new Set(given);
  if (Array.isArray(catalog)) return catalog.filter((trade) => wanted.has(trade.slug)).map((trade) => trade.slug);
  const builtIn = DEFAULT_TRADES.filter((trade) => wanted.has(trade.slug)).map((trade) => trade.slug);
  return builtIn.concat([...new Set(given.filter(isCustomSlug))]);
}

function tradesForNetwork(network) {
  const catalog = catalogFor(network);
  const slugs = network && Array.isArray(network.trades) && network.trades.length
    ? normalizeTradeSlugs(network.trades, catalog)
    : ORIGINAL_TRADE_SLUGS;
  const bySlug = Object.fromEntries(catalog.map((t) => [t.slug, t]));
  return slugs.map((slug) => bySlug[slug]).filter(Boolean);
}

/** Find leads search prefilled for recruiting an open seat. */
function recruitSearchUrl(slug, zone, network) {
  const trade = tradeBySlug(slug, network);
  if (!trade) return '/leads/find';
  const folder = trade.folder ? TRADE_FOLDER_BY_SLUG[trade.folder] : null;
  const params = new URLSearchParams();
  params.set('type', 'maps');
  params.set('keyword', (folder && folder.keyword) || trade.keyword);
  const firstCity = zone && Array.isArray(zone.cities) ? String(zone.cities[0] || '').trim() : '';
  if (firstCity) {
    const [city, state] = firstCity.split(',').map((part) => part.trim());
    if (city) params.set('city', city);
    if (state) params.set('state', state);
  }
  return `/leads/find?${params.toString()}`;
}

module.exports = {
  DEFAULT_TRADES,
  ORIGINAL_TRADE_SLUGS,
  MAX_CUSTOM_TRADES,
  isCustomSlug,
  customSlug,
  normalizeCustomTrades,
  catalogFor,
  tradeBySlug,
  tradeLabel,
  normalizeTradeSlugs,
  tradesForNetwork,
  recruitSearchUrl,
};
