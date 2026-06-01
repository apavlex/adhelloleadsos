/**
 * Server-side opportunity scoring — aligned with public/js/app.js calculateOpportunityScore.
 * Higher score = more gaps = better prospect for agency / SaaS offers.
 * Merges Local Client Prospector–style Hot/Warm/Low/Skip via {@link scoreLocalProspect}.
 */

const { scoreLocalProspect } = require('./localProspectScore');
function hasSocial(val) {
  return !!(val && String(val).trim() && String(val).trim() !== 'N/A');
}

function boolGap(lead, key, whenTrue) {
  const v = lead[key];
  if (v === false || v === 'false') return whenTrue;
  return false;
}

/**
 * @param {object} lead — saved lead from DB
 * @returns {{ score: number, tier: 'high'|'medium'|'low', reasons: string[] }}
 */
function scoreLeadRecord(lead) {
  const reasons = [];
  let score = 0;

  const website = lead.website && lead.website !== 'N/A';
  const reviews = parseInt(lead.reviewsCount != null ? lead.reviewsCount : lead.reviews, 10) || 0;
  const rating = parseFloat(lead.totalScore != null ? lead.totalScore : lead.rating) || 0;

  const hasFB = hasSocial(lead.facebook);
  const hasIG = hasSocial(lead.instagram);

  const isOutdated = lead.isOutdated === true || lead.isOutdated === 'true';
  const noMobile = boolGap(lead, 'isMobileFriendly', true);
  const noSchema = boolGap(lead, 'hasSchemaMarkup', true);
  const noChatbot = boolGap(lead, 'hasChatbot', true);
  const noClickToCall = boolGap(lead, 'hasClickToCall', true);
  const aeoScore = parseInt(lead.aeoScore, 10) || 0;

  const cms = String(lead.cmsPlatform || '').toLowerCase();
  const buyingSignals = Array.isArray(lead.buyingSignals) ? lead.buyingSignals.map(String) : [];

  const hasAuditSignals =
    lead.isOutdated !== undefined ||
    lead.isMobileFriendly !== undefined ||
    lead.hasSchemaMarkup !== undefined ||
    lead.hasChatbot !== undefined ||
    (lead.aeoScore !== undefined && lead.aeoScore !== '') ||
    lead.auditData != null;

  if (!website) {
    score += 4.5;
    reasons.push('No usable website — strongest hook for a build or landing page');
  } else {
    if (isOutdated) {
      score += 2.5;
      reasons.push('Site feels outdated — good for redesign pitch');
    }
    if (noMobile) {
      score += 3.0;
      reasons.push('Not mobile-friendly — hurts conversions and maps traffic');
    }
    if (noSchema) {
      score += 2.0;
      reasons.push('Missing schema / local SEO signals — GEO opportunity');
    }
    if (noChatbot) {
      score += 1.5;
      reasons.push('No chatbot — lead capture gap');
    }
    if (noClickToCall) {
      score += 1.5;
      reasons.push('Weak click-to-call — friction on mobile');
    }
    if (aeoScore > 0 && aeoScore < 3) {
      score += 1.5;
      reasons.push('Low answer-engine / AEO score');
    }
    if (!hasFB || !hasIG) {
      score += 1.0;
      reasons.push('Light or missing social presence (IG/FB)');
    }

    if ((cms === 'wix' || cms === 'squarespace') && noChatbot) {
      score += 1.5;
      reasons.push(`${cms} + no chat capture — AI receptionist / voice agent upsell`);
    } else if ((cms === 'shopify' || cms === 'webflow') && noChatbot) {
      score += 1.0;
      reasons.push(`${cms} storefront/site — add conversational capture or AI SDR`);
    }
  }

  if (buyingSignals.length > 0) {
    score += Math.min(2, buyingSignals.length * 0.5);
    reasons.push(`Buying signals: ${buyingSignals.slice(0, 3).join('; ')}`);
  }

  if (reviews > 0 && reviews < 20) {
    score += 1.5;
    reasons.push('Few reviews — reputation program can move the needle');
  }
  if (rating > 0 && rating < 4.2) {
    score += 1.5;
    reasons.push('Below ~4.2★ — room to improve perception + reviews');
  }

  if (!hasAuditSignals && website && reviews === 0 && rating === 0) {
    reasons.push('Enrich this lead to unlock full gap analysis');
  }

  score = Math.min(10, score);

  const localProspect = scoreLocalProspect(lead);

  let adjusted = score;
  if (localProspect.prospectTier === 'Skip') {
    adjusted = Math.min(adjusted, 2);
  } else if (localProspect.prospectTier === 'Hot') {
    adjusted = Math.max(adjusted, 7);
  } else if (localProspect.prospectTier === 'Warm') {
    adjusted = Math.max(adjusted, 4.5);
  }

  adjusted = Math.min(10, Math.max(0, adjusted));

  let tierAdj = 'low';
  if (adjusted >= 7) tierAdj = 'high';
  else if (adjusted >= 4) tierAdj = 'medium';

  const mergedReasons = [];
  for (const r of [...localProspect.reasons, ...reasons]) {
    const s = String(r || '').trim();
    if (!s) continue;
    if (!mergedReasons.some((x) => x === s)) mergedReasons.push(s);
  }

  return {
    score: adjusted,
    tier: tierAdj,
    reasons: mergedReasons.slice(0, 10),
    localProspect,
  };
}

function anchorFromKey(key) {
  return String(key || 'x').replace(/[^a-z0-9]+/gi, '-');
}

function defaultAiTimeSaversLeads() {
  return [
    { label: 'Enrich from Saved Leads', hint: 'Fills mobile, schema, chatbot flags so scoring gets sharper.' },
    { label: 'Apify search first', hint: 'Structured Maps data beats manual lists — coach ranks by gaps automatically.' },
    {
      label: 'Frontier LLMs on top of signals',
      hint:
        'Claude / GPT-4–level models shine on personalization lines, ICP 1–10 + why, 2-line site summaries for reps, reply classification, business-specific follow-ups, and structured pulls (names, pain points) from rough Firecrawl text. Add OPENROUTER_API_KEY.',
    },
    { label: 'War Room batch', hint: 'Draft outreach for the highest scores in one pass.' },
  ];
}

/**
 * Payload for flow-coach partial on /leads
 * @param {object[]} leads — workspace leads only
 */
function getLeadsCoachPayload(leads) {
  const list = Array.isArray(leads) ? leads : [];
  if (list.length === 0) {
    return {
      variant: 'leads',
      headline: 'Add leads to unlock priority coaching',
      greeting: 'Import a CSV or run a search — we will stack-rank by website, reviews, social, and SEO gaps.',
      hotLeads: [],
      stats: { high: 0, medium: 0, low: 0, total: 0 },
      nextActions: [
        { label: 'Run a lead search', href: '/', priority: 'high' },
        { label: 'Import CSV', href: '/prospecting?tab=pipeline', priority: 'normal' },
      ],
      aiTimeSavers: defaultAiTimeSaversLeads(),
      source: 'rules',
      generatedAt: new Date().toISOString(),
    };
  }

  const scored = list.map((lead) => {
    const { score, tier, reasons } = scoreLeadRecord(lead);
    return {
      lead,
      score,
      tier,
      reasons,
      anchor: anchorFromKey(lead.key),
    };
  });

  scored.sort((a, b) => b.score - a.score);

  let high = 0;
  let medium = 0;
  let low = 0;
  scored.forEach((s) => {
    if (s.tier === 'high') high += 1;
    else if (s.tier === 'medium') medium += 1;
    else low += 1;
  });

  const strong = scored.filter((s) => s.score >= 4);
  const hotSource = strong.length > 0 ? strong.slice(0, 6) : scored.slice(0, 5);

  const hotLeads = hotSource.map((s) => ({
    key: s.lead.key,
    anchor: s.anchor,
    title: s.lead.title || 'Lead',
    score: Math.round(s.score * 10) / 10,
    tier: s.tier,
    reasons: s.reasons,
  }));

  const top = scored[0];
  const hl = hotLeads.length;
  const headline =
    top.score >= 4
      ? hl === 1
        ? '1 lead shows strong opportunity signals'
        : `${hl} leads show strong opportunity signals`
      : 'Prioritize outreach with enrich + reviews';

  const greeting =
    top.score >= 4
      ? `Start with the highest scores — gaps like weak mobile, thin reviews, or missing social make the business case easy. You have ${high} high and ${medium} medium tier by gap analysis.`
      : 'Scores are modest until we have audit data. Use Enrich on a few leads or import Apify search results for full signals — then re-sort by Opportunity.';

  const nextActions = [];
  hotLeads.slice(0, 3).forEach((h) => {
    nextActions.push({
      label: `Jump to ${h.title.length > 28 ? `${h.title.slice(0, 28)}…` : h.title} (${h.score}/10)`,
      href: `#lead-row-${h.anchor}`,
      priority: h.tier === 'high' ? 'high' : 'normal',
    });
  });
  nextActions.push({
    label: 'Sort by Opportunity (gap score)',
    href: '#sortOpportunity',
    priority: 'normal',
  });

  return {
    variant: 'leads',
    headline,
    greeting,
    hotLeads,
    stats: { high, medium, low, total: list.length },
    nextActions: nextActions.slice(0, 6),
    aiTimeSavers: defaultAiTimeSaversLeads(),
    source: 'rules',
    generatedAt: new Date().toISOString(),
  };
}

module.exports = {
  scoreLeadRecord,
  getLeadsCoachPayload,
  anchorFromKey,
  scoreLocalProspect,
};
