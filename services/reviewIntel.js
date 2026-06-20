/**
 * AI reputation summary from Google review snippets + rating (OpenRouter).
 */

const { chatCompletion, parseLlmJson } = require('./llmClient');

/**
 * @param {object} lead
 * @returns {Promise<{ intel: { summary: string, sourceNote: string }, error?: string }|null>}
 */
async function generateReviewSummaryForLead(lead) {
  if (!lead || typeof lead !== 'object') return null;

  const snippets = Array.isArray(lead.reviewSnippets) ? lead.reviewSnippets : [];
  const snapshot = {
    company: lead.title,
    category: lead.categoryName,
    city: lead.city,
    state: lead.state,
    mapsRating: lead.totalScore,
    reviewCount: lead.reviewsCount,
    auditSummary: lead.auditSummary || '',
    reviewSnippets: snippets,
  };

  const ai = await chatCompletion({
    messages: [
      {
        role: 'system',
        content: `You write concise Google review summaries for agency sales reps calling local business owners.

Input JSON may include verbatim customer quotes in reviewSnippets, star rating mapsRating (0-5), reviewCount, category, location, and auditSummary.

Rules:
- Write ONE paragraph (3-5 sentences, plain language). No bullet lists, no "Strengths/Weaknesses" headings.
- If reviewSnippets has quotes: summarize what customers praise and complain about using only themes supported by those quotes plus rating/count.
- If reviewSnippets is empty: summarize reputation from mapsRating, reviewCount, category, and location using cautious wording ("Based on their X★ rating…", "With N reviews…"). Do not invent specific incidents.
- End with one practical angle for a sales conversation (reputation, reviews, or local visibility).
- Do not mention AI, OpenRouter, or that you analyzed JSON.

Return JSON only, no markdown:
{"summary":"paragraph text","sourceNote":"One short sentence: quoted reviews vs rating-only inference."}`,
      },
      {
        role: 'user',
        content: JSON.stringify(snapshot),
      },
    ],
    jsonObject: true,
    max_tokens: 600,
    temperature: 0.35,
  });

  if (!ai.content || ai.error) {
    return {
      error: 'No AI provider configured (set OPENROUTER_API_KEY) or request failed.',
    };
  }

  const parsed = parseLlmJson(ai.content);
  if (!parsed) {
    return { error: 'Invalid AI response' };
  }

  const summary =
    typeof parsed.summary === 'string'
      ? parsed.summary.trim()
      : typeof parsed.text === 'string'
        ? parsed.text.trim()
        : '';

  if (!summary) {
    return { error: 'Invalid AI response' };
  }

  const intel = {
    summary,
    sourceNote: typeof parsed.sourceNote === 'string' ? parsed.sourceNote.trim() : '',
  };

  return { intel };
}

/** @deprecated use generateReviewSummaryForLead */
async function generateReviewIntelForLead(lead) {
  return generateReviewSummaryForLead(lead);
}

module.exports = {
  generateReviewSummaryForLead,
  generateReviewIntelForLead,
};
