/**
 * Shared lead filters for Ops role bots (Prospect / Opportunity SDR).
 */
const { leadSmsBlock } = require('../smsOutbound');
const { TRADE_FOLDERS } = require('../tradeFoldersCatalog');
const { TRADE_ALIASES } = require('../folderTradeMatcher');

/** Tags / labels that mean do not outreach (SMS STOP, DNC, etc.). */
const BLOCK_TAG_RE =
  /\b(sms\s*stop|stop\s*sms|opt[\s-]?out|unsubscribed?|do\s*not\s*contact|do\s*not\s*call|dnc)\b/i;

const NON_HOME_SERVICE_RE =
  /\b(restaurant|cafe|coffee|bar\b|grill|bistro|food\s*truck|bakery|pizza|sushi|seo\b|marketing\s*agency|digital\s*agency|salon|spa\b|gym\b|fitness|retail\s*store|boutique|hotel|motel|church|school|dentist|chiropractic|law\s*firm|attorney)\b/i;

/** Portland–Vancouver metro (OR / WA) cities Prospect SDR should stay inside. */
const PNW_METRO_CITIES = new Set(
  [
    'portland',
    'beaverton',
    'hillsboro',
    'tigard',
    'tualatin',
    'lake oswego',
    'west linn',
    'milwaukie',
    'oregon city',
    'gresham',
    'happy valley',
    'clackamas',
    'fairview',
    'troutdale',
    'sherwood',
    'wilsonville',
    'vancouver',
    'camas',
    'washougal',
    'battle ground',
    'ridgefield',
    'brush prairie',
    'hazel dell',
    'orchards',
    'salmon creek',
    'felida',
    'lacenter',
    'la center',
    'woodland',
  ].map((c) => c.toLowerCase()),
);

function leadTagTexts(lead) {
  const tags = Array.isArray(lead && lead.tags) ? lead.tags : [];
  return tags.map((t) => {
    if (t && typeof t === 'object') return String(t.name || t.label || t.key || t.id || '').trim();
    return String(t || '').trim();
  }).filter(Boolean);
}

function leadHaystack(lead) {
  return [
    lead && lead.categoryName,
    lead && lead.category,
    lead && lead.industry,
    lead && lead.title,
    lead && lead.company,
    lead && lead.folderName,
    lead && lead.primaryFolderName,
  ]
    .map((x) => String(x || '').trim().toLowerCase())
    .filter(Boolean)
    .join(' · ');
}

function leadCityText(lead) {
  return [
    lead && lead.city,
    lead && lead.address,
    lead && lead.formattedAddress,
    lead && lead.location,
  ]
    .map((x) => String(x || '').trim().toLowerCase())
    .filter(Boolean)
    .join(' ');
}

/** True when lead must not be recommended for outreach (DNC / SMS STOP / opt-out). */
function leadBlocksOutreach(lead) {
  if (!lead || typeof lead !== 'object') return true;
  if (leadSmsBlock(lead)) return true;
  if (lead.doNotCall || lead.doNotContact || lead.smsOptOut) return true;
  return leadTagTexts(lead).some((tag) => BLOCK_TAG_RE.test(tag));
}

function homeServicePatterns() {
  const patterns = new Set();
  for (const trade of TRADE_FOLDERS) {
    patterns.add(String(trade.name || '').toLowerCase());
    patterns.add(String(trade.slug || '').replace(/_/g, ' '));
    for (const word of String(trade.keyword || '').toLowerCase().split(/\s+/)) {
      if (word.length >= 4) patterns.add(word);
    }
    for (const alias of TRADE_ALIASES[trade.slug] || []) {
      patterns.add(String(alias).toLowerCase());
    }
  }
  // Extra home-service stems not always in the catalog aliases.
  [
    'contractor',
    'roofing',
    'roofer',
    'electrician',
    'plumber',
    'hvac',
    'remodel',
    'flooring',
    'concrete',
    'fence',
    'deck',
    'window',
    'insulation',
    'cleaning',
    'pressure wash',
    'tree service',
    'excavation',
  ].forEach((p) => patterns.add(p));
  return [...patterns].filter(Boolean);
}

const HOME_SERVICE_PATTERNS = homeServicePatterns();

function isHomeServiceLead(lead) {
  const hay = leadHaystack(lead);
  if (!hay) return false;
  if (NON_HOME_SERVICE_RE.test(hay)) return false;
  return HOME_SERVICE_PATTERNS.some((p) => p && hay.includes(p));
}

function isPnwMetroLead(lead) {
  const text = leadCityText(lead);
  if (!text) return false;
  for (const city of PNW_METRO_CITIES) {
    if (text.includes(city)) return true;
  }
  // State+metro hints (e.g. "Vancouver, WA")
  if (/\bvancouver\b/.test(text) && /\b(wa|washington)\b/.test(text)) return true;
  if (/\bportland\b/.test(text) && /\b(or|oregon)\b/.test(text)) return true;
  return false;
}

/** Prospect SDR pool: contactable home-service businesses in Portland–Vancouver. */
function filterProspectPool(leads) {
  return (Array.isArray(leads) ? leads : []).filter(
    (l) => !leadBlocksOutreach(l) && isHomeServiceLead(l) && isPnwMetroLead(l),
  );
}

/** Opportunity SDR pool: drop DNC / SMS STOP before ranking. */
function filterOpportunityPool(leads) {
  return (Array.isArray(leads) ? leads : []).filter((l) => !leadBlocksOutreach(l));
}

module.exports = {
  leadBlocksOutreach,
  isHomeServiceLead,
  isPnwMetroLead,
  filterProspectPool,
  filterOpportunityPool,
  PNW_METRO_CITIES,
  BLOCK_TAG_RE,
};
