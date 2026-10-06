/**
 * AI-picked referral partner niches for a business: the 26 kinds of local
 * businesses most likely to send it work. Niches map onto the referral
 * network trade catalog (built-ins where they match, custom trades otherwise).
 */
const { chatCompletion, parseLlmJson } = require('./llmClient');
const { suggestProviders } = require('./suggestPipelineStages');
const { DEFAULT_TRADES, MAX_CUSTOM_TRADES, customSlug, normalizeCustomTrades } = require('./networkTrades');

const NICHE_COUNT = 26;
const PROVIDER_TIMEOUT_MS = 25000;
const TOTAL_BUDGET_MS = 50000;

const SYSTEM_PROMPT = `You build referral partner lists for local businesses.

Given a business description, list exactly ${NICHE_COUNT} types of local businesses that serve the same customers right before, during, or after this business does, so they can refer jobs to each other. Order them from the strongest referral source to the weakest.

Rules:
- Never include the business's own trade or a direct competitor.
- Each niche is a business type someone could search on Google Maps (e.g. "Realtors", "Kitchen & bath remodelers"), not a person or a brand.
- "keyword" is the Google Maps search term to find them.
- "why" is one short sentence (under 110 characters) on why they refer work to this business.

Return ONLY JSON:
{ "niches": [ { "name": "string<=40", "keyword": "string<=60", "why": "string" } ] }`;

const CONNECTOR_SLUGS = ['real_estate', 'remodeling', 'home_inspection', 'insurance', 'mortgage', 'interior_design', 'solar'];

const ALIASES = {
  realtor: 'real_estate',
  realtors: 'real_estate',
  realestateagent: 'real_estate',
  realestateagents: 'real_estate',
  hvaccontractor: 'hvac',
  hvaccontractors: 'hvac',
  plumber: 'plumbing',
  plumbers: 'plumbing',
  electrician: 'electrical',
  electricians: 'electrical',
  roofer: 'roofing',
  roofers: 'roofing',
  painter: 'painting',
  painters: 'painting',
  landscaper: 'landscaping',
  landscapers: 'landscaping',
  homeinspector: 'home_inspection',
  homeinspectors: 'home_inspection',
  insuranceagent: 'insurance',
  insuranceagents: 'insurance',
  mortgagebroker: 'mortgage',
  mortgagebrokers: 'mortgage',
  mortgagelender: 'mortgage',
  mortgagelenders: 'mortgage',
  interiordesigner: 'interior_design',
  interiordesigners: 'interior_design',
  solarinstaller: 'solar',
  solarinstallers: 'solar',
  movers: 'moving',
  handymen: 'handyman',
};

function norm(s) {
  return String(s || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '');
}

const BUILTIN_INDEX = (() => {
  const idx = new Map();
  const add = (k, slug) => {
    const n = norm(k);
    if (n && !idx.has(n)) idx.set(n, slug);
  };
  DEFAULT_TRADES.forEach((t) => {
    add(t.name, t.slug);
    add(t.keyword, t.slug);
    add(t.slug, t.slug);
    add(`${t.keyword}s`, t.slug);
  });
  Object.entries(ALIASES).forEach(([k, slug]) => add(k, slug));
  return idx;
})();

const TRADE_BY_SLUG = Object.fromEntries(DEFAULT_TRADES.map((t) => [t.slug, t]));

function matchBuiltIn(name, keyword) {
  for (const raw of [name, keyword]) {
    const n = norm(raw);
    if (!n) continue;
    if (BUILTIN_INDEX.has(n)) return BUILTIN_INDEX.get(n);
    if (n.endsWith('s') && BUILTIN_INDEX.has(n.slice(0, -1))) return BUILTIN_INDEX.get(n.slice(0, -1));
  }
  return null;
}

function clean(s, max) {
  return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Built-in trades the business itself does, judged from its description. */
function ownTradeSlugs(description) {
  const text = String(description || '').toLowerCase();
  const mentions = (k) => {
    const esc = String(k || '').toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return !!esc && new RegExp(`\\b${esc}\\b`).test(text);
  };
  return new Set(DEFAULT_TRADES.filter((t) => mentions(t.name) || mentions(t.keyword)).map((t) => t.slug));
}

function builtInNiche(slug, why) {
  const t = TRADE_BY_SLUG[slug];
  return { slug, name: t.name, keyword: t.keyword, why: why || '', builtIn: true };
}

/** Raw AI rows → deduped niches with catalog slugs. */
function mapNiches(rows, ownSlugs) {
  const out = [];
  const seen = new Set();
  let customCount = 0;
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    if (!row || typeof row !== 'object') return;
    const name = clean(row.name, 40);
    if (!name) return;
    const keyword = clean(row.keyword, 60) || name.toLowerCase();
    const why = clean(row.why, 140);
    const slug = matchBuiltIn(name, keyword);
    if (slug) {
      if (seen.has(slug) || ownSlugs.has(slug)) return;
      seen.add(slug);
      out.push(builtInNiche(slug, why));
      return;
    }
    const cslug = customSlug(name);
    if (!cslug || seen.has(cslug) || customCount >= MAX_CUSTOM_TRADES) return;
    seen.add(cslug);
    customCount += 1;
    out.push({ slug: cslug, name, keyword, why, builtIn: false });
  });
  return out;
}

function starterNiches(description, existing = []) {
  const own = ownTradeSlugs(description);
  const seen = new Set(existing.map((n) => n.slug));
  const out = existing.slice();
  const order = CONNECTOR_SLUGS.concat(DEFAULT_TRADES.map((t) => t.slug));
  for (const slug of order) {
    if (out.length >= NICHE_COUNT) break;
    if (seen.has(slug) || own.has(slug) || !TRADE_BY_SLUG[slug]) continue;
    seen.add(slug);
    out.push(builtInNiche(slug, ''));
  }
  return out;
}

function parseNichesResponse(raw) {
  const parsed = typeof raw === 'string' ? parseLlmJson(raw) : null;
  if (!parsed) return null;
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed.niches)) return parsed.niches;
  if (Array.isArray(parsed.partners)) return parsed.partners;
  return null;
}

/**
 * @param {{ businessDescription: string, businessName?: string }} input
 * @param {{ integrationEnv?: Record<string,string>|null }} [opts]
 * @returns {Promise<{ niches: Array<{slug,name,keyword,why,builtIn}>, fallback: boolean }>}
 */
async function suggestReferralNiches(input, opts = {}) {
  const description = clean(input && input.businessDescription, 1500);
  const businessName = clean(input && input.businessName, 120);
  const own = ownTradeSlugs(description);
  if (!description) return { niches: starterNiches(''), fallback: true };

  const integrationEnv = (opts && opts.integrationEnv) || null;
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: [businessName ? `Business name: ${businessName}` : '', `Business description:\n${description}`].filter(Boolean).join('\n\n'),
    },
  ];

  const started = Date.now();
  let best = [];
  for (const prov of suggestProviders(integrationEnv)) {
    const remaining = TOTAL_BUDGET_MS - (Date.now() - started);
    if (remaining < 5000) break;
    let ai;
    try {
      ai = await chatCompletion({
        providersOverride: [prov],
        integrationEnv,
        messages,
        jsonObject: true,
        max_tokens: 2500,
        temperature: 0.4,
        timeoutMs: Math.min(PROVIDER_TIMEOUT_MS, remaining),
        allowReasoningFallback: false,
      });
    } catch (e) {
      console.warn('[referral-niches]', prov.name, e.message);
      continue;
    }
    const rows = ai && ai.content && !ai.error ? parseNichesResponse(ai.content) : null;
    const mapped = rows ? mapNiches(rows, own) : [];
    if (mapped.length > best.length) best = mapped;
    if (best.length >= NICHE_COUNT) break;
    console.warn('[referral-niches] only', mapped.length, 'usable niches from', prov.name, (ai && ai.errorMessage) || '');
  }

  if (best.length >= 10) {
    return { niches: starterNiches(description, best.slice(0, NICHE_COUNT)), fallback: false };
  }
  console.warn('[referral-niches] AI unavailable, using starter niches');
  return { niches: starterNiches(description), fallback: true };
}

/** Network trade settings for a niche list: { trades, customTrades } merged onto the network's existing customs. */
function nichesToNetworkTrades(niches, network) {
  const list = Array.isArray(niches) ? niches : [];
  const existing = normalizeCustomTrades(network && network.customTrades).map(({ slug, name, keyword }) => ({ slug, name, keyword }));
  const have = new Set(existing.map((t) => t.slug));
  const customTrades = existing.slice();
  list.forEach((n) => {
    if (n.builtIn || have.has(n.slug) || customTrades.length >= MAX_CUSTOM_TRADES) return;
    have.add(n.slug);
    customTrades.push({ slug: n.slug, name: n.name, keyword: n.keyword });
  });
  const trades = list.filter((n) => n.builtIn || have.has(n.slug)).map((n) => n.slug);
  return { trades, customTrades };
}

/**
 * Point the workspace's referral network at these niches. Networks that already
 * have members keep their trades so nobody loses a seat.
 */
async function applyNichesToNetwork(workspaceId, niches, { name, ownerEmail } = {}) {
  const store = require('./networkStore');
  const network = await store.getOrCreateNetworkForWorkspace(workspaceId, { name, ownerEmail });
  const members = await store.listMembers(network.id);
  if (members.length) return { network, applied: false };
  const { trades, customTrades } = nichesToNetworkTrades(niches, network);
  if (!trades.length) return { network, applied: false };
  const saved = await store.saveNetwork({ ...network, trades, customTrades });
  return { network: saved, applied: true };
}

/** Find leads search for one niche, scoped to the workspace's city when it has one. */
function nicheSearchUrl(niche, icp) {
  const params = new URLSearchParams();
  params.set('type', 'maps');
  params.set('keyword', String((niche && niche.keyword) || (niche && niche.name) || ''));
  const city = clean(icp && icp.city, 80);
  const state = clean(icp && icp.state, 40);
  if (city) params.set('city', city);
  if (state) params.set('state', state);
  return `/leads/find?${params.toString()}`;
}

module.exports = {
  NICHE_COUNT,
  suggestReferralNiches,
  mapNiches,
  starterNiches,
  ownTradeSlugs,
  parseNichesResponse,
  nichesToNetworkTrades,
  applyNichesToNetwork,
  nicheSearchUrl,
};
