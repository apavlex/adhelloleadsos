/**
 * AI chat grounded in stored Local SEO research (how to rank / what to do).
 */

const { chatCompletion } = require('./llmClient');
const { fallbackPlan } = require('./localSeoPlanner');

function buildContext(research, actionPlan) {
  const r = research || {};
  return {
    profile: r.profileSnapshot || null,
    scores: r.scores || null,
    keywordRanks: (r.keywordRanks || []).map((k) => ({
      keyword: k.keyword,
      mapsRank: k.mapsRank,
      localPackRank: k.localPackRank,
      error: k.error || null,
      topCompetitors: (k.competitors || []).slice(0, 3).map((c) => ({
        title: c.title,
        rank: c.rank,
        rating: c.rating,
      })),
    })),
    competitors: (r.competitors || []).slice(0, 8),
    gbp: r.gbp
      ? {
          completeness: r.gbp.completeness,
          checks: r.gbp.checks,
          rating: r.gbp.rating,
          votes: r.gbp.votes,
          category: r.gbp.category,
        }
      : null,
    reviews: r.reviews
      ? { rating: r.reviews.rating, votes: r.reviews.votes, unanswered: r.reviews.unanswered }
      : null,
    actionPlan: actionPlan
      ? { summary: actionPlan.summary, steps: (actionPlan.steps || []).slice(0, 8) }
      : fallbackPlan(r),
  };
}

async function askLocalSeoChat(research, actionPlan, question, { integrationEnv, history } = {}) {
  const q = String(question || '').trim().slice(0, 1200);
  if (!q) {
    const err = new Error('Ask a question about how to rank or improve.');
    err.code = 'NO_QUESTION';
    throw err;
  }
  if (!research) {
    return {
      answer:
        'No research yet. Fill City + State, add local keywords (e.g. “flooring Camas”), then click Update research. After that I can tell you how to rank.',
      source: 'rules',
    };
  }

  const context = buildContext(research, actionPlan);
  const prior = Array.isArray(history)
    ? history.slice(-6).map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: String(m.content || '').slice(0, 1500),
      }))
    : [];

  const system = [
    'You are a local SEO + AI-visibility coach inside Agency OS.',
    'Use ONLY the provided research JSON. Never invent Maps ranks, ratings, Place IDs, or competitor names.',
    'If a keyword shows mapsRank null, say they were not found in the top Maps results for that market and explain what to fix (NAP, categories, reviews, keyword targeting, GBP).',
    'Answer with concrete next steps: what to do this week to rank higher in Maps / local pack, and how that helps AI Overviews / ChatGPT citations when relevant.',
    'Keep answers under 220 words. Use short bullets when listing actions.',
  ].join(' ');

  try {
    const result = await chatCompletion({
      messages: [
        { role: 'system', content: system },
        {
          role: 'user',
          content: JSON.stringify({ research: context, question: q }),
        },
        ...prior.filter((m) => m.role === 'user' || m.role === 'assistant'),
      ],
      integrationEnv,
      temperature: 0.35,
      maxTokens: 900,
    });
    const answer = String((result && result.text) || '').trim();
    if (answer) return { answer: answer.slice(0, 4000), source: 'llm' };
  } catch (_) {
    /* fall through */
  }

  const plan = fallbackPlan(research);
  const lines = [
    `Based on your saved research (local score ${context.scores && context.scores.overall != null ? context.scores.overall : '—'}):`,
    ...(plan.steps || []).slice(0, 5).map((s, i) => `${i + 1}. ${s.title} — ${s.why}`),
    'Update research after GBP/Place ID fixes to refresh ranks.',
  ];
  return { answer: lines.join('\n'), source: 'rules' };
}

module.exports = {
  askLocalSeoChat,
  buildContext,
};
