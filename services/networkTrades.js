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
];

const TRADE_BY_SLUG = DEFAULT_TRADES.reduce((acc, trade) => {
  acc[trade.slug] = trade;
  return acc;
}, {});

function tradeBySlug(slug) {
  return TRADE_BY_SLUG[String(slug || '').trim()] || null;
}

function tradeLabel(slug) {
  const trade = tradeBySlug(slug);
  return trade ? trade.name : String(slug || '').replace(/_/g, ' ');
}

/** Keep known slugs only, in catalog order, without duplicates. */
function normalizeTradeSlugs(list) {
  const wanted = new Set(
    (Array.isArray(list) ? list : [list])
      .map((slug) => String(slug || '').trim())
      .filter(Boolean),
  );
  return DEFAULT_TRADES.filter((trade) => wanted.has(trade.slug)).map((trade) => trade.slug);
}

function tradesForNetwork(network) {
  const slugs = network && Array.isArray(network.trades) && network.trades.length
    ? normalizeTradeSlugs(network.trades)
    : DEFAULT_TRADES.map((trade) => trade.slug);
  return slugs.map((slug) => TRADE_BY_SLUG[slug]);
}

/** Find leads search prefilled for recruiting an open seat. */
function recruitSearchUrl(slug, zone) {
  const trade = tradeBySlug(slug);
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
  tradeBySlug,
  tradeLabel,
  normalizeTradeSlugs,
  tradesForNetwork,
  recruitSearchUrl,
};
