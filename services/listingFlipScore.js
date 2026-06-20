/**
 * Mobile home flip deal scoring — rules pre-filter + optional OpenRouter AI enrichment.
 * Runs after multi-source scrape/normalize, before saving leads.
 */

const { chatCompletion, parseLlmJson } = require('./llmClient');

const MOTIVATED_KEYWORDS = [
  'motivated',
  'must sell',
  'must go',
  'estate sale',
  'relocating',
  'moving',
  'urgent',
  'price drop',
  'reduced',
  'below market',
  'steal',
  'great deal',
  'bargain',
  'obo',
  'or best offer',
  'bring offer',
  'quick sale',
];

const FLIP_KEYWORDS = [
  'fixer',
  'as-is',
  'as is',
  'handyman',
  'needs work',
  'needs tlc',
  'tlc',
  'project',
  'rehab',
  'cosmetic',
  'investor',
  'flip',
  'distressed',
  'sold as is',
];

const POSITIVE_KEYWORDS = [
  'land included',
  'own land',
  'fee simple',
  'deeded land',
  'updated',
  'renovated',
  'remodeled',
  'new roof',
  'new hvac',
  'turnkey',
  'move-in ready',
  'move in ready',
];

const RISK_KEYWORDS = [
  'park rent',
  'lot rent',
  'in a park',
  'mobile home park',
  'structural',
  'mold',
  'flood',
  'foundation',
  'cash only',
  'no financing',
];

/** Land-owned / fee-simple signals — park rent eats flip margin. */
const LAND_OWNED_KEYWORDS = [
  'land included',
  'own land',
  'owns land',
  'owned land',
  'land owned',
  'fee simple',
  'deeded land',
  'deeded lot',
  'includes land',
  'with land',
  'on owned land',
  'private land',
  'no lot rent',
  'no park rent',
  'not in a park',
  'not in park',
  ' acre',
  ' acres',
  ' acreage',
];

const NO_HOA_KEYWORDS = [
  'no hoa',
  'without hoa',
  'hoa free',
  'no homeowners association',
  'no association fee',
];

const PARK_LOT_RENT_KEYWORDS = [
  'park rent',
  'lot rent',
  'space rent',
  'pad rent',
  'monthly lot',
  'lot lease',
  'leased lot',
  'rent the lot',
  'pay lot rent',
  'in a park',
  'mobile home park',
  'manufactured home park',
  'community park',
  '55+ park',
  'park community',
  'community fee',
  'hoa fee',
  'association fee',
];

const LAND_MODES = ['any', 'exclude_park', 'prefer_own_land', 'own_land_only'];

const DEFAULT_FLIP_FILTER = {
  enabled: false,
  minFlipScore: 7,
  minRoiPercent: 15,
  onlyUnique: false,
  useAi: true,
  aiMaxCandidates: 20,
  landMode: 'any',
  requireOwnLand: false,
  excludeParkRent: false,
  requireNoHoa: false,
  requirePhrases: [],
  excludePhrases: [],
  boostPhrases: [],
};

function parseNumber(raw, fallback) {
  const n = parseFloat(String(raw ?? '').trim());
  return Number.isFinite(n) ? n : fallback;
}

function parseBool(raw) {
  if (raw === true || raw === 1) return true;
  const s = String(raw || '').trim().toLowerCase();
  return s === 'on' || s === 'true' || s === '1' || s === 'yes';
}

function parsePhraseList(raw) {
  if (Array.isArray(raw)) {
    return raw.map((s) => String(s || '').trim().toLowerCase()).filter(Boolean);
  }
  if (raw == null) return [];
  return String(raw)
    .split(/[\n,;|]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function uniquePhrases(list) {
  return [...new Set(list.map((s) => String(s || '').trim().toLowerCase()).filter(Boolean))];
}

function normalizeLandMode(raw) {
  const mode = String(raw || '').trim().toLowerCase();
  return LAND_MODES.includes(mode) ? mode : 'any';
}

function resolveDealCriteria(flipFilter) {
  const filter = { ...DEFAULT_FLIP_FILTER, ...flipFilter };
  const requirePhrases = uniquePhrases(filter.requirePhrases || []);
  const excludePhrases = uniquePhrases(filter.excludePhrases || []);
  const boostPhrases = uniquePhrases(filter.boostPhrases || []);

  if (filter.requireOwnLand || filter.landMode === 'own_land_only') {
    requirePhrases.push(...LAND_OWNED_KEYWORDS);
  }
  if (filter.requireNoHoa) {
    requirePhrases.push(...NO_HOA_KEYWORDS);
  }
  if (filter.excludeParkRent || filter.landMode === 'exclude_park' || filter.landMode === 'own_land_only') {
    excludePhrases.push(...PARK_LOT_RENT_KEYWORDS);
  }

  return {
    ...filter,
    landMode: normalizeLandMode(filter.landMode),
    requirePhrases: uniquePhrases(requirePhrases),
    excludePhrases: uniquePhrases(excludePhrases),
    boostPhrases: uniquePhrases(boostPhrases),
  };
}

/**
 * Parse flip filter from schedule record or form body.
 * @param {object} raw
 */
function parseFlipFilter(raw) {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_FLIP_FILTER };

  const nested =
    raw.flipFilter && typeof raw.flipFilter === 'object' ? raw.flipFilter : null;

  const enabled = nested
    ? parseBool(nested.enabled)
    : parseBool(raw.flipFilterEnabled || raw.flipFilter);

  return {
    enabled,
    minFlipScore: parseNumber(
      nested ? nested.minFlipScore : raw.minFlipScore,
      DEFAULT_FLIP_FILTER.minFlipScore
    ),
    minRoiPercent: parseNumber(
      nested ? nested.minRoiPercent : raw.minRoiPercent,
      DEFAULT_FLIP_FILTER.minRoiPercent
    ),
    onlyUnique: nested
      ? parseBool(nested.onlyUnique)
      : parseBool(raw.onlyUnique || raw.flipOnlyUnique),
    useAi: nested
      ? nested.useAi !== false && nested.useAi !== 'false'
      : raw.useAi !== false && raw.useAi !== 'false' && raw.flipUseAi !== 'off',
    aiMaxCandidates: Math.min(
      50,
      Math.max(
        1,
        parseInt(
          nested ? nested.aiMaxCandidates : raw.aiMaxCandidates || raw.flipAiMaxCandidates,
          10
        ) || DEFAULT_FLIP_FILTER.aiMaxCandidates
      )
    ),
    landMode: normalizeLandMode(
      nested ? nested.landMode : raw.landMode || raw.flipLandMode
    ),
    requireOwnLand: nested
      ? parseBool(nested.requireOwnLand)
      : parseBool(raw.requireOwnLand || raw.flipRequireOwnLand),
    excludeParkRent: nested
      ? parseBool(nested.excludeParkRent)
      : parseBool(raw.excludeParkRent || raw.flipExcludePark),
    requireNoHoa: nested
      ? parseBool(nested.requireNoHoa)
      : parseBool(raw.requireNoHoa || raw.flipRequireNoHoa),
    requirePhrases: parsePhraseList(
      nested ? nested.requirePhrases : raw.requirePhrases || raw.flipRequirePhrases
    ),
    excludePhrases: parsePhraseList(
      nested ? nested.excludePhrases : raw.excludePhrases || raw.flipExcludePhrases
    ),
    boostPhrases: parsePhraseList(
      nested ? nested.boostPhrases : raw.boostPhrases || raw.flipBoostPhrases
    ),
  };
}

function listingText(row) {
  const listing = row.listing || {};
  return [
    row.title,
    listing.description,
    listing.propertyType,
    row.address,
    listing.sellerName,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function normalizeAddressKey(row) {
  const addr = String(row.address || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const title = String(row.title || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
  const price = row.listing && row.listing.price != null ? row.listing.price : '';
  if (addr && addr !== 'n/a') return `addr:${addr}|p:${price}`;
  return `title:${title}|p:${price}`;
}

function buildSourceCountMap(listings) {
  const groups = new Map();
  for (const row of listings) {
    const key = normalizeAddressKey(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const sourceCountByKey = new Map();
  for (const [key, rows] of groups) {
    const sources = new Set(
      rows.map((r) => String((r.listing && r.listing.source) || '').trim()).filter(Boolean)
    );
    sourceCountByKey.set(key, sources.size || 1);
  }
  return { groups, sourceCountByKey };
}

function batchMedianPricePerSqft(listings) {
  const values = listings
    .map((row) => {
      const price = row.listing && row.listing.price;
      const sqft = row.listing && row.listing.sqft;
      if (!price || !sqft || sqft <= 0) return null;
      return price / sqft;
    })
    .filter((v) => v != null && Number.isFinite(v));
  if (!values.length) return null;
  values.sort((a, b) => a - b);
  const mid = Math.floor(values.length / 2);
  return values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
}

function countKeywordHits(text, keywords) {
  const hits = [];
  for (const kw of keywords) {
    if (text.includes(kw)) hits.push(kw);
  }
  return hits;
}

/**
 * @returns {'own_land'|'park_lot_rent'|'unknown'}
 */
function classifyLandTenure(text) {
  const landHits = countKeywordHits(text, LAND_OWNED_KEYWORDS);
  const parkHits = countKeywordHits(text, PARK_LOT_RENT_KEYWORDS);

  if (parkHits.length && !landHits.length) return 'park_lot_rent';
  if (landHits.length && !parkHits.length) return 'own_land';
  if (landHits.length && parkHits.length) return 'own_land';
  return 'unknown';
}

function landTenureLabel(tenure) {
  if (tenure === 'own_land') return 'Land owned';
  if (tenure === 'park_lot_rent') return 'Park / lot rent';
  return 'Tenure unclear';
}

function evaluateDealCriteria(text, criteria) {
  const requireHits = countKeywordHits(text, criteria.requirePhrases || []);
  const excludeHits = countKeywordHits(text, criteria.excludePhrases || []);
  const boostHits = countKeywordHits(text, criteria.boostPhrases || []);
  const landTenure = classifyLandTenure(text);
  const landHits = countKeywordHits(text, LAND_OWNED_KEYWORDS);
  const parkHits = countKeywordHits(text, PARK_LOT_RENT_KEYWORDS);

  let excluded = false;
  let excludeReason = '';

  if (excludeHits.length) {
    excluded = true;
    excludeReason = `Excluded phrase match (${excludeHits.slice(0, 2).join(', ')})`;
  }

  const requireActive =
    (criteria.requirePhrases && criteria.requirePhrases.length > 0) ||
    criteria.landMode === 'own_land_only' ||
    criteria.requireOwnLand;

  if (!excluded && requireActive) {
    const passesRequire = requireHits.length > 0;
    if (!passesRequire && criteria.landMode === 'own_land_only') {
      excluded = true;
      excludeReason = 'No land-owned signals in listing (own-land automode)';
    } else if (!passesRequire && criteria.requirePhrases.length) {
      excluded = true;
      excludeReason = 'Missing required description phrases';
    }
  }

  if (!excluded && criteria.landMode === 'own_land_only' && landTenure === 'park_lot_rent') {
    excluded = true;
    excludeReason = 'Park / lot-rent deal (own-land automode)';
  }

  if (!excluded && criteria.landMode === 'exclude_park' && landTenure === 'park_lot_rent') {
    excluded = true;
    excludeReason = 'Park / lot-rent deal';
  }

  let landScoreDelta = 0;
  if (landTenure === 'own_land') landScoreDelta += 1.5;
  if (landTenure === 'park_lot_rent') landScoreDelta -= 1.5;
  if (criteria.landMode === 'prefer_own_land') {
    if (landTenure === 'own_land') landScoreDelta += 1;
    if (landTenure === 'park_lot_rent') landScoreDelta -= 1;
  }
  if (boostHits.length) landScoreDelta += Math.min(1.5, boostHits.length * 0.4);

  return {
    landTenure,
    landHits,
    parkHits,
    requireHits,
    excludeHits,
    boostHits,
    excluded,
    excludeReason,
    landScoreDelta,
  };
}

/**
 * @returns {{ ruleScore: number, reasons: string[], risks: string[], sourceCount: number, pricePerSqft: number|null, passesPreFilter: boolean, landTenure: string, dealCriteria: object }}
 */
function scoreListingRules(row, context, criteria = null) {
  const listing = row.listing || {};
  const text = listingText(row);
  const reasons = [];
  const risks = [];
  let ruleScore = 0;

  const sourceCount = context.sourceCountByKey.get(normalizeAddressKey(row)) || 1;
  const price = listing.price;
  const sqft = listing.sqft;
  const pricePerSqft =
    price && sqft && sqft > 0 ? Math.round(price / sqft) : null;

  const motivated = countKeywordHits(text, MOTIVATED_KEYWORDS);
  if (motivated.length) {
    ruleScore += Math.min(2.5, motivated.length * 0.8);
    reasons.push(`Motivated seller language (${motivated.slice(0, 3).join(', ')})`);
  }

  const flipSignals = countKeywordHits(text, FLIP_KEYWORDS);
  if (flipSignals.length) {
    ruleScore += Math.min(2, flipSignals.length * 0.7);
    reasons.push(`Flip / value-add signals (${flipSignals.slice(0, 3).join(', ')})`);
  }

  const positive = countKeywordHits(text, POSITIVE_KEYWORDS);
  if (positive.length) {
    ruleScore += Math.min(1.5, positive.length * 0.5);
    reasons.push(`Upside keywords (${positive.slice(0, 3).join(', ')})`);
  }

  const riskHits = countKeywordHits(text, RISK_KEYWORDS);
  if (riskHits.length) {
    ruleScore -= Math.min(2, riskHits.length * 0.5);
    risks.push(...riskHits.slice(0, 4).map((k) => `Mentioned: ${k}`));
  }

  const dealCriteria = criteria ? evaluateDealCriteria(text, criteria) : {
    landTenure: classifyLandTenure(text),
    landHits: countKeywordHits(text, LAND_OWNED_KEYWORDS),
    parkHits: countKeywordHits(text, PARK_LOT_RENT_KEYWORDS),
    requireHits: [],
    excludeHits: [],
    boostHits: [],
    excluded: false,
    excludeReason: '',
    landScoreDelta: 0,
  };

  if (dealCriteria.landTenure === 'own_land') {
    reasons.push(`Land-owned (${dealCriteria.landHits.slice(0, 2).join(', ') || 'signals'})`);
  } else if (dealCriteria.landTenure === 'park_lot_rent') {
    risks.push(`Park / lot rent (${dealCriteria.parkHits.slice(0, 2).join(', ')})`);
  }

  if (dealCriteria.boostHits.length) {
    reasons.push(`Boost phrases (${dealCriteria.boostHits.slice(0, 2).join(', ')})`);
  }

  ruleScore += dealCriteria.landScoreDelta || 0;

  if (pricePerSqft != null && context.medianPricePerSqft != null) {
    const ratio = pricePerSqft / context.medianPricePerSqft;
    if (ratio <= 0.75) {
      ruleScore += 2;
      reasons.push(
        `Price/sqft ~$${pricePerSqft} is well below batch median (~$${Math.round(context.medianPricePerSqft)}/sqft)`
      );
    } else if (ratio <= 0.9) {
      ruleScore += 1;
      reasons.push(`Price/sqft slightly below batch median`);
    } else if (ratio >= 1.25) {
      ruleScore -= 0.5;
      risks.push('Priced above typical $/sqft in this batch');
    }
  }

  if (sourceCount === 1) {
    ruleScore += 0.5;
    reasons.push('Only on one source — less competition');
  } else if (sourceCount >= 3) {
    ruleScore -= 0.3;
    risks.push(`Listed on ${sourceCount} sources — may be stale or over-marketed`);
  }

  if (price != null && price <= 35000 && (listing.beds || 0) >= 2) {
    ruleScore += 0.5;
    reasons.push('Low absolute price for size — room for margin');
  }

  if (!price && !flipSignals.length && !motivated.length) {
    ruleScore -= 1;
    risks.push('Missing price and weak deal signals');
  }

  ruleScore = Math.max(0, Math.min(10, Math.round(ruleScore * 10) / 10));

  const passesPreFilter =
    !dealCriteria.excluded &&
    (ruleScore >= 2 ||
      motivated.length > 0 ||
      flipSignals.length > 0 ||
      dealCriteria.landTenure === 'own_land' ||
      (pricePerSqft != null &&
        context.medianPricePerSqft != null &&
        pricePerSqft <= context.medianPricePerSqft * 0.9));

  return {
    ruleScore,
    reasons,
    risks,
    sourceCount,
    pricePerSqft,
    passesPreFilter,
    landTenure: dealCriteria.landTenure,
    dealCriteria,
  };
}

function flipTier(flipScore) {
  if (flipScore >= 8) return 'strong_flip';
  if (flipScore >= 6.5) return 'likely_flip';
  if (flipScore >= 5) return 'watch';
  return 'pass';
}

function combineScores(ruleScore, aiResult) {
  if (!aiResult || aiResult.flipScore == null) {
    return { flipScore: ruleScore, roiPercent: null, estimatedARV: null, estimatedRepairCost: null };
  }
  const aiScore = parseNumber(aiResult.flipScore, ruleScore);
  const flipScore = Math.round((ruleScore * 0.35 + aiScore * 0.65) * 10) / 10;
  return {
    flipScore: Math.max(0, Math.min(10, flipScore)),
    roiPercent: aiResult.roiPercent != null ? parseNumber(aiResult.roiPercent, null) : null,
    estimatedARV:
      aiResult.estimatedARV != null ? parseNumber(aiResult.estimatedARV, null) : null,
    estimatedRepairCost:
      aiResult.estimatedRepairCost != null
        ? parseNumber(aiResult.estimatedRepairCost, null)
        : null,
    estimatedProfit:
      aiResult.estimatedProfit != null ? parseNumber(aiResult.estimatedProfit, null) : null,
    unique: aiResult.unique === true,
    aiReasons: Array.isArray(aiResult.reasons) ? aiResult.reasons.slice(0, 6) : [],
    aiRisks: Array.isArray(aiResult.risks) ? aiResult.risks.slice(0, 6) : [],
    aiSummary: typeof aiResult.summary === 'string' ? aiResult.summary.trim() : '',
  };
}

function buildAiPrompt(row, ruleResult, context, criteria = null) {
  const listing = row.listing || {};
  return JSON.stringify(
    {
      title: row.title,
      price: listing.price,
      beds: listing.beds,
      baths: listing.baths,
      sqft: listing.sqft,
      address: row.address,
      city: row.city || context.city,
      state: row.state || context.state,
      source: listing.source,
      description: String(listing.description || '').slice(0, 2000),
      ruleScore: ruleResult.ruleScore,
      ruleReasons: ruleResult.reasons,
      ruleRisks: ruleResult.risks,
      landTenure: ruleResult.landTenure,
      pricePerSqft: ruleResult.pricePerSqft,
      batchMedianPricePerSqft: context.medianPricePerSqft,
      sourceCount: ruleResult.sourceCount,
      investorCriteria: criteria
        ? {
            landMode: criteria.landMode,
            requirePhrases: (criteria.requirePhrases || []).slice(0, 12),
            excludePhrases: (criteria.excludePhrases || []).slice(0, 12),
          }
        : null,
    },
    null,
    0
  );
}

async function scoreListingWithAi(row, ruleResult, context, criteria = null) {
  const landNote =
    criteria && criteria.landMode === 'own_land_only'
      ? ' Investor requires fee-simple / land-owned deals — heavily penalize park lot rent and missing land signals.'
      : criteria && criteria.landMode === 'exclude_park'
        ? ' Exclude park / lot-rent deals from strong scores.'
        : criteria && criteria.landMode === 'prefer_own_land'
          ? ' Prefer land-included deals; park rent erodes margin.'
          : ' Penalize park-rent / lot-lease uncertainty.';

  const ai = await chatCompletion({
    messages: [
      {
        role: 'system',
        content: `You are a mobile home flip investor analyst. Score listings for flip ROI potential using ONLY the data provided — do not invent comps or facts not in the listing.

Respond with JSON only:
{
  "flipScore": number (0-10, 10 = exceptional flip),
  "estimatedARV": number or null,
  "estimatedRepairCost": number or null,
  "estimatedProfit": number or null,
  "roiPercent": number or null (estimated ROI % after purchase + rehab + ~8% holding/closing),
  "unique": boolean (true if this looks like a distinct opportunity, not generic inventory),
  "reasons": string[] (max 4, why it could work),
  "risks": string[] (max 4, what could kill the deal),
  "summary": string (one sentence verdict)
}

Be conservative on ARV and ROI.${landNote} Reward motivated seller language, land-included / fee-simple tenure, and below-market pricing.`,
      },
      {
        role: 'user',
        content: buildAiPrompt(row, ruleResult, context, criteria),
      },
    ],
    jsonObject: true,
    max_tokens: 500,
    temperature: 0.35,
  });

  if (!ai.content || ai.error) {
    return { aiError: ai.error || 'AI unavailable', provider: ai.provider || 'none' };
  }

  const parsed = parseLlmJson(ai.content);
  if (!parsed || parsed.flipScore == null) {
    return { aiError: 'Invalid AI response', provider: ai.provider || 'none' };
  }

  return { ai: parsed, provider: ai.provider || 'openrouter' };
}

function passesFlipFilter(analysis, flipFilter) {
  if (analysis.excludedByCriteria) return false;
  if (analysis.flipScore < flipFilter.minFlipScore) return false;
  if (
    flipFilter.minRoiPercent > 0 &&
    analysis.roiPercent != null &&
    analysis.roiPercent < flipFilter.minRoiPercent
  ) {
    return false;
  }
  if (flipFilter.onlyUnique) {
    const unique =
      analysis.unique === true ||
      (analysis.sourceCount === 1 && analysis.ruleScore >= flipFilter.minFlipScore - 1);
    if (!unique) return false;
  }
  return true;
}

function landTenureSortRank(tenure, landMode) {
  if (landMode === 'any') return 0;
  if (tenure === 'own_land') return 0;
  if (tenure === 'unknown') return 1;
  if (tenure === 'park_lot_rent') return 2;
  return 1;
}

function compareFlipListings(a, b, landMode) {
  const aa = a.listing && a.listing.flipAnalysis ? a.listing.flipAnalysis : {};
  const bb = b.listing && b.listing.flipAnalysis ? b.listing.flipAnalysis : {};
  const landCmp =
    landTenureSortRank(aa.landTenure, landMode) - landTenureSortRank(bb.landTenure, landMode);
  if (landCmp !== 0 && landMode !== 'any') return landCmp;
  return (b.flipScore || 0) - (a.flipScore || 0);
}

function attachAnalysis(row, analysis) {
  return {
    ...row,
    flipScore: analysis.flipScore,
    listing: {
      ...(row.listing || {}),
      flipAnalysis: analysis,
    },
  };
}

/**
 * Score listings and optionally filter to flip candidates.
 * @param {object[]} listings
 * @param {object} flipFilter — from parseFlipFilter
 * @param {{ city?: string, state?: string }} [context]
 * @returns {Promise<{ listings: object[], stats: object }>}
 */
async function scoreAndFilterListings(listings, flipFilter, context = {}) {
  const filter = resolveDealCriteria({ ...DEFAULT_FLIP_FILTER, ...flipFilter });
  const rows = Array.isArray(listings) ? [...listings] : [];

  if (!filter.enabled) {
    return {
      listings: rows,
      stats: { enabled: false, inputCount: rows.length, outputCount: rows.length },
    };
  }

  const { sourceCountByKey } = buildSourceCountMap(rows);
  const medianPricePerSqft = batchMedianPricePerSqft(rows);
  const scoringContext = {
    ...context,
    sourceCountByKey,
    medianPricePerSqft,
  };

  const ruleScored = rows.map((row) => {
    const rules = scoreListingRules(row, scoringContext, filter);
    return { row, rules };
  });

  const criteriaExcluded = ruleScored.filter((item) => item.rules.dealCriteria.excluded).length;

  const preFiltered = ruleScored.filter((item) => item.rules.passesPreFilter);
  const aiCandidates = preFiltered
    .sort((a, b) => b.rules.ruleScore - a.rules.ruleScore)
    .slice(0, filter.aiMaxCandidates);

  const aiByKey = new Map();
  let aiCalls = 0;
  let aiFailures = 0;

  if (filter.useAi && aiCandidates.length) {
    for (const item of aiCandidates) {
      const key = normalizeAddressKey(item.row);
      try {
        const aiOut = await scoreListingWithAi(item.row, item.rules, scoringContext, filter);
        aiCalls += 1;
        if (aiOut.ai) {
          aiByKey.set(key, aiOut);
        } else {
          aiFailures += 1;
          aiByKey.set(key, aiOut);
        }
      } catch (err) {
        aiFailures += 1;
        aiByKey.set(key, { aiError: err.message || 'AI failed' });
      }
    }
  }

  const analyzed = ruleScored.map(({ row, rules }) => {
    const key = normalizeAddressKey(row);
    const aiOut = aiByKey.get(key);
    const combined = combineScores(rules.ruleScore, aiOut && aiOut.ai ? aiOut.ai : null);

    const analysis = {
      flipScore: combined.flipScore,
      tier: flipTier(combined.flipScore),
      ruleScore: rules.ruleScore,
      roiPercent: combined.roiPercent,
      estimatedARV: combined.estimatedARV,
      estimatedRepairCost: combined.estimatedRepairCost,
      estimatedProfit: combined.estimatedProfit,
      reasons: [...rules.reasons, ...(combined.aiReasons || [])].slice(0, 8),
      risks: [...rules.risks, ...(combined.aiRisks || [])].slice(0, 8),
      summary: combined.aiSummary || rules.reasons[0] || '',
      sourceCount: rules.sourceCount,
      pricePerSqft: rules.pricePerSqft,
      landTenure: rules.landTenure,
      landTenureLabel: landTenureLabel(rules.landTenure),
      excludedByCriteria: rules.dealCriteria.excluded,
      excludeReason: rules.dealCriteria.excludeReason || null,
      unique: combined.unique === true || rules.sourceCount === 1,
      aiUsed: !!(aiOut && aiOut.ai),
      aiProvider: aiOut && aiOut.provider ? aiOut.provider : null,
      aiError: aiOut && aiOut.aiError ? aiOut.aiError : null,
      scoredAt: new Date().toISOString(),
    };

    return attachAnalysis(row, analysis);
  });

  const passing = analyzed
    .filter((row) => passesFlipFilter(row.listing.flipAnalysis, filter))
    .sort((a, b) => compareFlipListings(a, b, filter.landMode));

  return {
    listings: passing,
    stats: {
      enabled: true,
      inputCount: rows.length,
      preFilterCount: preFiltered.length,
      criteriaExcluded,
      aiCalls,
      aiFailures,
      outputCount: passing.length,
      minFlipScore: filter.minFlipScore,
      minRoiPercent: filter.minRoiPercent,
      onlyUnique: filter.onlyUnique,
      landMode: filter.landMode,
      requirePhraseCount: filter.requirePhrases.length,
      excludePhraseCount: filter.excludePhrases.length,
    },
  };
}

module.exports = {
  parseFlipFilter,
  resolveDealCriteria,
  classifyLandTenure,
  landTenureLabel,
  evaluateDealCriteria,
  scoreListingRules,
  scoreAndFilterListings,
  buildSourceCountMap,
  batchMedianPricePerSqft,
  DEFAULT_FLIP_FILTER,
  LAND_OWNED_KEYWORDS,
  PARK_LOT_RENT_KEYWORDS,
};
