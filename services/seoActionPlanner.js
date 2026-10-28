/**
 * AI action planner — turns stored gap rows into prioritized rank-higher steps.
 * Grounded only in warehouse facts (no invented rankings).
 */

const { chatCompletion, parseLlmJson } = require('./llmClient');
const { summarizeGaps } = require('./seoGapEngine');

function fallbackPlan(project) {
  const gaps = Array.isArray(project.gapRows) ? project.gapRows.slice(0, 12) : [];
  const steps = gaps.map((g, i) => ({
    rank: i + 1,
    impact: g.opportunityScore >= 70 ? 'High' : g.opportunityScore >= 45 ? 'Med' : 'Low',
    effort: g.gapType === 'missing' ? 'Med' : 'Low',
    title:
      g.gapType === 'missing'
        ? `Create or strengthen a page targeting “${g.keyword}”`
        : `Improve ranking for “${g.keyword}” (you #${g.youPos}, rival #${g.rivalPos})`,
    why: `${g.rivalDomain || 'Competitor'} ranks #${g.rivalPos} · volume ${g.volume || 0} · KD ${g.kd != null ? g.kd : '—'}`,
    keyword: g.keyword,
    evidence: {
      youPos: g.youPos,
      rivalPos: g.rivalPos,
      rivalDomain: g.rivalDomain,
      volume: g.volume,
      kd: g.kd,
    },
  }));
  return {
    source: 'rules',
    summary: `Found ${gaps.length} keyword opportunities vs competitors for ${project.seedDomain}.`,
    steps,
  };
}

async function generateActionPlan(project, opts) {
  const options = opts || {};
  const gaps = Array.isArray(project.gapRows) ? project.gapRows.slice(0, 40) : [];
  if (!gaps.length) {
    return {
      source: 'rules',
      summary: 'No gap keywords stored yet. Run a DataForSEO sync first.',
      steps: [],
    };
  }

  const summary = project.gapSummary || summarizeGaps(gaps);
  const compact = gaps.slice(0, 25).map((g) => ({
    keyword: g.keyword,
    gapType: g.gapType,
    youPos: g.youPos,
    rivalPos: g.rivalPos,
    rivalDomain: g.rivalDomain,
    volume: g.volume,
    kd: g.kd,
    opportunityScore: g.opportunityScore,
  }));

  const system = [
    'You are an SEO strategist for agencies.',
    'You ONLY use the provided gap JSON — never invent rankings, volumes, or competitors.',
    'Return strict JSON: { "summary": string, "steps": [ { "rank": number, "impact": "High"|"Med"|"Low", "effort": "High"|"Med"|"Low", "title": string, "why": string, "keyword": string } ] }',
    'Produce 8–12 prioritized concrete actions to help the seed domain rank higher.',
    'Each step must cite a keyword from the list and reference rival position when relevant.',
  ].join(' ');

  const user = JSON.stringify({
    seedDomain: project.seedDomain,
    market: { locationCode: project.locationCode, languageCode: project.languageCode },
    summary,
    competitors: (project.competitors || []).map((c) => c.domain),
    gaps: compact,
  });

  try {
    const result = await chatCompletion({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      max_tokens: 1800,
      temperature: 0.2,
      integrationEnv: options.integrationEnv,
    });
    if (result.error || !result.content) {
      const plan = fallbackPlan(project);
      plan.warning = result.errorMessage || 'LLM unavailable — used rule-based plan';
      return plan;
    }
    const parsed = parseLlmJson(result.content);
    if (!parsed || !Array.isArray(parsed.steps) || !parsed.steps.length) {
      const plan = fallbackPlan(project);
      plan.warning = 'LLM returned unusable JSON — used rule-based plan';
      return plan;
    }
    const allowed = new Set(gaps.map((g) => g.keyword));
    const steps = parsed.steps
      .map((s, i) => ({
        rank: i + 1,
        impact: ['High', 'Med', 'Low'].includes(s.impact) ? s.impact : 'Med',
        effort: ['High', 'Med', 'Low'].includes(s.effort) ? s.effort : 'Med',
        title: String(s.title || '').trim().slice(0, 200),
        why: String(s.why || '').trim().slice(0, 280),
        keyword: String(s.keyword || '').trim().toLowerCase().slice(0, 200),
      }))
      .filter((s) => s.title && (!s.keyword || allowed.has(s.keyword)))
      .slice(0, 12);
    if (!steps.length) return fallbackPlan(project);
    return {
      source: 'ai',
      model: result.model || '',
      summary: String(parsed.summary || '').trim().slice(0, 500) || fallbackPlan(project).summary,
      steps,
    };
  } catch (err) {
    const plan = fallbackPlan(project);
    plan.warning = err && err.message ? err.message : 'AI plan failed';
    return plan;
  }
}

module.exports = {
  generateActionPlan,
  fallbackPlan,
};
