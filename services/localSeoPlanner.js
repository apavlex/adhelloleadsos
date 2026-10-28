/**
 * AI (or rules) action plan from stored Local SEO research.
 */

const { chatCompletion, parseLlmJson } = require('./llmClient');

function fallbackPlan(research) {
  const r = research || {};
  const steps = [];
  const scores = r.scores || {};
  const gbp = r.gbp || {};
  const reviews = r.reviews || {};
  const ranks = Array.isArray(r.keywordRanks) ? r.keywordRanks : [];

  for (const k of ranks.filter((x) => x.mapsRank == null || x.mapsRank > 3).slice(0, 4)) {
    steps.push({
      rank: steps.length + 1,
      impact: 'High',
      effort: 'Med',
      title: `Improve Maps visibility for “${k.keyword}”`,
      why:
        k.mapsRank == null
          ? 'Business not found in top Maps results for this query.'
          : `Currently Maps rank #${k.mapsRank}.`,
    });
  }

  if (gbp && gbp.checks) {
    const c = gbp.checks;
    if (!c.hasHours) steps.push({ rank: steps.length + 1, impact: 'Med', effort: 'Low', title: 'Add complete GBP hours', why: 'Hours missing from profile completeness checks.' });
    if (!c.hasDescription) steps.push({ rank: steps.length + 1, impact: 'Med', effort: 'Low', title: 'Write a stronger GBP description', why: 'Description missing.' });
    if ((c.photos || 0) < 10) steps.push({ rank: steps.length + 1, impact: 'Med', effort: 'Med', title: 'Add more GBP photos', why: `Only ${c.photos || 0} photos detected.` });
  } else if (!gbp) {
    steps.push({
      rank: steps.length + 1,
      impact: 'High',
      effort: 'Med',
      title: 'Claim / verify Google Business Profile identity',
      why: 'GBP info could not be resolved — set Place ID or confirm NAP.',
    });
  }

  if (reviews && (reviews.unanswered || 0) > 0) {
    steps.push({
      rank: steps.length + 1,
      impact: 'High',
      effort: 'Low',
      title: `Reply to ${reviews.unanswered} unanswered Google reviews`,
      why: 'Unanswered reviews hurt local trust signals.',
    });
  }

  if ((reviews && reviews.votes != null && reviews.votes < 25) || (gbp && gbp.votes != null && gbp.votes < 25)) {
    steps.push({
      rank: steps.length + 1,
      impact: 'High',
      effort: 'Med',
      title: 'Run a review request cadence for recent customers',
      why: 'Review volume is still low for competitive local pack.',
    });
  }

  return {
    source: 'rules',
    summary: `Local score ${scores.overall != null ? scores.overall : '—'} · Maps ${scores.mapsScore != null ? scores.mapsScore : '—'} · GBP ${scores.gbpScore != null ? scores.gbpScore : '—'} · Reviews ${scores.reviewScore != null ? scores.reviewScore : '—'}.`,
    steps: steps.slice(0, 10),
  };
}

async function generateLocalActionPlan(research, opts) {
  const options = opts || {};
  if (!research) {
    return { source: 'rules', summary: 'No research stored yet. Run Update first.', steps: [] };
  }

  const compact = {
    profile: research.profileSnapshot,
    scores: research.scores,
    keywordRanks: (research.keywordRanks || []).map((k) => ({
      keyword: k.keyword,
      mapsRank: k.mapsRank,
      localPackRank: k.localPackRank,
    })),
    gbp: research.gbp
      ? {
          completeness: research.gbp.completeness,
          checks: research.gbp.checks,
          rating: research.gbp.rating,
          votes: research.gbp.votes,
          category: research.gbp.category,
        }
      : null,
    reviews: research.reviews
      ? {
          rating: research.reviews.rating,
          votes: research.reviews.votes,
          unanswered: research.reviews.unanswered,
          fetched: research.reviews.fetched,
        }
      : null,
  };

  const system = [
    'You are a local SEO strategist for agencies.',
    'Use ONLY the provided Local SEO JSON — never invent rankings, ratings, or Place IDs.',
    'Return strict JSON: { "summary": string, "steps": [ { "rank": number, "impact": "High"|"Med"|"Low", "effort": "High"|"Med"|"Low", "title": string, "why": string } ] }',
    'Produce 6–10 concrete actions to improve Maps/local pack, GBP, and reviews.',
  ].join(' ');

  try {
    const result = await chatCompletion({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: JSON.stringify(compact) },
      ],
      integrationEnv: options.integrationEnv,
      temperature: 0.3,
      maxTokens: 1800,
      responseFormat: { type: 'json_object' },
    });
    const parsed = parseLlmJson(result && result.text);
    if (parsed && Array.isArray(parsed.steps) && parsed.steps.length) {
      return {
        source: 'llm',
        summary: String(parsed.summary || '').slice(0, 500),
        steps: parsed.steps.slice(0, 12).map((s, i) => ({
          rank: Number(s.rank) || i + 1,
          impact: ['High', 'Med', 'Low'].includes(s.impact) ? s.impact : 'Med',
          effort: ['High', 'Med', 'Low'].includes(s.effort) ? s.effort : 'Med',
          title: String(s.title || '').slice(0, 200),
          why: String(s.why || '').slice(0, 400),
        })),
        generatedAt: new Date().toISOString(),
      };
    }
  } catch (_) {
    /* fall through */
  }

  const plan = fallbackPlan(research);
  plan.generatedAt = new Date().toISOString();
  return plan;
}

module.exports = {
  generateLocalActionPlan,
  fallbackPlan,
};
