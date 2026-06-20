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

const DEFAULT_FLIP_FILTER = {
  enabled: false,
  minFlipScore: 7,
  minRoiPercent: 15,
  onlyUnique: false,
  useAi: true,
  aiMaxCandidates: 20,
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
 * @returns {{ ruleScore: number, reasons: string[], risks: string[], sourceCount: number, pricePerSqft: number|null, passesPreFilter: boolean }}
 */
function scoreListingRules(row, context) {
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
    ruleScore >= 2 ||
    motivated.length > 0 ||
    flipSignals.length > 0 ||
    (pricePerSqft != null &&
      context.medianPricePerSqft != null &&
      pricePerSqft <= context.medianPricePerSqft * 0.9);

  return {
    ruleScore,
    reasons,
    risks,
    sourceCount,
    pricePerSqft,
    passesPreFilter,
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

function buildAiPrompt(row, ruleResult, context) {
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
      pricePerSqft: ruleResult.pricePerSqft,
      batchMedianPricePerSqft: context.medianPricePerSqft,
      sourceCount: ruleResult.sourceCount,
    },
    null,
    0
  );
}

async function scoreListingWithAi(row, ruleResult, context) {
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

Be conservative on ARV and ROI. Penalize park-rent / lot-lease uncertainty. Reward motivated seller language, land-included, and below-market pricing.`,
      },
      {
        role: 'user',
        content: buildAiPrompt(row, ruleResult, context),
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
  const filter = { ...DEFAULT_FLIP_FILTER, ...flipFilter };
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
    const rules = scoreListingRules(row, scoringContext);
    return { row, rules };
  });

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
        const aiOut = await scoreListingWithAi(item.row, item.rules, scoringContext);
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
    .sort((a, b) => (b.flipScore || 0) - (a.flipScore || 0));

  return {
    listings: passing,
    stats: {
      enabled: true,
      inputCount: rows.length,
      preFilterCount: preFiltered.length,
      aiCalls,
      aiFailures,
      outputCount: passing.length,
      minFlipScore: filter.minFlipScore,
      minRoiPercent: filter.minRoiPercent,
      onlyUnique: filter.onlyUnique,
    },
  };
}

module.exports = {
  parseFlipFilter,
  scoreListingRules,
  scoreAndFilterListings,
  buildSourceCountMap,
  batchMedianPricePerSqft,
  DEFAULT_FLIP_FILTER,
};
